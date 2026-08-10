# Despliegue, rollback y observabilidad

Estado: **artefactos reproducibles listos; no se desplegó a ningún tercero**.

## Destino elegido

La referencia es **Render Web Service con runtime Docker**. La aplicación mantiene
sesiones de Agent API en memoria y conexiones SSE de escalamiento; necesita un proceso
HTTP continuo. Vercel Functions y Netlify Functions no son el encaje natural para
ese estado y esas conexiones persistentes.

Render soporta Dockerfile, monorepos, health checks, secretos `sync: false` y rollback
de despliegues. Fuentes: [Docker en Render](https://render.com/docs/docker),
[monorepos](https://render.com/docs/monorepo-support),
[Blueprint spec](https://render.com/docs/blueprint-spec) y
[health checks](https://render.com/docs/health-checks).

`render.yaml` fija `autoDeployTrigger: off`: conectar el Blueprint no debe publicar
automáticamente cada commit. `plan: starter` es una decisión de producción y puede
generar costo; un humano debe aprobarla antes de crear el servicio.

## Artefacto Docker

El Dockerfile:

- fija Node `22.23.1-bookworm-slim` por digest multi-arquitectura;
- instala dependencias sólo en la etapa `verify`, ejecuta `npm run build:frontend`
  (incluye el CSS de `npm run build:css` y Mermaid local) y bloquea la imagen si
  falla el frontend o TypeScript;
- no lleva `node_modules` al runtime porque la app no tiene dependencias de producción;
- corre como el usuario no-root `node`;
- excluye `.env`, metadata local, evidencia cruda y herramientas de desarrollo;
- declara un `HEALTHCHECK` de liveness sobre `/salud`;
- sirve CSS, fuentes y librerías desde el propio artefacto; producción no depende de
  Tailwind CDN, Google Fonts ni jsDelivr.

### Build y arranque local sin credenciales

Esta prueba valida empaquetado y liveness sin credenciales. Desactiva autenticación
únicamente bajo `APP_ENV=development`; el servidor rechaza esa combinación en
producción.

```bash
node scripts/deploy-verificar.mjs
npm run build:css
npm run build:frontend
docker build --pull -t torre-agentforce:local .
docker run --rm --name torre-agentforce-local -p 3000:3000 \
  -e APP_ENV=development \
  -e APP_AUTH_MODE=disabled \
  -e SF_TOKEN_PROVIDER=client_credentials \
  torre-agentforce:local
```

En otra terminal:

```bash
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:3000/salud
docker inspect --format '{{json .State.Health}}' torre-agentforce-local
```

`/salud` devuelve sólo `status` y `build`: es liveness. La readiness de dependencias
está en `/api/admin/salud`, exige un Bearer de rol `admin` y su campo JSON `ok` debe
ser `true`.

### Arranque end-to-end

La imagen no incluye Salesforce CLI. Dentro de Docker el único proveedor soportado
para producción es `client_credentials`:

```bash
docker run --rm --name torre-agentforce-local -p 3000:3000 \
  --env-file .env \
  -e NODE_ENV=production \
  -e SF_TOKEN_PROVIDER=client_credentials \
  torre-agentforce:local
```

El archivo `.env` se crea localmente, nunca se copia a la imagen y nunca se adjunta a
evidencia. En producción debe incluir `APP_ENV=production`,
`APP_AUTH_MODE=required` y `APP_AUTH_CREDENTIALS_JSON`, además de la ECA. No se pasan
secretos como `ARG` ni como valores visibles en la línea de comando.

`SF_COLA_ESCALAMIENTO_ID` controla la cola funcional y `SF_CASE_QUEUE_ID` la frontera
de autorización para asesores; aunque hoy coincidan, se configuran por separado y
ambas deben ser Queue Id con prefijo `00G`. `APP_TRUST_PROXY` queda vacío hasta que el
host confirme la IP exacta del proxy inmediato: nunca usar `*` o confiar ciegamente
en `X-Forwarded-For`.

## Puertas obligatorias antes de producción

No publicar el servicio mientras falle cualquiera:

1. **ECA:** `Torre Agentforce Zapata` ya está activa con los cuatro scopes oficiales
   (`api`, `refresh_token/offline_access`, `chatbot_api`, `sfap_api`), client
   credentials/JWT y `Run As` con API. Tras rotar la contraseña expuesta, un humano
   debe recuperar el par consumidor y cargarlo sólo en `.env`/secret store; después
   debe pasar el lifecycle real. Ver `BLOQUEOS.md` §0–§1.
2. **Acceso entrante:** la API exige Bearer, RBAC y ownership en producción. Aprobar
   tokens individuales estáticos para una evaluación cerrada o sustituir `AuthProvider`
   por OIDC/JWT corporativo. Probar 401 anónimo, 403 por rol, revocación y ausencia de
   tokens en logs. Ver `BLOQUEOS.md` §2.
3. **Readiness:** `/api/admin/salud` debe devolver JSON con `ok: true` usando rol
   `admin`; la alerta debe inspeccionar ese campo, no sólo HTTP 200.
4. **Agent API:** `npm run verificar:agent-api` debe completar token, sesión, mensaje
   y cierre con evidencia sanitizada.
5. **Datos:** la interfaz y la presentación deben usar las clasificaciones de
   `docs/DATOS-Y-PROVENIENCIA.md`; no llamar reales a pólizas, flota o capacidad
   sintéticas.
6. **Pruebas:** typecheck, pruebas locales de protocolo, rutas y escalamiento deben
   pasar en el commit candidato. Las pruebas contra Salesforce crean datos: usar un
   entorno autorizado y limpiar por folio, nunca contra producción sin aprobación.
7. **Secretos:** cargar `APP_AUTH_CREDENTIALS_JSON`, `SF_CLIENT_ID` y
   `SF_CLIENT_SECRET` en el almacén de secretos del host. Confirmar que no aparecen en
   logs, imagen, build args, historial de shell ni evidencia.
8. **Frontend/CSP:** `npm run build:css` y `npm run build:frontend` deben pasar; el
   artefacto no puede referenciar Tailwind CDN, Google Fonts ni jsDelivr. La CSP
   permite recursos de red sólo desde `'self'`; los scripts/estilos inline siguen
   permitidos temporalmente y son deuda.

## Render: procedimiento manual

1. En Render, crear un Blueprint apuntando al repositorio y seleccionar
   `reto-agentforce/torre-agentforce/render.yaml`.
2. Revisar el costo del plan y mantener `autoDeployTrigger: off`.
3. Capturar `APP_AUTH_CREDENTIALS_JSON`, `SF_CLIENT_ID` y `SF_CLIENT_SECRET` en el
   formulario de secretos; `sync: false` evita versionarlos. Capturar también
   `APP_BUILD_ID` con el SHA completo del commit candidato; no es secreto, pero debe
   actualizarse antes de cada despliegue manual para que `/salud.build` sea trazable.
4. Confirmar `SF_COLA_ESCALAMIENTO_ID` y `SF_CASE_QUEUE_ID`; definir
   `APP_TRUST_PROXY` sólo si Render informa una IP de peer inmediata estable.
5. No lanzar el primer deploy hasta aprobar el proveedor de identidad del punto 2.
6. Desplegar manualmente el commit candidato.
7. Verificar `/`, `/salud`, luego `/api/admin/salud` con `ok: true`; probar 401/403,
   una lectura autorizada, una escritura controlada y su relectura/traza.
8. Registrar commit, digest de imagen, hora UTC, resultado y folio sanitizado en la
   bitácora de release. No copiar respuestas crudas al ticket.

Render toma el Dockerfile y su contexto respecto de `rootDir`, de acuerdo con su
documentación de monorepos. `PORT` lo inyecta la plataforma; no debe fijarse en el
Blueprint.

## Rollback

Condiciones de rollback:

- health check de `/` falla;
- `/api/admin/salud.ok` permanece falso por credencial, REST o cola tras el tiempo acordado;
- aumento sostenido de 401, 403, 429 o 5xx;
- una escritura no puede releerse o queda sin traza correlacionada;
- exposición de secreto o acceso no autorizado;
- protocolo de Agent API deja de ajustarse al contrato.

Procedimiento:

1. Deshabilitar tráfico o activar mantenimiento en el borde de acceso.
2. En Render, seleccionar el último deploy conocido como bueno y ejecutar rollback.
3. Verificar `/`, `/salud` y `/api/admin/salud.ok`; probar una lectura autorizada y la ausencia de nuevas escrituras
   inesperadas.
4. Si hubo exposición de credencial, revocar/rotar el consumer secret antes de volver
   a habilitar tráfico. Un rollback de código no invalida un secreto filtrado.
5. Conservar los registros ya escritos; compensarlos por folio y proceso aprobado, no
   borrarlos a ciegas.
6. Documentar causa, ventana, commit malo/bueno e impacto con datos sanitizados.

La aplicación no tiene base local ni migraciones. El rollback del contenedor no
revierte efectos ya confirmados en Salesforce.

## Observabilidad

### Señales

- **Liveness:** `GET /`, `GET /salud` y `docker inspect .State.Health`.
- **Readiness/dependencias:** `GET /api/admin/salud` con rol `admin`, inspeccionando
  `ok`, `disponible`, `ms` y `pasoQueFalta` por credencial, REST, Agent API y cola.
- **Aplicación:** stdout/stderr del contenedor. Alertar por reinicios y mensajes de
  `ErrorSalesforce`, no por el contenido de negocio.
- **Salesforce:** `Correlation_Id__c` enlaza `Log_Agente__c`, `WorkOrder`, `Case` y
  `Unidad_Varada__c`. Usarlo como clave de diagnóstico; no registrar tokens.
- **SSE:** vigilar eventos `error`/`restablecido` y número de fallos consecutivos.

### Alertas mínimas

- liveness no 2xx durante 60 s;
- `/api/admin/salud.ok=false` durante 5 min;
- cualquier 401/403 repetido tras una renovación de token;
- 429 de Salesforce;
- 5xx de la Torre;
- discrepancia «escritura exitosa pero relectura ausente»;
- reinicios o memoria creciendo con sesiones/SSE sin cerrar.

### Limitaciones actuales

- La autenticación actual usa Bearer estático. Tiene RBAC/ownership y es fail-closed,
  pero no ofrece SSO, MFA ni revocación corporativa por sí sola.
- `/api/admin/salud` hace varias llamadas externas y devuelve el diagnóstico; el
  monitor debe autenticarse sin revelar su token y evaluar el JSON.
- No hay métricas Prometheus/OpenTelemetry ni request id HTTP global.
- La CSP mantiene `'unsafe-inline'` para la UI heredada, aunque las fuentes y
  librerías de red quedan restringidas a `'self'`. Eliminar inline permitiría una CSP
  más fuerte.
- Las sesiones Agent API viven en memoria; una réplica distinta no conoce la sesión.
  Mantener una instancia o añadir afinidad/almacén compartido antes de escalar.
- `SIGTERM`/`SIGINT` dejan de admitir tráfico, responden 503 durante el drenado,
  terminan los SSE locales y esperan solicitudes hasta `APP_SHUTDOWN_TIMEOUT_MS`.
  No cierran sesiones Agent API remotas porque el proceso no puede enumerarlas de
  forma durable; una réplica o afinidad siguen siendo requisito mientras vivan en memoria.
- El sondeo de `CaseComment` cada 2 s no está diseñado para cientos de conversaciones.

Estas limitaciones no invalidan el contenedor local; sí impiden llamarlo operación
production-grade completa hasta resolverlas.
