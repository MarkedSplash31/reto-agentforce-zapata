# Historia git de esta carpeta

Esta carpeta era un repositorio git independiente en `C:\Users\Admin\Desktop\zapata-agentforce`.
Al integrarla en `Workspace definitivo` se retiró su `.git`, porque un repositorio anidado hace
que el padre guarde un puntero vacío en vez de los archivos — es decir, `git add` habría
"añadido" la carpeta sin su contenido.

**No se perdió nada.** La historia completa está en `../zapata-agentforce-historia.bundle`.

Para recuperarla en cualquier momento:

```bash
git clone ../zapata-agentforce-historia.bundle zapata-agentforce-original
```

Contenido del bundle: 1 commit, `e742c18 Modelo de datos completo del Reto Agentforce Zapata`.

## Pendiente de decidir

Existe un segundo proyecto Salesforce DX en `../zapata-dx` que se solapa con éste:

| | esta carpeta | `../zapata-dx` |
|---|---|---|
| Archivos | 329 | 287 |
| Fechas | 30 jul – 2 ago | 3 ago en adelante |
| Tiene `docs/` | sí | no |
| Tiene `specs/` | no | sí |
| Era repo git | sí | no |

Parecen dos generaciones del mismo proyecto. No se fusionaron ni se sobrescribió ninguna:
esa decisión requiere abrir ambas y ver qué versión de cada metadato es la buena.
