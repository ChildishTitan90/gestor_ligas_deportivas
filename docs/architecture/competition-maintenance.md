# PDGLD-94 — Mantenimiento seguro de configuración

## Contratos

- `DELETE /api/competitions/seasons/{id}`: `expectedSeasonVersion`, `reason`.
- `PATCH /api/competitions/seasons/{id}/categories/{participationId}`:
  `ruleId`, `hierarchyOrder`, `type`, `expectedSeasonVersion`, `reason`.
- `DELETE /api/competitions/seasons/{id}/categories/{participationId}`:
  `expectedSeasonVersion`, `reason`.

JSON estricto, mismo origen, sesión operativa y `competitions:UPDATE` vigente
en el contexto de la temporada. RF22 no concede una acción DELETE; se utiliza
la misma autoridad de mantenimiento que renombrar/retirar grupos. No se acepta
actor, rol, cambio de catálogo, liga, formato ni estado enviados por el cliente.

La temporada debe estar PLANNED, sin inicio y con la versión esperada. Se
bloquean autorización, temporada y participación antes de verificar/escribir.
Se inspeccionan todas las relaciones hijas del modelo mediante `_count`;
las claves foráneas sin cascada son defensa final contra nuevas referencias.

## Conservación y auditoría

La temporada solo se elimina si está vacía, incluidos borradores de reglas,
afiliaciones y asignaciones relacionadas. No se borran dependencias para
vaciarla. `audit_season` registra DELETE; no se duplica el evento en aplicación.

La edición o retirada de una participación se bloquea si existen grupos,
afiliaciones que solicitan esa categoría, equipos, requisitos documentales,
etapas o premios. Retirar una participación conserva el catálogo de la liga.
Una participación con elegibilidad configurada no permite cambiar su tipo o
versión de reglas mediante este contrato; requiere el proceso específico de
reglas/elegibilidad. No se borra ni reinicia esa configuración implícitamente.

Cada mantenimiento de categoría registra un evento propio, pues esa tabla
no tiene `record_audit`, e incrementa la versión de temporada con su trigger.
Todos los efectos comparten transacción: un fallo de auditoría revierte la
retirada/edición y el incremento. Una versión obsoleta no reintenta la escritura.

Respuestas: `SEASON_IN_USE`, `CATEGORY_IN_USE`,
`CATEGORY_ELIGIBILITY_CONFIGURED`, `SEASON_CLOSED`,
`COMPETITION_ALREADY_STARTED` y `STALE_CONFIGURATION` son conflictos 409.
Identificadores/cuerpo/contexto inválidos se rechazan. Los errores inesperados
conservan la respuesta genérica 503, sin exponer SQL.

## Integración posterior del 30/10/2026

La pantalla PDGLD-95 ya conecta edición y eliminación segura de temporada y
participación de categoría. El cierre y las reglas de jugadores se implementan
en servicios separados, descritos en `competition-season-edit.md` y
`competition-player-policy.md`. El cierre protege historial; no aprueba reglas.

`npm run test:competitions` incorpora las pruebas de mantenimiento mediante
`tests/integration/seasons.test.mjs`; utiliza PostgreSQL temporal, sin cambios
en la base persistente ni Supabase. Estas operaciones de mantenimiento no
requieren migración propia; la integración posterior de políticas y cierre sí
incorpora una migración aditiva, aplicada en Docker local.
