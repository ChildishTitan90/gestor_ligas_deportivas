# PDGLD-29 / PDGLD-150 — Cálculo interno de clasificación

20 de noviembre de 2026. Entrega del motor y contrato de servidor; la pantalla corresponde a PDGLD-151. No constituye aceptación completa de PDGLD-29.

## Evidencia y decisiones

Se leyeron PDGLD-29 y su comentario 10014, PDGLD-150/151/152 y PV-06 (PDGLD-70, comentario 10020). El default 1–0, 3 puntos al presentado y 0 al infractor permanece vigente en la historia. La convocatoria histórica enumera gol average, goles a favor y ganador del juego, pero su interpretación está pendiente en PV-06. DG sigue siendo GF−GC; no se usa como interpretación de gol average.

No se localizó el PDF completo vigente del ERS: Confluence no devolvió coincidencias y Drive solo expuso `ERS_Gestor_Ligas_Deportivas_IEEE830`, versión preliminar 0.1 de octubre, con RF01–05 y numeración insuficiente para contrastar RF07–09. No se afirma haber verificado el ERS completo. Referencias: [historia](https://victoranhernandez.atlassian.net/browse/PDGLD-29), [PV-06](https://victoranhernandez.atlassian.net/browse/PDGLD-70), [preliminar accesible](https://docs.google.com/document/d/1iJRdP4IOxhM__ft8X_y5gWOeOOflszzZcCvfqr4ckPU/edit).

El código existente de PDGLD-38 conserva parámetros JSON `points` y `tieBreakers`, aprobación explícita y vínculo por `season_categories.competition_rule_id`. No hay un catálogo cerrado de desempates: aprobar una cadena no implementa su algoritmo. El cálculo soporta identificadores exactos POINTS, GOAL_DIFFERENCE, GOALS_FOR y WINS cuando figuran en la versión aprobada; no selecciona ejemplos de documentación como defaults. Parte por puntos, luego aplica los criterios en el orden guardado. Una cadena desconocida detiene la resolución del subconjunto empatado; no salta a criterios posteriores. Un empate definitivo queda pendiente, sin sorteo, identificador o nombre como desempate oficial.

## Contrato y versión

`calculateGroupStandings({ groupId, matchdayId })` toma identidad de servidor. `getGroupStandings` consulta versiones de ese corte y reglamento actualmente vinculado, en orden descendente. Las variantes `ForActor` son exclusivamente para consumidores internos con identidad ya obtenida en servidor; no son Server Actions ni endpoints. Las lecturas exigen `competitions:READ`; la materialización independiente exige `competitions:UPDATE` en la temporada real. No modifica concesiones ni concede escritura a Secretaría, que conserva lectura en RF22. No se crean rutas públicas ni se habilita validación oficial.

El corte acumula jornadas por `matchdays.number <= corte` dentro del mismo grupo/temporada. Cada versión fija equipos, resultados identificados por ID/versión/origen, configuración, eventos identificados por cédula/versión/partido y filas calculadas. Una huella SHA-256 del contenido permite reutilizar la última versión si sus insumos coinciden. Una corrección crea otra versión; volver a insumos anteriores también crea otra versión si hubo un cálculo intermedio. El número crece por grupo/jornada, incluso al cambiar reglamento. Se conserva el historial, sin sumar deltas ni modificar versiones anteriores.

Se incluyen los equipos del grupo aunque no tengan encuentros. Bajas y efectos retroactivos no se infieren del estado actual del equipo: requieren resultados/efectos autorizados conforme PV-06. No se aplican ajustes de puntos inventados; `points_adjustment` conserva cero en estas versiones.

## Elegibilidad de resultados

Siempre se requiere `counts_in_standings=true`, partido no eliminado y equipos pertenecientes al grupo:

| Origen | Estado exigido | Evidencia adicional |
| --- | --- | --- |
| MATCH_REPORT | FINISHED | Cédula CONFIRMED |
| DEFAULT | NO_SHOW o ADMINISTRATIVELY_RESOLVED | Infractor local o visitante, marcador administrativo coherente |
| ADMINISTRATIVE | ADMINISTRATIVELY_RESOLVED | Resultado validado en `match_results` |

Es una política conservadora del adaptador a los estados existentes, pendiente de revisión conjunta con PDGLD-85. IN_PROGRESS, UNDER_REVIEW, SUSPENDED y CANCELED no suman aunque exista un resultado. El productor de resultados debe registrar el default 1–0 o 0–1 según el infractor. El motor rechaza un marcador incoherente; no corrige silenciosamente la fuente. El default aporta GF/GC y puntos fijos 3/0, independientemente de la puntuación ordinaria configurada. No produce eventos GOAL ni goleadores administrativos.

## Estadísticas y procedencia

Los goles de tabla proceden del marcador oficial. Los conteos de eventos proceden únicamente de cédulas confirmadas asociadas a resultados elegibles, conservando también MOBILE/PAPER y el origen del resultado. Un default o resolución administrativa puede conservar eventos reales sin convertir su marcador en goles de jugador. Se conservan IDs y versión de origen. GOAL, OWN_GOAL, CAUTION y SENDING_OFF se distinguen; la segunda amonestación por jugador/partido produce un indicador de expulsión por doble amarilla, separado de expulsiones directas. Un autogol no se acredita al goleador contrario. Eventos sin jugador/equipo se conservan como no atribuibles.

`observed*` y los conteos por jugador indican evidencia observada. Cero observado significa exactamente que no hay ese evento en el conjunto; `officialGoals`, `officialCautions` y `officialDismissals` permanecen null y `completeness=UNKNOWN` porque el contrato actual no certifica captura completa de esos indicadores. Un marcador administrativo no acredita tarjetas cero. No se confunde la suma de eventos con GF ni se completan eventos faltantes a partir del marcador.

## Transacciones y concurrencia

La función `calculateStandingsInTransaction` exige SERIALIZABLE y recibe la transacción del llamador. Resultado, estado/historial de partido, cédula y clasificación deben compartir esa misma transacción cuando se integre el cierre. La entrada independiente usa SERIALIZABLE y un bloqueo asesor por grupo; las restricciones únicas de versión y equipo permanecen. Se reintenta toda la transacción ante errores de serialización admitidos, con límite; otros errores se propagan. No se reintenta una escritura parcial.

Los triggers vigentes registran actor/motivo en auditoría; no se insertan eventos de auditoría duplicados desde el servicio. No hay llamadas externas, uso de CURP/INE ni conexiones de producción.

## Migración y dependencias

`20261120010000_standing_calculation_provenance` permite `rank=NULL` para posiciones no sostenibles. Mantiene CHECK(rank>0), UNIQUE por rango y por equipo: PostgreSQL permite varios NULL sin inventar posiciones. Añade huella y JSON a `standing_versions` para idempotencia y procedencia, con índice de consulta. Los campos son opcionales para conservar versiones históricas. Triggers diferidos impiden validar una versión con posiciones pendientes, también al modificar una entrada. DG sigue siendo columna generada: nunca se escribe manualmente.

No crea tablas, no cambia RLS/ACL ni el baseline. En Supabase se conservan las políticas existentes sobre ambas tablas. Antes de exponer DTOs al navegador, PDGLD-151 debe seleccionar solo los campos necesarios; el JSON de procedencia permanece interno. El despliegue real y la aceptación humana siguen separados de estas pruebas.

La confirmación de PDGLD-18 continúa deshabilitada por `confirmation-effects.ts`. Faltan el adaptador final de transiciones/historial de PDGLD-85 y el receptor disciplinario. Su contrato actual llama `updateStandings` antes de marcar CONFIRMED la cédula: al integrar, confirmar dentro de la misma transacción antes de consultar resultados elegibles y usar SERIALIZABLE (hoy `mutateReport` usa el aislamiento predeterminado). También debe acordarse la autorización del efecto derivado para árbitros/capturistas: no darles `competitions:UPDATE` para eludir este límite. Esta entrega no habilita el cierre parcial ni declara integración de ese recorrido. La pantalla, navegación y DTO reducido quedan en PDGLD-151; integración completa y aceptación de PDGLD-152 requieren aquellos adaptadores y el ERS completo.
