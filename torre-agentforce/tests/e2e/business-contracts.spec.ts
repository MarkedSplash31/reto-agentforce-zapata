import { expect, test, type APIRequestContext } from '@playwright/test';
import { authHeaders, credential, missingCredentialReason } from '../support/auth.ts';
import {
  expectDenied,
  expectJson,
  expectNullableNumber,
  expectNullableString,
  expectSalesforceId,
  type JsonObject,
} from '../support/http.ts';

async function getAsAdmin(request: APIRequestContext, path: string, context: string) {
  test.skip(!credential('admin'), missingCredentialReason('admin'));
  const response = await request.get(path, { headers: authHeaders('admin') });
  if (response.status() === 502) {
    const healthResponse = await request.get('/api/admin/salud', { headers: authHeaders('admin') });
    const health = (await healthResponse.json()) as Record<string, unknown>;
    const dependencies = Array.isArray(health.dependencias)
      ? health.dependencias.map((item) => {
          const dependency = item as Record<string, unknown>;
          return {
            nombre: dependency.nombre,
            disponible: dependency.disponible,
            detalle:
              typeof dependency.detalle === 'string' ? dependency.detalle.slice(0, 400) : dependency.detalle,
          };
        })
      : [];
    throw new Error(
      `BLOQUEO SALESFORCE: ${context} respondió 502. Diagnóstico sanitizado: ${JSON.stringify(dependencies)}`,
    );
  }
  return expectJson(response, 200, context);
}

function recordsOf(body: JsonObject, key: string): Array<Record<string, unknown>> {
  expect(Array.isArray(body[key]), `${key}: arreglo`).toBe(true);
  expect(typeof body.total, `${key}: total numérico`).toBe('number');
  expect(Number.isInteger(body.total), `${key}: total entero`).toBe(true);
  const records = body[key] as Array<Record<string, unknown>>;
  expect(body.total as number, `${key}: total cubre los registros devueltos`).toBeGreaterThanOrEqual(
    records.length,
  );
  return records;
}

test.describe('contratos reales de lectura', () => {
  test('unidades conserva relaciones Asset → Product2/Account', async ({ request }) => {
    const body = await getAsAdmin(request, '/api/unidades', 'listar unidades');
    const units = recordsOf(body, 'unidades');
    expect(units.length, 'La org de aceptación debe contener al menos una unidad real').toBeGreaterThan(0);

    for (const [index, unit] of units.slice(0, 10).entries()) {
      expectSalesforceId(unit.Id, `unidades[${index}].Id`);
      expect(typeof unit.Name).toBe('string');
      expectNullableString(unit.SerialNumber, `unidades[${index}].SerialNumber`);
      expectNullableString(unit.Status, `unidades[${index}].Status`);
      expectNullableNumber(unit.Odometro__c, `unidades[${index}].Odometro__c`);
      expect(typeof unit.Dato_Odometro_Vigente__c).toBe('boolean');
      expect(unit).toHaveProperty('Product2');
      expect(unit).toHaveProperty('Account');
      if (unit.Product2 !== null) {
        expect(typeof unit.Product2).toBe('object');
        expectNullableString(
          (unit.Product2 as Record<string, unknown>).Name,
          `unidades[${index}].Product2.Name`,
        );
      }
      if (unit.Account !== null) {
        expect(typeof unit.Account).toBe('object');
        expectNullableString(
          (unit.Account as Record<string, unknown>).Name,
          `unidades[${index}].Account.Name`,
        );
      }
    }
  });

  test('órdenes conserva folio, unidad, sucursal y fechas', async ({ request }) => {
    const body = await getAsAdmin(request, '/api/ordenes', 'listar órdenes');
    const orders = recordsOf(body, 'ordenes');
    expect(orders.length, 'La org de aceptación debe contener órdenes reales').toBeGreaterThan(0);

    for (const [index, order] of orders.slice(0, 10).entries()) {
      expectSalesforceId(order.Id, `ordenes[${index}].Id`);
      expectNullableString(order.WorkOrderNumber, `ordenes[${index}].WorkOrderNumber`);
      expectNullableString(order.Status, `ordenes[${index}].Status`);
      expectNullableString(order.StartDate, `ordenes[${index}].StartDate`);
      expectNullableString(order.EndDate, `ordenes[${index}].EndDate`);
      expect(order).toHaveProperty('Asset');
      expect(order).toHaveProperty('Sucursal__r');
      if (order.Asset !== null) {
        expectNullableString(
          (order.Asset as Record<string, unknown>).Name,
          `ordenes[${index}].Asset.Name`,
        );
        expectNullableString(
          (order.Asset as Record<string, unknown>).SerialNumber,
          `ordenes[${index}].Asset.SerialNumber`,
        );
      }
      if (order.Sucursal__r !== null) {
        expectNullableString(
          (order.Sucursal__r as Record<string, unknown>).Codigo_Sucursal__c,
          `ordenes[${index}].Sucursal__r.Codigo_Sucursal__c`,
        );
      }
    }
  });

  test('agenda exige rango y devuelve slots con capacidad coherente', async ({ request }) => {
    test.skip(!credential('admin'), missingCredentialReason('admin'));
    const missing = await request.get('/api/slots', { headers: authHeaders('admin') });
    const missingBody = await expectJson(missing, 400, 'agenda sin rango');
    expect(missingBody.error).toBe(true);

    const from = process.env.QA_AGENDA_FROM ?? '2026-08-05';
    const to = process.env.QA_AGENDA_TO ?? '2026-08-19';
    const body = await getAsAdmin(
      request,
      `/api/slots?desde=${encodeURIComponent(from)}&hasta=${encodeURIComponent(to)}`,
      'agenda con rango',
    );
    const slots = recordsOf(body, 'slots');
    expect(slots.length, 'El rango de aceptación debe contener slots reales').toBeGreaterThan(0);

    for (const [index, slot] of slots.slice(0, 20).entries()) {
      expectSalesforceId(slot.Id, `slots[${index}].Id`);
      expectNullableString(slot.Inicio__c, `slots[${index}].Inicio__c`);
      expectNullableString(slot.Fin__c, `slots[${index}].Fin__c`);
      expectNullableNumber(slot.Capacidad_Total__c, `slots[${index}].Capacidad_Total__c`);
      expectNullableNumber(slot.Capacidad_Usada__c, `slots[${index}].Capacidad_Usada__c`);
      expectNullableNumber(slot.Cupos_Libres__c, `slots[${index}].Cupos_Libres__c`);
      expect(typeof slot.Disponible__c).toBe('boolean');
      if (
        typeof slot.Capacidad_Total__c === 'number' &&
        typeof slot.Capacidad_Usada__c === 'number' &&
        typeof slot.Cupos_Libres__c === 'number'
      ) {
        expect(slot.Cupos_Libres__c).toBe(
          Math.max(0, slot.Capacidad_Total__c - slot.Capacidad_Usada__c),
        );
      }
    }
  });

  test('varadas conserva seguridad, ubicación, unidad y correlación', async ({ request }) => {
    const body = await getAsAdmin(request, '/api/varadas', 'listar varadas');
    const incidents = recordsOf(body, 'varadas');
    expect(incidents.length, 'La org de aceptación debe contener varadas reales').toBeGreaterThan(0);

    for (const [index, incident] of incidents.slice(0, 10).entries()) {
      expectSalesforceId(incident.Id, `varadas[${index}].Id`);
      expect(typeof incident.Name).toBe('string');
      expectNullableString(incident.Carretera__c, `varadas[${index}].Carretera__c`);
      expectNullableNumber(incident.Kilometro__c, `varadas[${index}].Kilometro__c`);
      expectNullableString(incident.Correlation_Id__c, `varadas[${index}].Correlation_Id__c`);
      expect(incident).toHaveProperty('Asset__r');
    }
  });
});

test.describe('contratos de escritura sin mutación de negocio', () => {
  test('reservar rechaza entrada incompleta antes del Flow', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    const response = await request.post('/api/agenda/reservar', {
      headers: authHeaders('clientA'),
      data: {},
    });
    await expectDenied(response, 400, 'contrato reservar');
  });

  test('reprogramar exige folio, motivo y destino antes del Flow', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    const response = await request.post('/api/agenda/reprogramar', {
      headers: authHeaders('clientA'),
      data: { folio: '', motivo: '' },
    });
    await expectDenied(response, 400, 'contrato reprogramar');
  });

  test('varada exige ubicación, falla y booleanos antes del Flow', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    const response = await request.post('/api/varadas/reportar', {
      headers: authHeaders('clientA'),
      data: { carretera: '', descripcionFalla: '' },
    });
    await expectDenied(response, 400, 'contrato varada');
  });

  test.skip('BLOQUEO DE CLEANUP: mutaciones reales positivas requieren borrado verificable', async () => {
    // BLOQUEO DE CLEANUP: no se crean/reprograman órdenes ni varadas hasta que
    // exista borrado seguro de fixtures aisladas en la misma API bajo prueba.
  });
});
