# Seguridad del backend

La aplicación sólo consume `process.env`. `npm start` permite cargar un `.env` local
si existe; en producción la configuración llega del runtime, gestor de secretos o
plataforma de despliegue y no depende de ese archivo.
No hay secretos de aplicacion embebidos en el repositorio.

## Variables

| Variable | Default | Uso |
| --- | --- | --- |
| `APP_ENV` | `NODE_ENV` o `production` | Entorno efectivo. `production` activa las validaciones mas estrictas. |
| `APP_AUTH_MODE` | `required` | `required` o `disabled`. `disabled` esta prohibido en produccion y debe declararse explicitamente. |
| `APP_AUTH_CREDENTIALS_JSON` | ninguno | Arreglo JSON de `{ "id", "role", "token" }`. Es obligatorio con auth requerida. Roles: `cliente`, `asesor`, `admin`. Cada token debe tener 32-512 bytes y ser unico. |
| `APP_CORS_ORIGINS` | vacio | Origins cross-origin exactos separados por coma. En produccion solo se admite HTTPS. Vacio mantiene acceso same-origin. |
| `APP_TRUST_PROXY` | vacio | IPs exactas de proxies confiables, separadas por coma. Solo sus conexiones pueden aportar `X-Forwarded-For`. No acepta `*` ni booleanos. |
| `APP_RATE_LIMIT_WINDOW_MS` | `60000` | Ventana del limitador por principal/IP. |
| `APP_RATE_LIMIT_MAX` | `120` | Solicitudes autenticadas maximas por ventana. |
| `APP_AUTH_RATE_LIMIT_MAX` | `20` | Intentos fallidos de auth maximos por IP/ventana. |
| `APP_BODY_LIMIT_BYTES` | `65536` | Maximo de JSON entrante; rango permitido 1 KiB-1 MiB. |
| `APP_REQUEST_TIMEOUT_MS` | `30000` | Tiempo maximo para recibir headers/cuerpo HTTP. |
| `APP_SHUTDOWN_TIMEOUT_MS` | `10000` | Ventana de drenado antes de abortar sockets locales. |
| `SF_REQUEST_TIMEOUT_MS` | `20000` | Timeout para OAuth y REST/Flow de Salesforce. |
| `SF_CLI_TIMEOUT_MS` | `30000` | Timeout separado del `sf` CLI para tolerar su cold start; rango 5-120 segundos. |
| `AGENT_API_TIMEOUT_MS` | `30000` | Timeout base de Agent API; el stream conserva ademas su guardia de inactividad. |
| `APP_BUILD_ID` | version del paquete o `unknown` | Identificador no sensible mostrado por `/salud`. |
| `SF_CASE_QUEUE_ID` | `00GgK00000BMTaVUAX` | Queue `OwnerId` que autoriza a asesores a consultar un Case no creado por Torre. Debe ser un Id Salesforce valido. |

En produccion `SF_TOKEN_PROVIDER` usa `client_credentials` por defecto y `cli` se
rechaza. Los origins `SF_LOGIN_URL` y `SF_AGENT_API_HOST` deben ser HTTPS exactos;
los IDs, version API, puerto y alias CLI se validan antes de abrir el socket.

Ejemplo de forma, con valores deliberadamente no utilizables:

```text
APP_ENV=production
APP_AUTH_MODE=required
APP_AUTH_CREDENTIALS_JSON=[{"id":"cliente-demo","role":"cliente","token":"GENERAR_EN_EL_GESTOR_DE_SECRETOS_MIN_32_BYTES"}]
APP_CORS_ORIGINS=https://portal.example.com
```

No se debe copiar el ejemplo como credencial. Genere tokens aleatorios en el gestor
de secretos, suministrelos al backend en runtime y rotelos fuera de Git.

## Contrato HTTP

- `/salud` es publico y solo devuelve `status` y `build` para healthchecks.
- `/api/admin/salud` expone el diagnostico de dependencias y requiere `admin`.
- Todas las rutas `/api/**` exigen `Authorization: Bearer <token>`.
- Los tokens en query string no se aceptan. Los streams SSE deben consumirse con
  `fetch`/`ReadableStream`, no con `EventSource` si este impide enviar el header.
- `401` significa credencial ausente/invalida; `403`, rol u ownership insuficiente;
  `413`, body excesivo; `415`, media type/codificacion no permitida; `429`, limite
  excedido (incluye `Retry-After`). Los fallos publicos llevan `errorId` y no cuerpos,
  URLs, tokens ni PII del upstream.
- Los archivos bajo `publico/datos/` no se sirven como estaticos; deben pasar por
  una ruta API con RBAC.

## RBAC y ownership

- `cliente`: acciones de atencion, agenda y varada; sesiones Agent API propias;
  apertura y acceso a sus casos creados en este proceso.
- `asesor`: lecturas operativas y bandeja. Solo puede abrir/responder/sondear un Case
  creado y bound por esta Torre o cuyo `OwnerId` actual coincida con
  `SF_CASE_QUEUE_ID`; los streams revalidan ese Owner periodicamente y se cierran si
  cambia. No puede usar sesiones Agent API de clientes.
- `admin`: diagnostico y superficies administrativas; puede recuperar recursos para
  soporte operativo.

El servidor ignora el `autor` que llegue al responder un caso y lo deriva del rol.
Tambien genera `externalSessionKey` en servidor para que el navegador no escriba PII
en event logs de Agentforce.

La tabla de ownership es deliberadamente in-memory porque esta aplicacion no posee una
base de datos. Tras reiniciar, un `cliente` no puede reabrir por ID un caso anterior;
un `asesor` o `admin` si puede recuperarlo desde Salesforce. Para continuidad de
clientes en despliegues multi-instancia se necesita un ownership durable verificado
por Salesforce o un store compartido.

## Limite de la autenticacion estatica

`StaticTokenAuthProvider` es una linea base de acceso de servicio/evaluacion, no un
sustituto de identidad individual con login, baja de usuarios, MFA y claims firmados.
La interfaz `AuthProvider` es el seam previsto para OIDC/JWT. Antes de uso abierto a
clientes reales se debe implementar ese proveedor y derivar `Principal.id`/`role` de
claims verificados, manteniendo RBAC y ownership sin cambios.

Por defecto el backend no confia en `X-Forwarded-For`; el rate limit usa la direccion del socket.
Si `APP_TRUST_PROXY` enumera la IP exacta del peer inmediato, el backend recorre XFF
desde la derecha, descarta saltos tambien confiables y usa el primer cliente no
confiable. Una IP de proxy mal configurada permite falsificar la clave de rate limit;
el default vacio ignora XFF. El limitador sigue siendo in-memory: un despliegue
multi-instancia requiere un store distribuido o enforcement adicional en el proxy.
