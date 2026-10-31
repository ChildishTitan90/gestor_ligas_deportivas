# PDGLD-38 — Fase de grupos y distribución

30/10/2026. Incremento de servidor, sin nuevas vistas. Los servicios están en
`features/competitions/server/distribution.ts` y reutilizan autenticación,
permisos, auditoría y conexión del proyecto. No se agrega otro servidor.

## Contrato

- PATCH `/api/competitions/seasons/{id}/categories/{participationId}/format`:
  `{format:"GROUP_STAGE",expectedSeasonVersion,reason}`. Mismas precondiciones
  de configuración que tabla general. Devuelve group=null; los grupos reales
  se crean mediante el CRUD existente. No transforma actividad legada.
- POST `/api/team-enrollments`: club, temporada, categoría, equipo y clave
  estable; omitir groupId. Requiere delegado autorizado, afiliación APPROVED y
  categoría autorizada. Persiste REGISTERED y categoría, con group_id nulo.
  Elegir un grupo en este formato se rechaza; no se crea un grupo provisional.
- GET `/api/competitions/seasons/{id}/categories/{participationId}/distribution`:
  pendientes de esa participación, con clubs:READ en el ámbito de la temporada.
  Máximo 100, cursor opcional `after`, devuelve items y nextAfter. Cada item
  contiene enrollmentId, clubId, teamName y clubName. El delegado de un solo club
  no obtiene el listado de toda la categoría.
- POST en la misma ruta: `{enrollmentId,groupId,expectedSeasonVersion,reason}`.
  Exige clubs:APPROVE vigente sobre club/temporada, GROUP_STAGE y grupo de esa
  participación/temporada. Revalida y bloquea la afiliación/categoría autorizada.
  Secretaría tiene esta capacidad inicial en RF22; no se exige un código de rol.
  Rechaza temporada cerrada o competencia iniciada. Bloquea temporada e inscripción;
  actualiza grupo y versión en una transacción auditada, conservando REGISTERED.
  Devuelve enrollmentId, groupId y seasonVersion. No activa equipos.

Versión obsoleta, inscripción ya distribuida y categoría sin autorización son
409 (STALE_CONFIGURATION, ENROLLMENT_ALREADY_DISTRIBUTED, CATEGORY_NOT_AUTHORIZED).
Grupo/participación ajenos: INVALID_CONTEXT 400; permiso insuficiente: 403.
Se conservan origen, JSON limitado, sesión operativa y respuestas privadas.
El motivo acompaña a los triggers existentes; no se duplica auditoría.

## Datos e historial

Migración aditiva `20261029130000_pdgld38_pending_distribution`:

- Proyecta season_category_id desde el grupo anterior y conserva los demás
  campos, UUID, claves, huellas, operaciones y auditoría. Se ejecuta atómicamente
  con bloqueo de tabla. Suspende solo los triggers de auditoría/cierre de esa
  proyección y restaura exactamente su estado previo, incluidas temporadas cerradas.
  Ante una fila sin categoría verificable se revierte todo.
- CHECK exige categoría no nula y FK compuesta exige misma temporada. Prisma
  modela la columna como opcional para permitir inserciones legadas sin ese campo:
  el trigger lo rellena a partir de su grupo antes de comprobar las restricciones.
- Grupo nulo solo para GROUP_STAGE y estado REGISTERED. SQL rechaza insertar
  directamente un equipo ya distribuido en ese formato, cambiar su identidad,
  reasignar un grupo ya confirmado o cambiar formato con inscripciones.
- La programación de partidos exige grupo asignado. La FK compuesta existente
  de standing_entries impide clasificar al pendiente. No se debilitan esas FK.

Los acuses y listados admiten groupId/groupName nulos y conservan categoría.
La recuperación tras asignación acepta el grupo confirmado aunque el cuerpo
original lo omitiera. La huella del cuerpo original no cambia; LEGACY_GROUPS
mantiene su contrato y GENERAL_TABLE sigue asignando General automáticamente.

## Límites

## Distribución automática equilibrada

POST `/api/competitions/seasons/{id}/categories/{participationId}/distribution/automatic`
recibe `{expectedSeasonVersion,reason}` y devuelve `{assignments,seasonVersion}`.
Exige clubs:APPROVE sobre toda la temporada y cada club afectado. Revalida las
afiliaciones y categorías autorizadas bajo bloqueo, GROUP_STAGE, grupos reales,
temporada no cerrada ni competencia iniciada. Comparte el bloqueo de temporada
con inscripción, configuración y distribución individual.

El algoritmo recorre pendientes por UUID y asigna cada uno al grupo con menor
cantidad de inscripciones existentes (todos los estados); empates por UUID de
grupo. Se incluyen las asignaciones previas para equilibrar la carga, sin moverlas.
No es un sorteo ni aplica cabezas de serie, cupos o separación por club.
La administración lo ejecuta expresamente; este criterio debe revisarse con Vic.
Los equipos conservan REGISTERED. El lote y el incremento único de versión se
auditan con los triggers existentes y se revierten juntos si falla una operación.
Sin pendientes devuelve lista vacía y no cambia versión ni auditoría. Reintentar
una versión anterior produce STALE_CONFIGURATION; consultar el listado antes de
reenviar tras respuesta incierta. Dos ejecuciones simultáneas tienen un ganador.

Límite técnico de 500 pendientes por ejecución: si se supera, rechaza el lote
completo con DISTRIBUTION_TOO_LARGE (409), sin procesar una página parcial. No es
un cupo deportivo. Sin grupos: DISTRIBUTION_REQUIRES_GROUPS (409). La interfaz de
ejecución y confirmación sigue pendiente; la verificación actual es por HTTP real.

No hay sorteo, cupos inventados, reasignación, programación, activación ni
segunda aprobación de equipo. La selección/presentación de formatos y bandeja de
distribución quedan para PDGLD-95 tras la refactorización visual. El formulario
actual todavía requiere un grupo y no habilita este nuevo recorrido visual.
No se declara cerrado PDGLD-38/94/96. Aplicación probada solo en bases temporales;
las migraciones de la base habitual y Supabase siguen el procedimiento del equipo.
