# Bandeja de revisión — PDGLD-61

Implementación de interfaz sobre las rutas acordadas de PDGLD-60. El backend de
consulta/revisión todavía no está implementado en este checkout: la ruta actual
`/api/affiliations` solo admite POST de solicitudes. La bandeja real no usa fixtures.
Un endpoint ausente o una respuesta incompatible muestra error y bloquea acciones.
No se anuncia una aprobación/corrección antes de validar una respuesta real del
PATCH con el resultado correspondiente.

## Uso y estados

`/affiliations/review` conserva el encabezado y los controles de sesión existentes.
Por ahora solicita el UUID de una liga autorizada: no inventa un catálogo de ligas
ni deriva autorización de los nombres de roles. Sergio debe confirmar cómo obtener
las opciones de liga filtradas antes de sustituir este campo por un selector.
Consultar inicia el GET desde el cliente; el Server Component no llama a su API.
La lista tiene estados de carga, vacío, error, 401 y acceso denegado 403. El detalle
se abre dentro de la misma página, con foco en su encabezado. Reutiliza los tokens,
ActionLink y la lista existente; no incorpora componentes o dependencias externas.

El estado de aprobación `PENDING` se muestra separado de la fase
`AWAITING_REVIEW` o `CORRECTIONS_REQUESTED`. Pedir correcciones conserva PENDING.
Las observaciones previas y la nueva captura tienen controles separados. No se
incluyen CURP, correos ni datos personales de directivos en este modelo mínimo.
La captura exige observaciones no vacías para correcciones. Aprobar requiere una
confirmación explícita con club/folio y opción de cancelar. Durante el envío se
bloquean consultas, cambios de selección y ambas acciones; el controlador también
impide doble envío. Las acciones dependen de las capacidades devueltas por el
servidor y se bloquean para solicitudes ya resueltas; esto no autoriza operaciones.

401 retira los datos y ofrece login. 403 retira los datos y muestra acceso denegado.
409 con `AFFILIATION_ALREADY_REVIEWED` informa el conflicto y vuelve a consultar
el detalle y la bandeja; no repite PATCH. Si la actualización falla, se bloquean
acciones y se ofrece consultar de nuevo. Ante error de red o formato después de
PATCH no se supone rollback: se pide consultar antes de reenviar. Esa advertencia
solo se muestra para un PATCH cuyo resultado no pudo confirmarse. Los fallos de
listado muestran «No se pudieron cargar las solicitudes. Intenta consultar
nuevamente.»; el detalle tiene un mensaje de lectura separado. Un fallo al
refrescar la bandeja tras un PATCH confirmado, o al reconsultar tras 409, no se
presenta como un envío incierto. No hay reintentos
automáticos de escrituras ni actualizaciones optimistas.

## Contrato confirmado con Sergio

Las rutas acordadas son GET `/api/affiliations?status=PENDING&leagueId=UUID`,
GET `/api/affiliations/{id}` y PATCH `/api/affiliations/{id}/review`.
El cuerpo del PATCH está confirmado y se envía exactamente así:

```json
{ "decision": "APPROVE" }
```

```json
{ "decision": "REQUEST_CORRECTIONS", "observations": "texto" }
```

Al aprobar no se envían `action` ni `observations`, incluso si hay texto capturado.
En correcciones se envían observaciones no vacías, recortadas con `trim()`.
Las únicas decisiones de este alcance son APPROVE y REQUEST_CORRECTIONS.
REJECTED no es una transición autorizada ni un requisito acordado para PDGLD-61;
no hay acción de rechazo y el adaptador no la incorpora al modelo de esta interfaz.

## Modelo provisional: confirmar con Sergio

`affiliation-review-model.ts` describe solo presentación. El único adaptador HTTP
es `affiliation-review-adapter.ts`, con validación de respuestas desconocidas y
selección explícita de campos. **Los modelos de respuesta no son un contrato definitivo de PDGLD-60.**
El cuerpo PATCH confirmado se documenta por separado arriba.

Supuestos actuales pendientes de confirmar:

| Operación/campo | Supuesto provisional |
| --- | --- |
| GET `/api/affiliations?status=PENDING&leagueId=UUID` | Respuesta `{ items: ReviewSummary[] }`, colección completa; falta acordar paginación y totales. No se admite mezclar ligas ni estados. |
| Resumen | `id`, `leagueId`, `referenceNumber`, `clubName`, `seasonName` (strings; IDs UUID). Confirmar nombres, envoltorios y origen del nombre del club. |
| Estados | `status`: PENDING/APPROVED; `reviewPhase`: AWAITING_REVIEW/CORRECTIONS_REQUESTED o null para un resultado resuelto. PENDING exige fase explícita. |
| GET `/api/affiliations/{id}` | Objeto directo de detalle, con los campos del resumen. |
| Detalle | `uniformColors: string`, `categories: string[]` de nombres y `observations: string \| null`. Confirmar observaciones actuales frente a historial, categorías y datos/documentos adicionales que el revisor necesite. |
| Capacidades | `allowedActions: (APPROVE \| REQUEST_CORRECTIONS)[]`, calculadas por el servidor. Ausencia/formato incorrecto bloquea la integración; nunca inferir capacidades de SECRETARY. |
| Límites y concurrencia del PATCH | Confirmar longitud máxima de observaciones y mecanismo de versión si procede, conservando el cuerpo confirmado. |
| Confirmación PATCH | Respuesta de detalle con mismo ID/liga y APPROVED para aprobar, o PENDING + CORRECTIONS_REQUESTED para correcciones. Confirmar si el servidor devolverá ese DTO u otro acuse y GET posterior. Un 204 o `{ok:true}` no produce éxito con este adaptador. |
| Errores | 401, 403 y 409 `{code:"AFFILIATION_ALREADY_REVIEWED"}`. Confirmar errores de validación, sesión con cambio obligatorio, no encontrado y reglas de transición PDGLD-60. |

El motor y las reglas de PDGLD-60 deben comprobar identidad, permisos, alcance,
estado y concurrencia en cada operación. Una capacidad presentada, un UUID de liga
o una concesión configurada no sustituye esas comprobaciones. No se modificó ese
backend ni se añadieron permisos, endpoints o migraciones.

## Verificación sin base ni servicios

```sh
npm run test:affiliation-review
npm run typecheck
npm run lint
```

Los fixtures sintéticos están únicamente en `affiliation-review.test.tsx`, sin ruta
preview ni fallback de producción. Las pruebas de interacción ejercitan el mismo
controlador usado por la vista (consultar/seleccionar/observar/confirmar/cancelar,
concurrencia de envío y respuestas tardías), el adaptador HTTP y fragmentos del HTML
mediante React server rendering. Son llamadas a métodos del controlador, no clics
ni eventos DOM. No verifican foco efectivo, teclado, hidratación ni accesibilidad
en un navegador. No son pruebas de navegador ni de integración con
PDGLD-60. No hacen peticiones reales ni escriben en la base. El comando no está
incorporado a CI por este ticket; no afirmar que `test:ci` ejecuta esta suite.
