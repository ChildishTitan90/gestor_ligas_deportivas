# PDGLD-38 — Contrato inicial de configuración

28/10/2026. Trabajo de servidor de PDGLD-94 y pruebas de PDGLD-96. Las vistas
de PDGLD-95 esperan la refactorización de Vic/PDGLD-110; no se incorporan nuevas
pantallas en este incremento. La pantalla de temporadas del incremento anterior
es provisional.

## Temporadas y autorización

`createSeason` crea PLANNED/version 1; `getSeasonWorkspace` consulta los recursos
de las ligas autorizadas. Una sesión operativa y los permisos vigentes del módulo
`competitions` determinan cada operación. No hay bypass por SUPERADMIN. Un ID del
cliente se resuelve en servidor para comprobar su liga y temporada.

## Convocatoria y parámetros versionados

`GET /api/competitions/seasons/{id}/configuration` requiere READ y devuelve:

- `season`: id, name, leagueId, version, status.
- `rules`: versiones descendentes, status, fecha y parámetros con key/value/
  requiresValidation. Incluye versiones previas, sin sobrescribirlas.

`POST` en la misma ruta requiere UPDATE sobre la temporada y una petición JSON
del mismo origen. Cuerpo estricto, máximo 32 KiB:

```json
{
  "expectedSeasonVersion": 1,
  "reason": "Propuesta para revisión",
  "announcement": "Texto de la convocatoria propuesta",
  "points": { "win": 3, "draw": 1, "loss": 0 },
  "tieBreakers": ["GOAL_DIFFERENCE", "GOALS_FOR"],
  "calendar": { "rounds": 2, "matchDurationMinutes": 90 }
}
```

Estos valores son ejemplos sintéticos, no defaults ni decisiones de la Liga.
Los identificadores de desempate son propuestas de configuración: el contrato
valida forma, orden y ausencia de duplicados, no afirma que exista su motor de
cálculo. Puntuación, desempates y calendario se guardan expresamente para revisión;
no se aplican a clasificaciones ni programación. No se admiten parámetros de edad,
documentos, ventanas o excepciones pendientes de PV-04.

Se crea una fila en `competition_rules`, siempre DRAFT, y cuatro filas en
`competition_rule_parameters`: announcement, points, tieBreakers y calendar.
Todas requieren validación y no incluyen validated_by. El texto de convocatoria
se conserva por versión; este contrato no admite archivos ni enlaces de Storage.
La validación/aprobación y el vínculo a categorías quedan pendientes de desarrollo.

La respuesta 201 contiene id, version (del borrador), status y seasonVersion.
No confundir la versión de la temporada con el número de versión de sus reglas.
La temporada se bloquea antes de validar su versión y calcular el siguiente
número. Si otro escritor ya avanzó, 409 STALE_CONFIGURATION exige volver a consultar
antes de enviar otra propuesta. Una respuesta perdida se resuelve consultando;
no se reintenta automáticamente con una versión más reciente.

Temporadas CLOSED rechazan nuevas propuestas con 409 SEASON_CLOSED y mantienen
la consulta. La API no cierra ni reabre temporadas. No existe aquí un bypass de
corrección autorizada para romper el cierre.

Cambios, parámetros, incremento de versión y auditoría son una sola transacción.
El baseline audita automáticamente reglas y parámetros; audit_season registra
el UPDATE de temporada. El servicio no duplica estos eventos. Ningún error expone
conexiones, consultas, credenciales ni filas internas de usuarios.

Otros errores: 400 INVALID_CONFIGURATION/INVALID_PAYLOAD,
401 UNAUTHENTICATED, 403 FORBIDDEN/INVALID_ORIGIN,
413 PAYLOAD_TOO_LARGE, 503 SERVICE_UNAVAILABLE. Respuestas privadas y sin caché.

## Alcance pendiente

La configuración de categorías, formatos y distribución requiere una migración
aditiva para separar inscripción y grupo asignado. El contrato actual de equipos
sigue requiriendo grupo; no se modifica parcialmente ni se ofrece todavía una
inscripción pendiente de distribución. Falta acordar y probar la adaptación
completa con recuperación, idempotencia, autorización de categorías y datos legados.

El alta y asociación de categorías se describen en [su contrato](competition-categories.md).
También faltan edición/eliminación de categorías, grupos y formatos, aprobación de reglas,
edición/cierre de temporadas, correcciones autorizadas y aceptación integrada.
Las pruebas de este incremento no acreditan que PDGLD-38 esté terminada.
