# QA E2E real

La suite usa Playwright contra el servidor real de la Torre. No sustituye Salesforce,
Agentforce ni los Flows con mocks.

```powershell
npm run test:e2e:install
npm test
```

Sin `BASE_URL`, Playwright levanta un servidor local en `127.0.0.1:3108`, con
credenciales de aplicación desechables y `APP_ENV=test`. La conexión de ese servidor a
Salesforce sigue siendo real y usa la configuración normal del proyecto.

Para una Torre ya desplegada, las credenciales no tienen valores por defecto:

```powershell
$env:BASE_URL='https://torre.example'
$env:QA_CLIENT_A_TOKEN='...'
$env:QA_CLIENT_B_TOKEN='...'
$env:QA_ADVISOR_TOKEN='...'
$env:QA_ADMIN_TOKEN='...'
npm test
```

Si falta una credencial, el gate de roles falla con `BLOQUEO HUMANO` y las pruebas
individuales que la necesitan quedan omitidas; una omisión no constituye aprobación.
Agent API conserva un gate separado, cuyo código de salida no se neutraliza:

```powershell
npm run verificar:agent-api
```

El ciclo sesión → mensaje SSE → cierre sólo corre cuando la sonda real está disponible.

Las pruebas de alta o modificación de órdenes y varadas no se ejecutan porque la Torre
no ofrece una operación de cleanup. Los contratos se comprueban con lecturas reales,
validación rechazada antes de escritura y control de permisos. Habilitar una mutación
sin borrado seguro dejaría basura de negocio en la org.

El único alta real autorizada por esta suite es el escalamiento aislado e idempotente;
queda desactivado por defecto y requiere autorización explícita:

```powershell
$env:RUN_MUTATING_SF_TESTS='1'
npm run test:e2e:mutating
```

No se debe habilitar contra una org sin aceptar que crea un Case QA. Las pruebas de
órdenes, varadas y reprogramación siguen sin mutaciones positivas.

Artefactos: `output/playwright/` (HTML, JSON, JUnit y capturas de fallo). Trazas y video
se mantienen desactivados para evitar que un Bearer real termine serializado.
