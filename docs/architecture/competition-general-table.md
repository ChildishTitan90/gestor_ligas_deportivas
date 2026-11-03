# PDGLD-38 — Tabla general (incremento de servidor)

30/10/2026. Sin vistas nuevas. La fase de grupos se documenta por separado en
[distribución](competition-distribution.md); utiliza la misma ruta de formato.

PATCH `/api/competitions/seasons/{id}/categories/{participationId}/format`:
format=GENERAL_TABLE, expectedSeasonVersion y reason. Exige competitions:UPDATE
en el ámbito de la temporada, PLANNED y sin inicio; categoría correspondiente,
versión vigente y ausencia de grupos o solicitudes de afiliación de esa categoría.
No transforma grupos existentes ni reinterpretaciones del historial.

Una transacción cambia el formato, crea General, audita ambas operaciones y
actualiza la versión de la temporada (audit_season). Devuelve id de participación, format, group con
id/name y seasonVersion. Dos escrituras sobre la misma versión tienen un ganador.
No permite volver a LEGACY_GROUPS ni cambiar otra vez el formato desde esta ruta.

La migración `20261029120000_pdgld38_general_table` conserva categorías anteriores
en LEGACY_GROUPS, sin tocar grupos, inscripciones, huellas o operaciones. Añade
competition_format y restricciones diferidas: al confirmar una categoría de tabla
general debe tener exactamente un grupo llamado General. El CRUD de grupos
rechaza agregar, renombrar o eliminar el General administrado automáticamente.

POST de inscripción puede omitir groupId para GENERAL_TABLE: el servidor resuelve
General después de comprobar afiliación y categoría autorizadas. Un grupo ajeno
explícito se rechaza. En LEGACY_GROUPS sigue exigiéndose un grupo válido. El acuse
siempre conserva el UUID real del grupo asignado y REGISTERED; no activa equipos.

La omisión real de groupId se conserva en el cuerpo y la huella de reintento, y
se recupera el resultado confirmado sin regenerar el cuerpo ni la clave. Los
cuerpos legados mantienen exactamente su serialización anterior. La cancelación
usa el mismo cuerpo y evita un envío tardío. La captura del formulario existente
representa la ausencia con una selección vacía, sin inventar un UUID ni alterar el
cuerpo persistido. La selección automática en pantalla queda para PDGLD-95; las
pruebas del recorrido nuevo utilizan HTTP real, no acreditan aceptación visual.

Errores 409: STALE_CONFIGURATION, SEASON_CLOSED, COMPETITION_ALREADY_STARTED,
FORMAT_ALREADY_CONFIGURED, FORMAT_HAS_GROUPS, FORMAT_IN_USE o
GENERAL_GROUP_MANAGED_AUTOMATICALLY. Se mantienen sesión, origen, contrato
estricto, ámbito y respuestas privadas. La consulta de categorías devuelve format.

Migración comprobada solo en bases desechables, sin aplicarla a la base habitual
ni Supabase. Antes de usar estos servicios en un entorno existente, aplicar las
migraciones por el procedimiento del equipo. No usar reset/db push.

El incremento de distribución guarda la categoría independientemente del grupo
y conserva este flujo de tabla general. Siguen pendientes las vistas integradas,
la revisión independiente y los demás criterios de la historia.
