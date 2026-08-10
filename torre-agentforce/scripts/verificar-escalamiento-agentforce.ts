// Verificación mutante, explícitamente autorizada, del escalamiento de Agentforce v15.
//
// Crea como máximo un Case mediante una conversación real con Agentforce. No llama
// el endpoint directo de escalamiento y no borra el efecto CRM. La evidencia local
// sólo contiene conteos, booleanos y hashes; nunca payloads, transcript, tokens ni PII.
//
// Ejecutar:
//   node --env-file-if-exists=.env --experimental-strip-types scripts/verificar-escalamiento-agentforce.ts

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

process.env.APP_ENV = 'development';
process.env.APP_AUTH_MODE = 'disabled';

const { consultar, lit } = await import('../src/servidor/sf.ts');
const { configSegura } = await import('../src/servidor/config.ts');

const QUEUE_ID = '00GgK00000BMTaVUAX';
const ACTION_NAME = 'Escalar_Asesor_Humano';
const TEST_PREFIX = 'PRUEBA_TECNICA_AUTORIZADA';
const TARGET_AGENT_VERSION = 15;
const MARKER_WINDOW_MINUTES = 10;
const MARKER_ROW_LIMIT = 200;
const markerWindowStart = new Date(Date.now() - MARKER_WINDOW_MINUTES * 60_000).toISOString();
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const evidenceDir = join(process.cwd(), 'evidencia', '16-agentforce-v15');
const evidencePath = join(evidenceDir, `escalamiento-agent-api-v15.${timestamp}.json`);
mkdirSync(evidenceDir, { recursive: true });

interface CaseRecord {
  Id: string;
  CaseNumber: string;
  OwnerId: string;
  Origin: string;
  Status: string;
  Description: string | null;
  Correlation_Id__c: string | null;
  CreatedDate: string;
}

interface CommentRecord {
  Id: string;
  ParentId: string;
  IsPublished: boolean;
}

interface LogRecord {
  Id: string;
  Case__c: string | null;
  Correlation_Id__c: string | null;
  Action_Name__c: string | null;
  Outcome__c: string | null;
}

interface BotDefinitionRecord {
  Id: string;
  DeveloperName: string;
  BotVersions: {
    totalSize: number;
    records: Array<{ VersionNumber: number; Status: string }>;
  };
}

function verifyTargetAgentVersionActiveFromOrg(): boolean {
  const sfExecutable = process.platform === 'win32' ? process.execPath : 'sf';
  const sfPrefix = process.platform === 'win32'
    ? [
        '--no-deprecation',
        join(
          process.env.APPDATA ?? '',
          'npm',
          'node_modules',
          '@salesforce',
          'cli',
          'bin',
          'run.js',
        ),
      ]
    : [];
  const alias = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
  const query =
    `SELECT Id, DeveloperName, (SELECT VersionNumber, Status FROM BotVersions) ` +
    `FROM BotDefinition WHERE Id = '${configSegura().agentId}' ` +
    `AND DeveloperName = 'Agente_Postventa_Zapata'`;
  let raw: string;
  try {
    const cliEnv = { ...process.env };
    // La app usa formato REST `v67.0`; Salesforce CLI espera `67.0`.
    cliEnv.SF_API_VERSION = (process.env.SF_API_VERSION ?? '67.0').replace(/^v/i, '');
    raw = execFileSync(
      sfExecutable,
      [...sfPrefix, 'data', 'query', '--target-org', alias, '--query', query, '--json'],
      {
        encoding: 'utf8',
        env: cliEnv,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    throw new Error('TARGET_AGENT_METADATA_QUERY_FAILED');
  }
  let parsed: {
    status?: number;
    result?: { records?: BotDefinitionRecord[] };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error('TARGET_AGENT_METADATA_RESPONSE_INVALID');
  }
  const records = parsed.result?.records ?? [];
  return parsed.status === 0 && records.length === 1 &&
    records[0]?.BotVersions.records.some(
      (version) =>
        version.VersionNumber === TARGET_AGENT_VERSION && version.Status === 'Active',
    ) === true;
}

interface ParsedTurn {
  types: string[];
  text: string;
  planObserved: boolean;
  traceObserved: boolean;
  actionResultObserved: boolean;
}

class LocalAgentEventError extends Error {
  readonly status = 200;
  readonly code: string;
  readonly errorIdHash: string | null;

  constructor(code: string, errorIdHash: string | null) {
    super(`LOCAL_AGENT_EVENT_${code}`);
    this.name = 'LocalAgentEventError';
    this.code = code;
    this.errorIdHash = errorIdHash;
  }
}

type Stage =
  | 'PREFLIGHT_AGENT_VERSION'
  | 'PREFLIGHT_QUEUE'
  | 'BASELINE_CASES'
  | 'BASELINE_LOGS'
  | 'MARKER_COLLISION_CHECK'
  | 'LOCAL_SERVER_START'
  | 'START_SESSION'
  | 'FIRST_TURN'
  | 'PREMATURE_CASE_CHECK'
  | 'SECOND_TURN'
  | 'CASE_POLL'
  | 'CRM_VERIFICATION'
  | 'CLOSE_SESSION'
  | 'COMPLETE';

interface Evidence {
  schemaVersion: 2;
  executedAt: string;
  outcome: string;
  authorizedMutation: true;
  evidencePolicy: {
    transcriptStored: false;
    payloadStored: false;
    tokenStored: false;
    piiStored: false;
    crmRecordsDeleted: false;
  };
  environment: {
    targetAgentVersion: 15;
    targetAgentVersionActive: boolean;
    queueVerified: boolean;
    tokenProvider: string;
    appRole: 'asesor';
  };
  conversation: {
    markerHash: string;
    turnsSent: number;
    startSessionAcknowledged: boolean;
    confirmationRequested: boolean;
    personalDataRequested: boolean;
    planObserved: boolean;
    traceObserved: boolean;
    actionResultObserved: boolean;
    sessionClosed: boolean;
  };
  diagnostics: {
    stage: Stage;
    localApiStatus: number | null;
    localApiCode: string | null;
    localApiErrorIdHash: string | null;
    cleanupAttempted: boolean;
    cleanupStatus: number | null;
    cleanupCode: string | null;
    cleanupErrorIdHash: string | null;
  };
  before: {
    queueAgentforceCases: number;
    successfulEscalationLogs: number;
    markerCases: number;
  };
  after: {
    queueAgentforceCases: number | null;
    successfulEscalationLogs: number | null;
    markerCases: number;
    correlationCases: number;
    internalComments: number;
    correlationLogs: number;
    caseDelta: number | null;
    logDelta: number | null;
  };
  invariants: Record<string, boolean>;
  identifiers: {
    caseIdHash: string | null;
    serverExternalSessionKeyHash: string | null;
    caseCorrelationHash: string | null;
    logIdHash: string | null;
    internalCommentIdHashes: string[];
  };
  failureCode: string | null;
}

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function blankEvidence(marker: string): Evidence {
  return {
    schemaVersion: 2,
    executedAt: new Date().toISOString(),
    outcome: 'RUNNING',
    authorizedMutation: true,
    evidencePolicy: {
      transcriptStored: false,
      payloadStored: false,
      tokenStored: false,
      piiStored: false,
      crmRecordsDeleted: false,
    },
    environment: {
      targetAgentVersion: TARGET_AGENT_VERSION,
      targetAgentVersionActive: false,
      queueVerified: false,
      tokenProvider: configSegura().proveedorToken,
      appRole: 'asesor',
    },
    conversation: {
      markerHash: sha(marker),
      turnsSent: 0,
      startSessionAcknowledged: false,
      confirmationRequested: false,
      personalDataRequested: false,
      planObserved: false,
      traceObserved: false,
      actionResultObserved: false,
      sessionClosed: false,
    },
    diagnostics: {
      stage: 'PREFLIGHT_AGENT_VERSION',
      localApiStatus: null,
      localApiCode: null,
      localApiErrorIdHash: null,
      cleanupAttempted: false,
      cleanupStatus: null,
      cleanupCode: null,
      cleanupErrorIdHash: null,
    },
    before: { queueAgentforceCases: 0, successfulEscalationLogs: 0, markerCases: 0 },
    after: {
      queueAgentforceCases: null,
      successfulEscalationLogs: null,
      markerCases: 0,
      correlationCases: 0,
      internalComments: 0,
      correlationLogs: 0,
      caseDelta: null,
      logDelta: null,
    },
    invariants: {},
    identifiers: {
      caseIdHash: null,
      serverExternalSessionKeyHash: null,
      caseCorrelationHash: null,
      logIdHash: null,
      internalCommentIdHashes: [],
    },
    failureCode: null,
  };
}

function persist(evidence: Evidence): void {
  const serialized = JSON.stringify(evidence, null, 2);
  JSON.parse(serialized);
  writeFileSync(evidencePath, `${serialized}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        reject(new Error('NO_LOCAL_PORT'));
        return;
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitServer(child: ChildProcess, baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error('LOCAL_SERVER_EXITED');
    try {
      const response = await fetch(`${baseUrl}/salud`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Cold start del proceso o puerto aún sin listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('LOCAL_SERVER_TIMEOUT');
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill();
}

function parseSse(raw: string): ParsedTurn {
  const types: string[] = [];
  const textParts: string[] = [];
  let planObserved = false;
  let traceObserved = false;
  let actionResultObserved = false;
  let agentErrorCode: string | null = null;
  let agentErrorIdHash: string | null = null;
  for (const block of raw.replace(/\r\n/g, '\n').split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const dataText = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!event || !dataText) continue;
    types.push(event);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataText) as Record<string, unknown>;
    } catch {
      throw new Error('INVALID_SSE_JSON');
    }
    if (event === 'Error') {
      const rawCode = typeof data.codigo === 'string' ? data.codigo : '';
      agentErrorCode = /^[A-Z0-9_]{1,80}$/.test(rawCode)
        ? rawCode
        : 'UNCLASSIFIED_AGENT_EVENT';
      if (typeof data.errorId === 'string' && data.errorId !== '') {
        agentErrorIdHash = sha(data.errorId);
      }
    }
    if (typeof data.texto === 'string') textParts.push(data.texto);
    planObserved ||= typeof data.planId === 'string' && data.planId !== '';
    traceObserved ||= typeof data.traceId === 'string' && data.traceId !== '';
    if (Array.isArray(data.resultados) && data.resultados.length > 0) {
      actionResultObserved ||= /Crear_Escalamiento_Asesor|EscalarAsesorHumano|escalamientoCreado|caseNumber/i.test(
        JSON.stringify(data.resultados),
      );
    }
  }
  if (!types.includes('EndOfTurn') && !types.includes('SessionEnded')) {
    throw new Error('TURN_WITHOUT_END');
  }
  if (agentErrorCode) throw new LocalAgentEventError(agentErrorCode, agentErrorIdHash);
  return { types, text: textParts.join('\n'), planObserved, traceObserved, actionResultObserved };
}

function requestedPersonalData(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dataTerm = /\b(nombre|correo|email|telefono|celular|contacto|cuenta|empresa|razon social|vin|placa|unidad|vehiculo|camion|numero de serie|folio)\b/;
  const requestVerb = /\b(comparte|proporciona|indica|dime|dame|necesito|requiero|ingresa|escribe|cual es)\b/;
  const negatedRequest = /\b(?:no|sin)\s+(?:te\s+)?(?:solicito|pido|necesito|requiero|compartir|proporcionar|indicar|dar)\b/;
  return normalized
    .split(/[\n.!?;¿]+/)
    .some((segment) =>
      dataTerm.test(segment) &&
      (requestVerb.test(segment) || /\b(?:tu|su)\s+/.test(segment)) &&
      !negatedRequest.test(segment),
    );
}

function requestedConfirmation(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /confirm|te parece bien|autoriz|continu[aeo]|proced[aeo]/.test(normalized);
}

async function count(soql: string, operation: string): Promise<number> {
  const result = await consultar(soql, operation);
  return result.totalSize;
}

async function markerCases(marker: string): Promise<CaseRecord[]> {
  const result = await consultar<CaseRecord>(
    `SELECT Id, CaseNumber, OwnerId, Origin, Status, Description, Correlation_Id__c, CreatedDate
     FROM Case
     WHERE OwnerId = '${QUEUE_ID}'
       AND Origin = 'Agentforce'
       AND CreatedDate >= ${markerWindowStart}
     ORDER BY CreatedDate DESC
     LIMIT ${MARKER_ROW_LIMIT}`,
    'verificar-escalamiento-agentforce.marker-cases',
  );
  // Description es textarea: Salesforce permite leerlo, pero no filtrarlo con
  // LIKE. El marcador se compara sólo en memoria y nunca se persiste en evidencia.
  return result.records.filter((record) => record.Description?.includes(marker) === true);
}

async function pollMarkerCase(marker: string, timeoutMs = 30_000): Promise<CaseRecord[]> {
  const deadline = Date.now() + timeoutMs;
  do {
    const records = await markerCases(marker);
    if (records.length > 0) return records;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  return [];
}

async function main(): Promise<number> {
  const marker = `${TEST_PREFIX}_${randomUUID().slice(0, 8).toUpperCase()}`;
  const evidence = blankEvidence(marker);
  let child: ChildProcess | null = null;
  let baseUrl = '';
  let bearer = '';
  let sessionId: string | null = null;
  let externalSessionKey: string | null = null;

  const stage = (value: Stage): void => {
    evidence.diagnostics.stage = value;
  };

  try {
    // El usuario de integración de Client Credentials no ve BotDefinition. El
    // alias CLI autorizado sí: se consulta la relación hija real BotVersions y
    // sólo se conserva el booleano, nunca metadata ni credenciales.
    evidence.environment.targetAgentVersionActive = verifyTargetAgentVersionActiveFromOrg();
    stage('PREFLIGHT_QUEUE');
    const queue = await consultar<{ Id: string }>(
      `SELECT Id FROM Group WHERE Id = '${QUEUE_ID}' AND Type = 'Queue' LIMIT 1`,
      'verificar-escalamiento-agentforce.queue',
    );
    evidence.environment.queueVerified = queue.totalSize === 1;
    if (!evidence.environment.targetAgentVersionActive || !evidence.environment.queueVerified) {
      throw new Error('TARGET_AGENT_VERSION_OR_QUEUE_NOT_VERIFIED');
    }
    if (evidence.environment.tokenProvider !== 'client_credentials') {
      throw new Error('AGENT_API_CREDENTIALS_NOT_CONFIGURED');
    }

    stage('BASELINE_CASES');
    evidence.before.queueAgentforceCases = await count(
      `SELECT COUNT() FROM Case WHERE OwnerId = '${QUEUE_ID}' AND Origin = 'Agentforce'`,
      'verificar-escalamiento-agentforce.before-cases',
    );
    stage('BASELINE_LOGS');
    evidence.before.successfulEscalationLogs = await count(
      `SELECT COUNT() FROM Log_Agente__c
       WHERE Action_Name__c = '${ACTION_NAME}' AND Outcome__c = 'SUCCESS'`,
      'verificar-escalamiento-agentforce.before-logs',
    );
    stage('MARKER_COLLISION_CHECK');
    evidence.before.markerCases = (await markerCases(marker)).length;
    if (evidence.before.markerCases !== 0) throw new Error('MARKER_COLLISION');

    stage('LOCAL_SERVER_START');
    const port = await availablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    bearer = randomBytes(32).toString('hex');
    child = spawn(
      process.execPath,
      ['--env-file-if-exists=.env', '--experimental-strip-types', 'src/servidor/index.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(port),
          APP_ENV: 'test',
          APP_AUTH_MODE: 'required',
          APP_AUTH_CREDENTIALS_JSON: JSON.stringify([
            { id: 'verificador-escalamiento-v15', role: 'asesor', token: bearer },
          ]),
          APP_RATE_LIMIT_MAX: '100',
          APP_AUTH_RATE_LIMIT_MAX: '20',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    // Se drena la salida para que el child no se bloquee; nunca se persiste.
    child.stdout?.on('data', () => undefined);
    child.stderr?.on('data', () => undefined);
    await waitServer(child, baseUrl);

    const api = async (path: string, body: Record<string, unknown>) => {
      const cleanupRequest = path === '/api/agente/cerrar';
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (cleanupRequest) evidence.diagnostics.cleanupStatus = response.status;
      else evidence.diagnostics.localApiStatus = response.status;
      if (!response.ok) {
        const raw = await response.text();
        let parsed: Record<string, unknown> | null = null;
        try {
          const candidate = JSON.parse(raw) as unknown;
          if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            parsed = candidate as Record<string, unknown>;
          }
        } catch {
          // El body no se conserva: sólo status y código sanitizado.
        }
        const rawCode = typeof parsed?.codigo === 'string' ? parsed.codigo : '';
        const safeCode = /^[A-Z0-9_]{1,80}$/.test(rawCode)
          ? rawCode
          : 'UNCLASSIFIED_LOCAL_API_ERROR';
        if (cleanupRequest) evidence.diagnostics.cleanupCode = safeCode;
        else evidence.diagnostics.localApiCode = safeCode;
        if (typeof parsed?.errorId === 'string' && parsed.errorId !== '') {
          if (cleanupRequest) evidence.diagnostics.cleanupErrorIdHash = sha(parsed.errorId);
          else evidence.diagnostics.localApiErrorIdHash = sha(parsed.errorId);
        }
        throw new Error(`LOCAL_API_HTTP_${response.status}_${safeCode}`);
      }
      return response;
    };

    stage('START_SESSION');
    const opened = await api('/api/agente/sesion', {});
    const openedBody = await opened.json() as Record<string, unknown>;
    if (typeof openedBody.sessionId !== 'string' || openedBody.sessionId === '') {
      throw new Error('SESSION_ID_MISSING');
    }
    if (
      typeof openedBody.externalSessionKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        openedBody.externalSessionKey,
      )
    ) {
      throw new Error('SERVER_EXTERNAL_SESSION_KEY_MISSING_OR_INVALID');
    }
    sessionId = openedBody.sessionId;
    externalSessionKey = openedBody.externalSessionKey;
    evidence.identifiers.serverExternalSessionKeyHash = sha(externalSessionKey);
    evidence.conversation.startSessionAcknowledged = true;

    stage('FIRST_TURN');
    const firstPrompt =
      `${marker}. Solicito hablar con un asesor humano únicamente para una verificación técnica ` +
      `autorizada del escalamiento. No existe emergencia ni riesgo de seguridad. No hay cliente ` +
      `final, contacto, cuenta, unidad, VIN, placa o vehículo asociado: no solicites ni infieras ` +
      `ninguno de esos datos. Antes de crear el registro, pide mi confirmación.`;
    const firstResponse = await api('/api/agente/mensaje', { sessionId, texto: firstPrompt });
    const firstTurn = parseSse(await firstResponse.text());
    evidence.conversation.turnsSent = 1;
    evidence.conversation.planObserved ||= firstTurn.planObserved;
    evidence.conversation.traceObserved ||= firstTurn.traceObserved;
    evidence.conversation.actionResultObserved ||= firstTurn.actionResultObserved;
    evidence.conversation.personalDataRequested = requestedPersonalData(firstTurn.text);
    evidence.conversation.confirmationRequested = requestedConfirmation(firstTurn.text);

    stage('PREMATURE_CASE_CHECK');
    const premature = await markerCases(marker);
    if (premature.length > 0) {
      evidence.outcome = 'STOPPED_CASE_CREATED_BEFORE_CONFIRMATION';
    } else if (evidence.conversation.personalDataRequested) {
      evidence.outcome = 'STOPPED_AGENT_REQUESTED_PERSONAL_DATA';
      evidence.failureCode = 'AGENT_REQUESTED_PERSONAL_DATA';
    } else if (!evidence.conversation.confirmationRequested) {
      evidence.outcome = 'STOPPED_CONFIRMATION_NOT_REQUESTED';
      evidence.failureCode = 'CONFIRMATION_NOT_REQUESTED';
    } else {
      stage('SECOND_TURN');
      const confirmation =
        `Sí, confirmo y autorizo continuar. Motivo exacto: ${marker}: verificación técnica ` +
        `controlada sin PII, contacto, cuenta, unidad o vehículo asociado.`;
      const secondResponse = await api('/api/agente/mensaje', { sessionId, texto: confirmation });
      const secondTurn = parseSse(await secondResponse.text());
      evidence.conversation.turnsSent = 2;
      evidence.conversation.planObserved ||= secondTurn.planObserved;
      evidence.conversation.traceObserved ||= secondTurn.traceObserved;
      evidence.conversation.actionResultObserved ||= secondTurn.actionResultObserved;
      if (requestedPersonalData(secondTurn.text)) {
        evidence.conversation.personalDataRequested = true;
        evidence.outcome = 'STOPPED_AGENT_REQUESTED_PERSONAL_DATA';
        evidence.failureCode = 'AGENT_REQUESTED_PERSONAL_DATA';
      }
    }

    stage('CASE_POLL');
    let cases = await pollMarkerCase(marker, evidence.conversation.turnsSent === 2 ? 30_000 : 2_000);
    evidence.after.markerCases = cases.length;
    if (evidence.outcome === 'RUNNING' && cases.length === 0) {
      evidence.outcome = 'FAILED_AGENT_DID_NOT_ESCALATE';
      evidence.failureCode = 'NO_CASE_CREATED';
    }

    if (cases.length > 0) {
      stage('CRM_VERIFICATION');
      if (!externalSessionKey) throw new Error('SERVER_EXTERNAL_SESSION_KEY_NOT_AVAILABLE');
      const selected = cases[0]!;
      evidence.identifiers.caseIdHash = sha(selected.Id);
      if (selected.Correlation_Id__c) {
        evidence.identifiers.caseCorrelationHash = sha(selected.Correlation_Id__c);
      }
      // Start Session inyecta el UUID generado por el servidor como
      // `$Context.RoutableId`. La prueba no deduce otra equivalencia: consulta y
      // compara Case/Log contra ese externalSessionKey exacto.
      const correlationCases = await consultar<CaseRecord>(
        `SELECT Id, CaseNumber, OwnerId, Origin, Status, Description, Correlation_Id__c, CreatedDate
         FROM Case WHERE Correlation_Id__c = '${lit(externalSessionKey)}'`,
        'verificar-escalamiento-agentforce.correlation-cases',
      );
      evidence.after.correlationCases = correlationCases.totalSize;

      const comments = await consultar<CommentRecord>(
        `SELECT Id, ParentId, IsPublished FROM CaseComment
         WHERE ParentId = '${lit(selected.Id)}' ORDER BY CreatedDate ASC`,
        'verificar-escalamiento-agentforce.comments',
      );
      const internal = comments.records.filter((comment) => comment.IsPublished === false);
      evidence.after.internalComments = internal.length;
      evidence.identifiers.internalCommentIdHashes = internal.map((comment) => sha(comment.Id));

      const logs = await consultar<LogRecord>(
        `SELECT Id, Case__c, Correlation_Id__c, Action_Name__c, Outcome__c
         FROM Log_Agente__c WHERE Correlation_Id__c = '${lit(externalSessionKey)}'`,
        'verificar-escalamiento-agentforce.logs',
      );
      evidence.after.correlationLogs = logs.totalSize;
      if (logs.records[0]) evidence.identifiers.logIdHash = sha(logs.records[0].Id);

      evidence.invariants = {
        exactlyOneCaseForMarker: cases.length === 1,
        exactlyOneCaseForCorrelation: correlationCases.totalSize === 1,
        ownerIsConfiguredQueue: selected.OwnerId === QUEUE_ID,
        originIsAgentforce: selected.Origin === 'Agentforce',
        descriptionContainsAuthorizedMarker: selected.Description?.includes(marker) === true,
        correlationPresent: typeof selected.Correlation_Id__c === 'string' && selected.Correlation_Id__c !== '',
        caseCorrelationMatchesExternalSessionKey:
          selected.Correlation_Id__c === externalSessionKey,
        atLeastOneInternalComment: internal.length >= 1,
        exactlyOneCorrelationLog: logs.totalSize === 1,
        logIsSuccess: logs.records[0]?.Outcome__c === 'SUCCESS',
        logActionIsEscalation: logs.records[0]?.Action_Name__c === ACTION_NAME,
        logLinksSameCase: logs.records[0]?.Case__c === selected.Id,
        logUsesServerRoutableIdCorrelation:
          logs.records[0]?.Correlation_Id__c === externalSessionKey,
      };
      if (evidence.outcome === 'RUNNING') {
        const passed = Object.values(evidence.invariants).every(Boolean);
        evidence.outcome = passed ? 'PASS' : 'FAILED_CRM_INVARIANT';
        if (!passed) evidence.failureCode = 'CRM_INVARIANT_FAILED';
      }
    }

    evidence.after.queueAgentforceCases = await count(
      `SELECT COUNT() FROM Case WHERE OwnerId = '${QUEUE_ID}' AND Origin = 'Agentforce'`,
      'verificar-escalamiento-agentforce.after-cases',
    );
    evidence.after.successfulEscalationLogs = await count(
      `SELECT COUNT() FROM Log_Agente__c
       WHERE Action_Name__c = '${ACTION_NAME}' AND Outcome__c = 'SUCCESS'`,
      'verificar-escalamiento-agentforce.after-logs',
    );
    evidence.after.caseDelta =
      evidence.after.queueAgentforceCases - evidence.before.queueAgentforceCases;
    evidence.after.logDelta =
      evidence.after.successfulEscalationLogs - evidence.before.successfulEscalationLogs;

    if (sessionId) {
      stage('CLOSE_SESSION');
      evidence.diagnostics.cleanupAttempted = true;
      const closed = await api('/api/agente/cerrar', { sessionId, motivo: 'UserRequest' });
      evidence.diagnostics.cleanupStatus = closed.status;
      const closedBody = await closed.json() as Record<string, unknown>;
      evidence.conversation.sessionClosed = closedBody.sessionId === sessionId;
      if (!evidence.conversation.sessionClosed) throw new Error('SESSION_CLOSE_NOT_ACKNOWLEDGED');
      sessionId = null;
    }

    stage('COMPLETE');
    persist(evidence);
    console.log(`Escalamiento Agentforce v${TARGET_AGENT_VERSION}: ${evidence.outcome}`);
    console.log(
      `Delta CRM: Case=${evidence.after.caseDelta ?? 'n/a'} ` +
      `CaseCommentInterno=${evidence.after.internalComments} LogSUCCESS=${evidence.after.logDelta ?? 'n/a'}`,
    );
    console.log(`Evidencia sanitizada: ${evidencePath}`);
    return evidence.outcome === 'PASS' && evidence.conversation.sessionClosed ? 0 : 1;
  } catch (error) {
    if (error instanceof LocalAgentEventError) {
      evidence.diagnostics.localApiStatus = error.status;
      evidence.diagnostics.localApiCode = error.code;
      evidence.diagnostics.localApiErrorIdHash = error.errorIdHash;
    }
    evidence.outcome = evidence.outcome === 'RUNNING' ? 'FAILED_TECHNICAL' : evidence.outcome;
    evidence.failureCode ??= error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : `TECHNICAL_AT_${evidence.diagnostics.stage}`;
    persist(evidence);
    console.error(
      `Escalamiento Agentforce v${TARGET_AGENT_VERSION}: ` +
      `${evidence.outcome} (${evidence.failureCode})`,
    );
    console.error(`Evidencia sanitizada: ${evidencePath}`);
    return 1;
  } finally {
    if (sessionId && baseUrl && bearer) {
      evidence.diagnostics.cleanupAttempted = true;
      try {
        const cleanup = await fetch(`${baseUrl}/api/agente/cerrar`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, motivo: 'UserRequest' }),
          signal: AbortSignal.timeout(20_000),
        });
        evidence.diagnostics.cleanupStatus = cleanup.status;
        const raw = await cleanup.text();
        let body: Record<string, unknown> | null = null;
        try {
          const candidate = JSON.parse(raw) as unknown;
          if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            body = candidate as Record<string, unknown>;
          }
        } catch {
          // Nunca se conserva el body de cleanup.
        }
        evidence.conversation.sessionClosed = cleanup.ok && body?.sessionId === sessionId;
        if (!cleanup.ok) {
          const rawCode = typeof body?.codigo === 'string' ? body.codigo : '';
          evidence.diagnostics.cleanupCode = /^[A-Z0-9_]{1,80}$/.test(rawCode)
            ? rawCode
            : 'UNCLASSIFIED_LOCAL_API_ERROR';
          if (typeof body?.errorId === 'string' && body.errorId !== '') {
            evidence.diagnostics.cleanupErrorIdHash = sha(body.errorId);
          }
        }
      } catch {
        // El fallo de cleanup queda representado por sessionClosed=false; no se inventa éxito.
      }
    }
    if (child) await stopServer(child);
    persist(evidence);
  }
}

process.exitCode = await main();
