# Evidencia sanitizada

Fecha de auditoría: **5 de agosto de 2026**.

## Qué se puede compartir

Este documento es la superficie compartible. La carpeta `evidencia/` es evidencia de
trabajo cruda y queda excluida de la imagen Docker. No debe adjuntarse completa a un
ticket, demo pública ni artefacto de release.

La evidencia aceptable para un release contiene sólo:

- commit y digest de imagen;
- hora UTC y entorno no secreto;
- nombre del check, PASS/FAIL y duración;
- conteos agregados;
- códigos HTTP y `errorCode` sin cuerpos libres;
- un folio reemplazado por un hash o alias efímero;
- resultado de relectura expresado como booleano;
- lista de dependencias disponible/no disponible sin URL privada, usuario o token.

## Auditoría léxica de la evidencia cruda

Se escanearon nombres y contenidos, sin leer `.env`. Resultado por número de archivos
con al menos una coincidencia:

| Patrón | Archivos | Decisión |
|---|---:|---|
| literal `access_token` | 0 | No detectado por este chequeo |
| literal `Bearer ` | 0 | No detectado por este chequeo |
| palabra `Authorization` | 12 | Puede ser nombre de header/metadata; no publicar sin revisión |
| palabra `client_secret` | 0 | No detectado por este chequeo |
| forma de correo | 19 | Redactar, aunque pertenezca a usuario de prueba |
| forma de VIN de 17 caracteres | 30 | Redactar; son sintéticos, pero funcionan como identificadores |
| forma de Salesforce Id | 116 | Sustituir por alias cuando no sea indispensable |

Esto es un detector de patrones, no una garantía criptográfica de ausencia de
secretos. Antes de publicar, una persona debe revisar el archivo sanitizado final.

## Resultado compartible de esta entrega

| Control | Resultado |
|---|---|
| Secretos leídos desde `.env` | **No** |
| Despliegue a tercero | **No ejecutado** |
| Gasto o recurso cloud creado | **No** |
| `.env`, metadata local y evidencia cruda en contexto Docker | **Excluidos** |
| Consumer key/secret en `render.yaml` | **No; `sync: false`** |
| Usuario del contenedor | **No-root (`node`)** |
| Imagen base | **Node 22.23.1 fijada por digest multi-arquitectura** |
| Build local | **PASS**: frontend local + TypeScript dentro de la etapa `verify` |
| Imagen local | `sha256:83072040dc0c5e037093d4bf1e2a7faa9ab4bf0ec4fca274d95dffb04c87bdf7` (identificador local, no digest de registry) |
| Assets en runtime | **PASS**: CSS local y Mermaid local de 3,566,058 bytes; sin `node_modules` |
| Liveness del contenedor | **PASS** a `2026-08-06T01:19Z`: `/salud` 200, `status=ok`, usuario `node`, Docker `healthy` |
| Fail-closed de producción | **PASS**: sin `APP_AUTH_CREDENTIALS_JSON` el proceso termina con código 1 |
| Readiness Salesforce | ECA activa; no publicar hasta custodiar sus secretos y que `/api/admin/salud` devuelva `ok=true` |

La prueba final publicó temporalmente el contenedor en `127.0.0.1:3023`. Se detuvo y
eliminó al terminar. No se le entregaron consumer key, consumer secret ni token
Salesforce.

La corrida candidata terminó con **32/32 pruebas unitarias** y **50/50 E2E ejecutadas**
en verde. Playwright dejó **3 skips explícitos**: lifecycle Agent API sin credenciales
ECA, mutaciones positivas de orden/varada sin cleanup aprobado y una nueva mutación de
escalamiento que duplicaría evidencia persistente. `npm run verificar:diseno` reportó
0 violaciones en las 9 páginas, `npm audit --audit-level=high` 0 vulnerabilidades y
`node scripts/deploy-verificar.mjs` PASS. Un skip no se presenta como integración
exitosa.

## Plantilla para una corrida

```text
release_commit: <sha>
image_digest: sha256:<digest>
timestamp_utc: <ISO-8601>
environment: <dev|staging|production>
checks:
  typecheck: <PASS|FAIL>
  deploy_contract: <PASS|FAIL>
  container_liveness: <PASS|FAIL>
  readiness_all_dependencies: <PASS|FAIL>
  agent_api_cycle: <PASS|FAIL|BLOCKED>
  controlled_write_reread: <PASS|FAIL|NOT_RUN>
correlation_alias: <sha256 truncado; nunca el folio crudo>
notes: <sin nombres, correos, VIN, ids, mensajes ni secretos>
```

## Redacción obligatoria

- Reemplazar email por `[EMAIL]`.
- Reemplazar VIN por `[VIN]`.
- Reemplazar Id de Salesforce por un alias estable dentro del reporte (`[ASSET-1]`,
  `[CASE-1]`), no por los últimos caracteres.
- No copiar `CommentBody`, síntomas, descripciones, asuntos ni cuerpos OAuth.
- No incluir `Authorization`, cookies, consumer key, consumer secret ni tokens, ni
  siquiera truncados.
- Mantener códigos HTTP, `errorCode`, nombres de operación y tiempos.

Los datos son mayormente sintéticos, pero sanitizarlos sigue siendo necesario: un
artefacto público no debe enseñar estructuras de identificadores, usuarios internos
ni detalles que luego se confundan con datos productivos.
