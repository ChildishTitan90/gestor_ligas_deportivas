# PDGLD-38 — Edición y cierre de temporada

29/10/2026. Sin nuevas vistas.

PATCH `/api/competitions/seasons/{id}` requiere sesión operativa y
competitions:UPDATE sobre la edición. JSON estricto: name, startDate, endDate,
expectedSeasonVersion y reason. No acepta estado, liga, deporte, actor o campos
de reapertura. Devuelve id/name/version.

Solo PLANNED sin inicio de competencia. CLOSED rechaza con SEASON_CLOSED;
una edición iniciada, con COMPETITION_ALREADY_STARTED. La versión esperada se
verifica bajo bloqueo, y audit_season registra el cambio una sola vez.

El nombre puede corregirse antes del inicio; mover las fechas se rechaza con
SEASON_DATES_IN_USE si hay categorías, afiliaciones, jornadas o pausas. No se
recalcula ni desplaza su calendario de forma implícita. Fechas inválidas y nombres
duplicados se rechazan. No se ofrece un proceso de corrección de temporadas
cerradas: se conserva el historial en solo lectura.

## Cierre: aclaración de Sergio del 30/10/2026

Antes de cerrar deben estar completos los resultados. Corresponde al capturista
registrarlos y, cuando sea necesario, consultar la cédula del árbitro donde se
anotan las acciones. El cierre verifica ese requisito; no sustituye la captura.
Un default debe estar resuelto, registrado y autorizado; no inferir 1–0 o tres
puntos como regla universal ni resolver un partido automáticamente al cerrar.

Una temporada CLOSED permanece en solo lectura, también para administradores.
Esta aclaración sustituye la propuesta previa de correcciones posteriores al
cierre. No implementar reapertura ni excepciones de edición sin un nuevo
requisito explícito. Un error detectado después se informa para su tratamiento
por el equipo; no autoriza a alterar el historial.

POST `/api/competitions/seasons/{id}/close` implementa el cierre de ACTIVE con
competitions:UPDATE vigente en el ámbito, expectedSeasonVersion, reason y
confirm="CERRAR". Bloquea la temporada durante verificación, auditoría e incremento
de versión; registra closed_at. CLOSED rechaza nuevas escrituras y reapertura.

Se exige match_results (incluye validated_by/validated_at) y estado FINISHED,
NO_SHOW o ADMINISTRATIVELY_RESOLVED para cada partido no eliminado ni CANCELED.
Un cancelado no se disputó y no exige marcador; UNDER_REVIEW sigue pendiente
aunque tenga marcador. No se modifican estados ni se calculan defaults al cerrar.
La misma comprobación protege UPDATE directo en PostgreSQL mediante trigger.
UNRESOLVED_MATCHES y SEASON_NOT_ACTIVE devuelven 409, sin escritura parcial.

La migración aditiva 20261030110000 conserva las tablas históricas de autorización
pero retira su bypass de los dos triggers de protección de temporada cerrada.
Ningún app.correction_id habilita cambios posteriores. No se agregan bloqueos por
trámites distintos de los confirmados.

La suite de competencias verifica edición autorizada, esquema estricto,
concurrencia con una sola auditoría, protección del calendario usado y CLOSED.
31 resultados de la suite aprobados; lint y typecheck aprobados.
