import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  authHeaders,
  credential,
  missingCredentialReason,
  type QaCredential,
  type QaRole,
} from '../support/auth.ts';
import { expectDenied, expectJson, type JsonObject } from '../support/http.ts';

const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

function client(role: Extract<QaRole, 'clientA' | 'clientB'>): QaCredential {
  const selected = credential(role);
  test.skip(!selected, missingCredentialReason(role));
  expect(selected?.role).toBe('cliente');
  return selected!;
}

function allBindingIds(selected: QaCredential): string[] {
  return Object.values(selected.bindings ?? {}).flatMap((ids) => ids ?? []);
}

function records(body: JsonObject, key: string): Array<Record<string, unknown>> {
  expect(Array.isArray(body[key]), `${key} debe ser una colección`).toBe(true);
  return body[key] as Array<Record<string, unknown>>;
}

async function unitsFor(request: APIRequestContext, role: Extract<QaRole, 'clientA' | 'clientB'>) {
  const response = await request.get('/api/unidades', { headers: authHeaders(role) });
  return records(await expectJson(response, 200, `unidades ligadas a ${role}`), 'unidades');
}

test.describe('ownership CRM derivado de APP_AUTH_CREDENTIALS_JSON', () => {
  test('cada principal cliente tiene al menos un binding Salesforce explícito y los tenants son distintos', () => {
    const first = client('clientA');
    const second = client('clientB');
    const firstIds = allBindingIds(first);
    const secondIds = allBindingIds(second);

    expect(firstIds.length, 'clientA requiere contact/account/asset/workOrder binding').toBeGreaterThan(0);
    expect(secondIds.length, 'clientB requiere contact/account/asset/workOrder binding').toBeGreaterThan(0);
    for (const id of [...firstIds, ...secondIds]) expect(id).toMatch(SALESFORCE_ID);
    expect(firstIds.some((id) => secondIds.includes(id)), 'los clientes no deben compartir recursos ligados').toBe(false);
  });

  test('las listas de unidades quedan limitadas al Asset binding de cada cliente', async ({ request }) => {
    const first = client('clientA');
    const second = client('clientB');
    const firstAssetIds = first.bindings?.assetIds ?? [];
    const secondAssetIds = second.bindings?.assetIds ?? [];
    test.skip(firstAssetIds.length === 0 || secondAssetIds.length === 0, 'Esta prueba requiere Asset bindings reales.');

    const [firstUnits, secondUnits] = await Promise.all([
      unitsFor(request, 'clientA'),
      unitsFor(request, 'clientB'),
    ]);

    expect(firstUnits.length, 'clientA debe ver al menos uno de sus Assets reales').toBeGreaterThan(0);
    expect(secondUnits.length, 'clientB debe ver al menos uno de sus Assets reales').toBeGreaterThan(0);
    expect(firstUnits.every((unit) => typeof unit.Id === 'string' && firstAssetIds.includes(unit.Id))).toBe(true);
    expect(secondUnits.every((unit) => typeof unit.Id === 'string' && secondAssetIds.includes(unit.Id))).toBe(true);
    expect(firstUnits.some((unit) => secondAssetIds.includes(String(unit.Id)))).toBe(false);
    expect(secondUnits.some((unit) => firstAssetIds.includes(String(unit.Id)))).toBe(false);
  });

  test('la cobertura rechaza en ambos sentidos un Asset ligado al otro cliente', async ({ request }) => {
    const first = client('clientA');
    const second = client('clientB');
    const firstAssetId = first.bindings?.assetIds?.[0];
    const secondAssetId = second.bindings?.assetIds?.[0];
    test.skip(!firstAssetId || !secondAssetId, 'Esta prueba requiere Asset bindings reales para ambos clientes.');

    const [firstReadsSecond, secondReadsFirst] = await Promise.all([
      request.get(`/api/cobertura/${encodeURIComponent(secondAssetId!)}`, { headers: authHeaders('clientA') }),
      request.get(`/api/cobertura/${encodeURIComponent(firstAssetId!)}`, { headers: authHeaders('clientB') }),
    ]);
    await expectDenied(firstReadsSecond, 403, 'clientA → Asset de clientB');
    await expectDenied(secondReadsFirst, 403, 'clientB → Asset de clientA');
  });

  test('las órdenes visibles no pueden referenciar un Asset fuera del scope del cliente', async ({ request }) => {
    for (const role of ['clientA', 'clientB'] as const) {
      const selected = client(role);
      const allowedAssets = selected.bindings?.assetIds ?? [];
      const allowedOrders = selected.bindings?.workOrderIds ?? [];
      const response = await request.get('/api/ordenes', { headers: authHeaders(role) });
      const orders = records(await expectJson(response, 200, `órdenes ligadas a ${role}`), 'ordenes');

      for (const order of orders) {
        const allowedByAsset = typeof order.AssetId === 'string' && allowedAssets.includes(order.AssetId);
        const allowedByOrder = typeof order.Id === 'string' && allowedOrders.includes(order.Id);
        expect(allowedByAsset || allowedByOrder, `${role} recibió una WorkOrder sin binding`).toBe(true);
      }
    }
  });

  test('el acceso sin identidad es 401 y un cliente autenticado sin rol del Agent API recibe 403', async ({ request }) => {
    client('clientA');
    const anonymous = await request.get('/api/unidades');
    await expectDenied(anonymous, 401, 'lista sin identidad');

    const clientAgent = await request.get('/api/agente/estado', { headers: authHeaders('clientA') });
    await expectDenied(clientAgent, 403, 'cliente sin propagación de identidad → Agent API');
  });
});
