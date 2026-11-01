# PDGLD-38 — Categorías: catálogo y participación

28/10/2026. Servicios de PDGLD-94 y pruebas de PDGLD-96. Sin nuevas vistas;
PDGLD-95 espera la refactorización de Vic. Las rutas requieren sesión operativa,
validación estricta, permisos vigentes y contexto verificado en el servidor.

## Catálogo

- GET `/api/competitions/categories?leagueId={uuid}`: competitions:READ en la liga.
  Devuelve items con id/name del catálogo de fútbol de esa liga.
- POST a la misma ruta: competitions:CREATE, JSON con leagueId, name y reason.
  Nombre recortado, no vacío, máximo 160 caracteres. Una transacción crea catálogo
  y auditoría; la unicidad por liga/deporte/nombre impide duplicados concurrentes.

El catálogo no contiene edades ni formato global, no modifica temporadas previas
ni crea una participación automáticamente. No se incluye otro deporte en el MVP.

## Participación por temporada

- GET `/api/competitions/seasons/{id}/categories`: competitions:READ en la edición.
- POST a la misma ruta: competitions:UPDATE; cuerpo con categoryId, ruleId,
  expectedSeasonVersion (entero positivo), hierarchyOrder (entero positivo), type
  (OPEN/YOUTH/VETERANS) y reason. Sin valores por defecto de edades o documentos.

Se verifica que categoría y temporada correspondan a la misma liga/deporte, y que
ruleId pertenezca a esa edición. DRAFT puede vincularse como preparación; no se
aprueba al asociarlo. La categoría solo se agrega a PLANNED, sin inicio de
competencia, con versión vigente. Se bloquea la temporada, se crea participación,
se audita y aumenta su versión en una sola transacción. El catálogo se puede usar
en otra edición sin sobrescribir la primera. No se crean grupos ni se activa nada.

La respuesta 201 incluye id (participación), seasonVersion y eligibilityPending.
La consulta devuelve id, categoryId, name, ruleId, hierarchyOrder, type,
eligibilityPending, ageCutoffDate, minimumAge y maximumAge. Los últimos tres son
nulos en las nuevas asociaciones pendientes. categoryId identifica el catálogo;
id identifica exclusivamente su participación en esta temporada.

## Elegibilidad pendiente y migración

`20261028120000_pdgld38_pending_category_eligibility` agrega eligibility_pending
con default false y permite age_cutoff_date nula solo si está pendiente. No cambia
los valores previos ni elimina filas, FK, funciones, triggers o políticas RLS.
False en filas legadas significa que existía un corte; no acredita validación de
documentos ni una decisión del profesor. Las altas nuevas se guardan con true.
El seed detecta tanto fechas ausentes como configuración pendiente y se niega a
sobrescribir sus fixtures si ya difieren.

El módulo futuro de jugadores debe impedir confirmar elegibilidad si está
pendiente. Este incremento prepara la configuración, no habilita jugadores, no
aprueba reglas y no crea una operación para confirmar decisiones de PV-04.
Afiliaciones e inscripción conservan sus contratos y controles actuales.

Migración aplicada solamente en bases temporales durante esta revisión. Para usar
estos servicios en una base existente, aplicar antes las migraciones por el
procedimiento del equipo; no ejecutar db push ni reset. No hubo cambios remotos.

## Errores y verificación

400 INVALID_CONFIGURATION/INVALID_CONTEXT; 401 UNAUTHENTICATED;
403 FORBIDDEN/INVALID_ORIGIN; 409 CATEGORY_ALREADY_EXISTS, STALE_CONFIGURATION,
SEASON_CLOSED o COMPETITION_ALREADY_STARTED. Otras fallas: 503 SERVICE_UNAVAILABLE.
POST acepta hasta 32 KiB del mismo origen; respuestas privadas y sin caché.
Tras conflicto de versión o respuesta incierta se consulta antes de reenviar.

`npm run test:competitions` prueba catálogo, permisos, cruce de liga/deporte,
reglamento ajeno, asociación con elegibilidad pendiente, reutilización histórica,
restricción SQL, duplicados, carreras, rollback/auditoría y barrera de cierre/inicio.
La prueba de auditoría de reglas también verifica que un UPDATE de seasons solo
registre el evento del trigger. Las suites de afiliación/inscripción ejercitan las
filas legadas con el default false y conservan sus controles existentes.
