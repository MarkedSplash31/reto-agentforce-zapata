#!/usr/bin/env node
// Introspección de esquema contra la org real. No inventa nada: todo sale de /describe.
// Uso: node scripts/describe-objetos.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OBJETOS = [
  'Asset', 'Lectura_Odometro__c', 'Log_Agente__c', 'Modelo_Sucursal__c',
  'Regla_Cobertura__c', 'Sesion_Diagnostico__c', 'Sintoma__c',
  'Slot_Taller__c', 'Unidad_Varada__c', 'WorkOrder', 'Sucursal__c',
  'Case', 'Account', 'Product2', 'Parametros_Garantia__c', 'Exclusion_Garantia__c',
];

const API = 'v67.0';

function token() {
  const out = execFileSync('sf', ['org', 'auth', 'show-access-token', '-o', 'zapata', '--json'], {
    encoding: 'utf8', shell: true,
  });
  return JSON.parse(out).result.accessToken;
}

function instanceUrl() {
  const out = execFileSync('sf', ['org', 'display', '--target-org', 'zapata', '--json'], {
    encoding: 'utf8', shell: true,
  });
  return JSON.parse(out).result.instanceUrl;
}

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '05-esquema');
mkdirSync(dir, { recursive: true });

const T = token();
const URL_BASE = instanceUrl();
const resumen = {};

for (const obj of OBJETOS) {
  const res = await fetch(`${URL_BASE}/services/data/${API}/sobjects/${obj}/describe`, {
    headers: { Authorization: `Bearer ${T}` },
  });
  if (!res.ok) {
    resumen[obj] = { error: `HTTP ${res.status}` };
    console.log(`${obj.padEnd(26)} HTTP ${res.status}`);
    continue;
  }
  const d = await res.json();
  writeFileSync(join(dir, `describe-${obj}.${ts}.json`), JSON.stringify(d, null, 1));
  const campos = d.fields.map((f) => ({
    name: f.name,
    type: f.type,
    calculated: f.calculated,
    nillable: f.nillable,
    picklist: (f.picklistValues || []).filter((p) => p.active).map((p) => p.value),
    refTo: f.referenceTo,
  }));
  resumen[obj] = {
    label: d.label,
    createable: d.createable,
    updateable: d.updateable,
    queryable: d.queryable,
    campos,
  };
  console.log(`${obj.padEnd(26)} ${String(campos.length).padStart(3)} campos  C=${d.createable} U=${d.updateable}`);
}

writeFileSync(join(dir, `resumen-esquema.${ts}.json`), JSON.stringify(resumen, null, 1));
console.log(`\nEsquema en evidencia/05-esquema/resumen-esquema.${ts}.json`);
