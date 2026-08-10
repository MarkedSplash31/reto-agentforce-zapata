import { expect, type APIResponse } from '@playwright/test';
import { configuredTokens } from './auth.ts';

export type JsonObject = Record<string, unknown>;

function safeExcerpt(raw: string): string {
  let value = raw;
  for (const token of configuredTokens()) value = value.replaceAll(token, '[REDACTED_APP_TOKEN]');
  return value
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, '[REDACTED_VIN]')
    .slice(0, 500);
}

export async function expectStatus(
  response: APIResponse,
  status: number,
  context: string,
): Promise<void> {
  const raw = await response.text();
  expect(
    response.status(),
    `${context}: se esperaba HTTP ${status}; cuerpo sanitizado: ${safeExcerpt(raw)}`,
  ).toBe(status);
}

export async function expectJson(
  response: APIResponse,
  status: number,
  context: string,
): Promise<JsonObject> {
  const raw = await response.text();
  expect(
    response.status(),
    `${context}: se esperaba HTTP ${status}; cuerpo sanitizado: ${safeExcerpt(raw)}`,
  ).toBe(status);
  expect(response.headers()['content-type'], `${context}: Content-Type`).toMatch(
    /^application\/json\b/i,
  );

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${context}: respuesta no JSON: ${safeExcerpt(raw)}`);
  }
  expect(value, `${context}: el cuerpo debe ser un objeto`).not.toBeNull();
  expect(Array.isArray(value), `${context}: el cuerpo no debe ser un arreglo raíz`).toBe(false);
  expect(typeof value, `${context}: el cuerpo debe ser un objeto`).toBe('object');
  return value as JsonObject;
}

export async function expectDenied(
  response: APIResponse,
  status: 400 | 401 | 403 | 408 | 413 | 415 | 429,
  context: string,
): Promise<JsonObject> {
  const body = await expectJson(response, status, context);
  expect(body.error, `${context}: marca error`).toBe(true);
  expect(typeof (body.code ?? body.codigo), `${context}: código estable`).toBe('string');
  expect(typeof body.errorId, `${context}: errorId para correlación`).toBe('string');
  return body;
}

export function expectNoCredentialLeak(raw: string, extraSecrets: string[] = []): void {
  for (const secret of [...configuredTokens(), ...extraSecrets]) {
    if (secret) expect(raw, 'La respuesta no debe reflejar credenciales').not.toContain(secret);
  }
  expect(raw).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]{12,}/i);
  expect(raw).not.toMatch(/"(?:clientSecret|access_token|refresh_token|authorization)"\s*:/i);
}

export function expectSalesforceId(value: unknown, label: string): asserts value is string {
  expect(typeof value, `${label}: tipo`).toBe('string');
  expect(value as string, `${label}: formato Salesforce`).toMatch(/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/);
}

export function expectNullableString(value: unknown, label: string): void {
  expect(value === null || typeof value === 'string', `${label}: string|null`).toBe(true);
}

export function expectNullableNumber(value: unknown, label: string): void {
  expect(value === null || (typeof value === 'number' && Number.isFinite(value)), `${label}: number|null`).toBe(true);
}
