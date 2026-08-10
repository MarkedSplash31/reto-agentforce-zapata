export type QaRole = 'clientA' | 'clientB' | 'advisor' | 'admin';

export interface QaCredential {
  id: string;
  role: 'cliente' | 'asesor' | 'admin';
  token: string;
  bindings?: {
    contactIds?: string[];
    accountIds?: string[];
    assetIds?: string[];
    workOrderIds?: string[];
  };
}

export const LOCAL_BASE_URL = `http://127.0.0.1:${process.env.QA_PORT ?? '3108'}`;

/**
 * Credenciales desechables para el servidor que Playwright levanta en APP_ENV=test.
 * No sirven fuera de ese proceso y nunca deben copiarse a un despliegue.
 */
export const LOCAL_CREDENTIALS: Record<QaRole, QaCredential> = {
  clientA: {
    id: 'qa-client-a',
    role: 'cliente',
    token: 'qa-client-a-local-only-20260805-token',
    bindings: { assetIds: ['02igK000002QPUfQAO'] },
  },
  clientB: {
    id: 'qa-client-b',
    role: 'cliente',
    token: 'qa-client-b-local-only-20260805-token',
    bindings: { assetIds: ['02igK000002QPUgQAO'] },
  },
  advisor: {
    id: 'qa-advisor',
    role: 'asesor',
    token: 'qa-advisor-local-only-20260805-token',
  },
  admin: {
    id: 'qa-admin',
    role: 'admin',
    token: 'qa-admin-local-only-20260805-token',
  },
};

const REMOTE_TOKEN_ENV: Record<QaRole, string> = {
  clientA: 'QA_CLIENT_A_TOKEN',
  clientB: 'QA_CLIENT_B_TOKEN',
  advisor: 'QA_ADVISOR_TOKEN',
  admin: 'QA_ADMIN_TOKEN',
};

export const IS_REMOTE = Boolean(process.env.BASE_URL?.trim());

export function credential(role: QaRole): QaCredential | null {
  if (!IS_REMOTE) return LOCAL_CREDENTIALS[role];
  const token = process.env[REMOTE_TOKEN_ENV[role]]?.trim();
  if (!token) return null;
  return { ...LOCAL_CREDENTIALS[role], token };
}

export function authHeaders(role: QaRole): Record<string, string> {
  const selected = credential(role);
  return selected ? { Authorization: `Bearer ${selected.token}` } : {};
}

export function missingCredentialReason(role: QaRole): string {
  return `BLOQUEO HUMANO: falta ${REMOTE_TOKEN_ENV[role]} para probar ${role} contra BASE_URL.`;
}

export function configuredTokens(): string[] {
  return (Object.keys(LOCAL_CREDENTIALS) as QaRole[])
    .map((role) => credential(role)?.token)
    .filter((token): token is string => Boolean(token));
}
