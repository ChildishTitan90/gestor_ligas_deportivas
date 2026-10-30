# PDGLD-38 — Edición y condición de cierre pendiente

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
duplicados se rechazan. No se implementa todavía un proceso de corrección de
temporadas cerradas.

## Cierre: decisión de Sergio, pendiente de completar con la Liga

Sergio indicó bloquear el cierre si existen partidos sin resolver. Un default
debe estar resuelto, registrado y autorizado; no inferir 1–0 o tres puntos como
regla universal ni resolver un partido automáticamente al cerrar.

Falta definir cuáles trámites impiden el cierre, qué estados y validaciones
acreditan un resultado definitivo y la autoridad específica de cierre. No se
habilita una ruta de cierre hasta completar estas condiciones. La barrera de
solo lectura existente sí se mantiene y se prueba con temporadas CLOSED.

La suite de competencias verifica edición autorizada, esquema estricto,
concurrencia con una sola auditoría, protección del calendario usado y CLOSED.
31 resultados de la suite aprobados; lint y typecheck aprobados.
