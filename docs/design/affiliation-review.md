# Bandeja de revisión — PDGLD-61

Interfaz de Nick conectada al backend PDGLD-60 en esta rama. La página real
consulta el servidor con la sesión vigente; los fixtures solo viven en pruebas.
El contrato del backend está en ../architecture/affiliation-review.md.

## Uso y estados

/affiliations/review conserva el encabezado y los controles de sesión existentes.
Ofrece ligas obtenidas del servidor con READ vigente para la consulta de liga.
Un permiso limitado a un club no abre el listado de toda la liga. No se infieren permisos del rol.
Consultar inicia GET desde el cliente; el Server Component no llama a su API.
La lista contempla carga, vacío, error, 401 y acceso denegado 403. El detalle
se abre dentro de la misma página, con foco en su encabezado. Reutiliza los
tokens, ActionLink y la lista existente, sin dependencias adicionales.

PENDING se presenta separado de AWAITING_REVIEW/CORRECTIONS_REQUESTED.
Pedir correcciones conserva PENDING. Las observaciones previas y la nueva
captura tienen controles separados. El historial muestra correcciones, reenvíos y
aprobación en orden cronológico, con fecha en America/Mexico_City y observaciones
como texto escapado. Una solicitud sin eventos indica que no hay revisiones
registradas. Se retira junto con el detalle ante 401/403. Se presentan los tres
directivos actuales y sus firmas. Cada consulta explícita solicita el endpoint
privado de PDGLD-59; el enlace tiene un máximo de 60 segundos, se retira al vencer,
al cambiar de solicitud o al perder acceso y no se guarda en almacenamiento local.
La descarga abre una pestaña con noopener/noreferrer y referrerPolicy=no-referrer.
Un fallo de Storage no anuncia éxito ni crea un enlace.

La captura exige observaciones no vacías de hasta 2000 caracteres para
correcciones. Aprobar requiere confirmación explícita con club/folio y opción de
cancelar. Durante el envío se bloquean consultas, selección y acciones; el
controlador también impide envíos duplicados. Las acciones proceden de
allowedActions del servidor, calculadas con la misma regla que protege PATCH.
Las solicitudes con correcciones pendientes, temporada cerrada o ya resueltas
no ofrecen nuevas acciones de revisión.

401/403 retiran los datos privados y muestran acceso o denegación.
Los conflictos AFFILIATION_ALREADY_REVIEWED, STALE_AFFILIATION, CORRECTIONS_PENDING
y SEASON_CLOSED provocan consulta del detalle y de la bandeja, sin repetir PATCH.
Ante fallo de red/formato después de una escritura se pide consultar antes de
reenviar. Un fallo de listado o detalle tiene un mensaje de lectura separado.
No hay reintentos automáticos de escrituras ni actualizaciones optimistas.

## Contrato integrado

| Operación | Comportamiento |
| --- | --- |
| GET /api/affiliations?status=PENDING&leagueId=UUID&page=1&pageSize=100 | Respuesta items, page, pageSize, hasMore. El adaptador recorre páginas hasta hasMore=false y rechaza duplicados, páginas incoherentes o mezcla de ligas/estados. No muestra una lista parcial como completa. |
| Resumen | id, leagueId, referenceNumber, clubName, seasonName, status, reviewPhase, version. El nombre anual del club usa el nombre operativo como respaldo para registros antiguos sin captura. |
| GET /api/affiliations/{id} | Añade uniformColors, categories con nombres, observations actuales, allowedActions, officers e history. Cada evento valida id, action, occurredAt ISO y observations. El adaptador conserva solo los campos de presentación del historial. |
| PATCH /api/affiliations/{id}/review | decision, expectedVersion y observations solo para REQUEST_CORRECTIONS. El servidor exige permiso, ámbito, asignación, separación de funciones, estado y versión. |
| Respuesta PATCH | Resumen con el ID, estado/fase de la decisión y versión incrementada. El adaptador valida ese acuse y consulta nuevamente el detalle con permisos vigentes. Un 204 o un simple ok no anuncia éxito. |
| POST /api/affiliations/signatures/download | signatureFileId del detalle autorizado. El servidor vuelve a comprobar READ y contexto antes y después de consultar Storage. La UI valida HTTPS, ruta de firma privada y vigencia máxima de 60 segundos. |

## Captura de correcciones

`/affiliations/new` ofrece las solicitudes propias con correcciones pendientes,
incluso con UPDATE sin CREATE. El enlace abre `/affiliations/{id}/correct`: exige
READ, UPDATE, delegado del club, solicitante original, temporada abierta y fase
de corrección, todo comprobado en servidor. Precarga datos, categorías, motivo,
versión y referencias de las firmas registradas; permite conservarlas o reemplazarlas.

El formulario reutiliza la clave original y envía PATCH /api/affiliations/{id}/resubmit
con expectedVersion. Solo un acuse válido confirma el folio y la nueva versión.
Un 409 obliga a consultar nuevamente sin incrementar la versión ni repetir la
escritura automáticamente. El resultado incierto conserva la captura congelada
y ofrece volver a consultar. No se permite convertir una corrección en un alta nueva.

Ejemplos:

```json
{ "decision": "APPROVE", "expectedVersion": 0 }
```

```json
{ "decision": "REQUEST_CORRECTIONS", "observations": "Precisar colores.", "expectedVersion": 0 }
```

La versión procede del detalle abierto. Ante un conflicto, el usuario revisa
nuevamente antes de confirmar; el cliente no incrementa la versión para reenviar.
Las observaciones se recortan con trim(). APPROVE no envía observations.
No se implementa rechazo definitivo ni se añade REJECTED al modelo de esta vista.
Para un resultado APPROVED, reviewPhase es null.

## Verificación

```sh
npm run test:affiliation-review
npm run test:affiliations
npm run typecheck
npm run lint
```

test:affiliation-review comprueba el controlador, el adaptador y fragmentos HTML
con React server rendering. Sus fixtures son sintéticos, sin rutas de preview ni
fallback de producción. Incluye versión obsoleta, datos privados tras 401/403,
confirmación/cancelación, envío duplicado, respuestas tardías y paginación.
Esta suite se incorporó al job Aplicación de CI; test:ci sigue comprobando
controles de migración.

test:affiliations prueba además el adaptador y controlador de producción contra
HTTP/PostgreSQL locales temporales, incluida carga de la página, correcciones,
reenvío, conflicto de versión y aprobación. Forma parte de test:auth.
Estas pruebas no sustituyen clics, teclado, foco efectivo e hidratación en un
navegador ni la validación del flujo de archivos privados de PDGLD-59.

El 24/10/2026 pasaron 18 pruebas de la bandeja y 24 resultados de integración
(incluidos contenedores de pruebas), sin fallos. El runner detuvo su servidor y
eliminó la base temporal al terminar. Inicialmente se verificó con Node 24.21.0.
Posteriormente, con la versión 24.22.1 LTS autorizada por Víctor, se repitió
test:affiliations: 24 resultados aprobados y cero fallos. El build mantiene el fallo
de creación del proceso CSS de Turbopack; actualizar Node no lo resolvió.

La integración posterior con PDGLD-59 y el recorrido real en navegador se documentan
en [la evidencia de PDGLD-60](../validation/PDGLD-60-integracion-afiliaciones.md).
