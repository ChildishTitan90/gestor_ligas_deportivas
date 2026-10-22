# Plan de seguridad de producción — PDGLD-57

Actualizado: 22/10/2026. Preparado y probado para revisión por PR; no implica
ejecución en Supabase ni aceptación del flujo completo de documentos de PDGLD-59.

## Migraciones y autorización limitada

La migración compartida `20261021170000_pdgld57_affiliation_submission` se conserva
intacta. Una segunda migración, `20261022090000_pdgld57_supabase_security`, activa
RLS y revoca acceso de PUBLIC/anon/authenticated/service_role a la relación nueva
solo cuando existen los esquemas y roles administrados de Supabase. Sin marcadores
no cambia Docker; un conjunto parcial produce error y exige revisión del destino.

No hay políticas de acceso directo: se deniega por defecto. NextAuth no emite JWT
de Supabase, por lo que no se inventan políticas auth.uid(). El backend conserva su
autorización por permiso, club y liga. No se conceden privilegios o BYPASSRLS nuevos.
La protección de columnas añadidas a club_affiliations permanece bajo su RLS y
permisos existentes; esta entrega no concede acceso adicional a esa tabla.

`scripts/ci/production-plans.mjs` permite exclusivamente el SQL original conocido,
exigiendo el checksum normalizado de ambos archivos y su orden. La aprobación es
la revisión y fusión del PR, más la ejecución manual de la versión de main; no se
aceptan excepciones mediante variables o por el simple nombre de una migración.
El guard general sigue bloqueando otras creaciones de tablas y desactivaciones RLS.

Antes de crear, el despliegue comprueba que los DEFAULT PRIVILEGES del propietario
no otorguen acceso inicial a PUBLIC o roles de API, incluidas membresías heredadas.
Así la primera migración no abre acceso mientras llega la protección RLS posterior.
Si esos privilegios cambian, se detiene antes de migrar para revisar su configuración;
no cambia los privilegios globales automáticamente.

Tras migrar, se exige RLS en todas las tablas y ausencia de privilegios de tabla o
columna de los tres roles API en la relación nueva, además del historial y esquema.
Un fallo queda reportado; no se ejecuta reset, resolve ni reparación automática.

## Evidencia y límites

- Consulta real de solo lectura: Supabase tenía únicamente 0_init aplicado; la tabla
  nueva no existía, estaban presentes los cinco marcadores administrados y no había
  grants por defecto a roles API/PUBLIC para tablas del esquema. No se leyó información
  de usuarios ni se ejecutó ninguna migración en producción.
- 18 pruebas de controles: checksums, migración complementaria obligatoria, orden,
  reintentos, LF/CRLF y denegación de cambios no revisados, además de controles previos.
- El SQL y la prueba de seguridad pasaron en PostgreSQL embebido 17.5 con el baseline
  real, las dos migraciones y 97 tablas: Docker simulado permanece sin RLS; Supabase
  simulado activa RLS; marcadores parciales y grants inseguros se rechazan. Los tres
  roles API quedan sin privilegios; anon/authenticated se prueban además contra RLS.
  service_role se simula con BYPASSRLS para no atribuirle protección de políticas.
- La prueba real del servicio PostgreSQL Docker no pudo arrancar porque la conexión
  local estaba rechazada. CI incorpora `verify-production-security.mjs` en sus servicios
  PostgreSQL 15/17; esos resultados remotos se registran después de publicar el PR.

El usuario de migraciones observado fue postgres con BYPASSRLS, según la configuración
existente. No se cambió. Esta consulta no demuestra el usuario efectivo del runtime de
Vercel; separar sus privilegios sigue siendo un punto de verificación del entorno.

## Liberación y pruebas funcionales pendientes

1. Revisar el PR y sus checks en develop y main, manteniendo originales y datos.
2. Ejecutar el workflow manual de main con deploy_production. Debe aplicar ambas
   migraciones, verificar las 97 tablas con RLS e historial y terminar correctamente.
3. Registrar versión/resultado sin credenciales. No afirmar despliegue antes de verlo.
4. PDGLD-59 sigue a cargo de subida/descarga privada, contenido real de firmas y conexión
   del formulario. El esquema desplegado no equivale a terminar HU01-01.

## Lista de revisión de la entrega inicial

Responsable de coordinar revisión: Sergio. Revisor propuesto del backend y SQL:
Víctor, sujeto a revisión efectiva del PR. No representa aprobación ni aceptación
del riesgo. No se contactó ni se modificó Jira o Supabase desde esta implementación.

La nueva tabla `sports_management.club_affiliation_categories` registra UUID de
afiliación, temporada y categoría. No contiene nombres ni firmas, pero sus
relaciones pertenecen a un trámite privado. No debe consultarse desde clientes
de Supabase/PostgREST sin autorización de contexto.

El despliegue manual existente bloquea toda migración que crea tablas. Se mantiene
ese bloqueo hasta revisar lo siguiente, con evidencia en el PR:

1. Rol real de conexión del backend y sus privilegios mínimos; comprobar que no
   se usa un rol de navegador para la escritura del servicio.
2. Política RLS de la nueva relación en Supabase y de las nuevas columnas privadas
   en `club_affiliations`; comprobar acceso anónimo, usuario autenticado y acceso
   cruzado de club/liga con los roles reales. Revisar DEFAULT PRIVILEGES: la
   revocación incluida es defensa adicional, no sustituye RLS.
3. Mantener Docker sin RLS como decidió el equipo. El SQL específico de producción
   debe revisarse expresamente; no copiar una política basada en `auth.uid()` si
   la identidad actual es NextAuth y no Supabase Auth.
4. Verificar que los endpoints solo devuelven el DTO mínimo y que el bucket de
   firmas de PDGLD-59 es privado. Probar referencias de archivos ajenos y descarga
   por contexto, además de la validación de metadatos de PDGLD-57.
5. Acordar el mecanismo revisado de despliegue para esta migración. No retirar
   el filtro CREATE TABLE global ni forzar el pipeline para sortear la revisión.
6. Aplicar desde main mediante el flujo autorizado, verificar migraciones,
   permisos y prueba funcional; solo entonces documentar el despliegue realizado.

Hasta completar esos pasos, el backend y su migración pueden revisarse/probarse
localmente, pero el despliegue a Supabase y el cierre por DoD permanecen pendientes.
