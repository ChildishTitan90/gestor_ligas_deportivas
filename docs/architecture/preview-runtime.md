# Runtime privado de Preview y migraciones — PDGLD-64

Revisión del 27/10/2026. Proyecto de pruebas: `loaztwwpwsaqzdtdtvvj`.
Esta entrega prepara código y procedimientos; **no aplica migraciones ni GRANT
en Supabase** y no acredita la reparación del ambiente remoto.

## Plan de producción

`scripts/ci/production-plans.mjs` acepta únicamente la migración
`20261026010000_pdgld64_enrollment_operations` con SHA-256 normalizado a LF
`cf81c3eeb7de3b3292aa560fd10820c4ba8db7db2217ede110eae0e37c0f6b33`.
El original fue leído y contrastado con el checksum proporcionado. Conserva
la validación de PDGLD-57 y el rechazo de otras creaciones o desactivaciones de
RLS. No hay excepciones por variable de entorno ni cambios a migraciones.

Antes de crear cualquiera de las tablas revisadas se exigen los cinco marcadores
Supabase y se comprueban las ACL por defecto globales y del esquema del rol
creador efectivo. Se incluyen el default implícito del propietario, PUBLIC y
privilegios de API por membresía heredada. Los defaults de otros roles no se
heredan al crear una tabla. El control falla sin reescribir seguridad o datos.

Antes y después de migrate deploy se comprueban el historial original, su orden
y RLS de todas las tablas. Las tablas revisadas ya aplicadas se vuelven a
comprobar aunque no haya pendientes. Para team_enrollment_operations y
club_affiliation_categories se rechaza acceso de tabla o columna de anon,
authenticated y service_role, incluido PUBLIC/herencia y MAINTAIN en PG17.
El ledger también se comprueba por tabla y columna para los roles API.

Producción conserva workflow_dispatch, deploy_production, el environment
supabase-production y la comprobación de que main no avanzó. Después de integrar
en develop y liberar a main, iniciar **una ejecución nueva desde main** con la
opción activada. Reejecutar el workflow #92 conserva su código anterior, que
rechazaba PDGLD-64. Un fallo posterior a migrate deploy no deshace automáticamente
las migraciones confirmadas.

## Provisión SQL de Preview

`scripts/preview/runtime-plan.mjs` es la fuente reproducible de provisión y
mantenimiento. No contiene contraseñas. En una instalación nueva crea el rol
gestor_ligas_preview como NOLOGIN; habilitación y secreto se administran aparte.
No cambia LOGIN, contraseña ni atributos del rol existente. Rechaza privilegios
administrativos, propiedad de tablas, CREATE en el esquema y membresías en
cualquier dirección.

La conexión pertenece al backend. NextAuth identifica a cada persona; los
servicios autorizan dinámicamente permiso y alcance dentro de sus transacciones.
Las políticas del rol privado permiten los comandos necesarios; no usan auth.uid()
ni conceden acceso a roles de navegador/API. SELECT se enumera por tablas que
consultan los servicios y el autorizador, sin grants globales o futuros.

| Operación | Permisos revisados |
| --- | --- |
| Resumen de acceso/autorización | SELECT de identidad, asignaciones, permisos y contexto; UPDATE(id) solo para bloqueo de tablas de lectura |
| Login, actividad, contraseña/cierre | INSERT de eventos/sesiones; UPDATE de contadores, bloqueo, contraseña, versión y actividad/revocación |
| Cuentas/RF22 existentes | INSERT de persona, cuenta, club y asignaciones; INSERT/UPDATE(context_only)/DELETE de role_permissions según el servicio |
| Solicitud | INSERT de afiliación, personas/directivos, categorías y auditoría; archivos según el servicio de firmas |
| Revisión/aprobación | UPDATE de estado, revisión y versión; UPDATE(authorized_by,authorized_at) de categorías y auditoría |
| Corrección | UPDATE de nombre/colores/revisión y persona/firma de directivos; DELETE/INSERT de categorías; personas nuevas y auditoría |
| Opciones | SELECT de sports, seasons, categories, season_categories, groups, teams, afiliación/autorizaciones; bloqueos conservados |
| Equipo/inscripción | INSERT por columnas de teams y season_teams; sin UPDATE de sus datos. El trigger original audita la inscripción |
| Recuperación/cancelación | SELECT/INSERT por columnas de team_enrollment_operations; sin UPDATE/DELETE; el trigger exige contexto de auditoría |

Las listas incluyen defaults escalares que Prisma materializa en INSERT: fechas,
estados, review_version y contadores iniciales. No conceden UPDATE de claves
primarias ni de club/temporada/autor de registros.

FOR SHARE necesita UPDATE sobre alguna columna. Las tablas que solo se bloquean
reciben UPDATE(id) y política FOR UPDATE USING(true) WITH CHECK(false). La
actualización real sigue fallando. En tablas con escrituras reales se retira la
antigua ACL UPDATE(id) y se sustituye la política de bloqueo por las columnas y
política revisadas. Conservar id junto a otra política permisiva abriría su
modificación; por eso se comprueban privilegios efectivos de cada columna.

El mantenimiento es transaccional e idempotente. Normaliza exclusivamente ACL
directas y políticas conocidas preview_backend_* en las tablas enumeradas.
Primero exige que las políticas conocidas coincidan exactamente con el contrato
anterior; si difieren, aborta sin sobrescribirlas. Otra política que habilite
UPDATE en una tabla de solo bloqueo también detiene el plan. No instala ni
restaura RF22, cuentas, registros, contraseñas ni fixtures de review. El ledger
queda denegado al runtime. No concede ALL PRIVILEGES, BYPASSRLS, DDL ni defaults.

## Aplicación a pruebas: pendiente del administrador

Usar el comando desde la carpeta del proyecto con las dependencias instaladas.
No carga .env ni toma DATABASE_URL, DIRECT_URL o secretos de producción como
origen. El administrador debe inyectar **solo en el proceso** PREVIEW_OWNER_URL
con su mecanismo privado de secretos; no pegar secretos en argumentos o tickets.
No se obtuvo ni utilizó una conexión propietaria remota en esta entrega.

La URI propietaria debe usar postgres en
db.loaztwwpwsaqzdtdtvvj.supabase.co, o postgres.loaztwwpwsaqzdtdtvvj en el pooler
Supabase de sesión; puerto 5432 y base postgres. Se rechazan runtime, otro
proyecto y pooler transaccional.

CA predeterminada: C:/Users/victo/Downloads/supabase-pruebas-ca.crt.crt.
PREVIEW_CA_CERT_PATH permite indicar otra ruta descargada del mismo proyecto.
Se comprueba CA vigente, cadena y hostname TLS y propietario postgres en sesión.
Prisma 7 recibe DIRECT_URL temporal con schema=public, sslmode=require,
sslaccept=strict y sslcert. Los .env de Docker se conservan; la URI no se imprime.

Además se exige el marcador existente en audit_logs de la instalación demo de
pruebas o el comentario de base PDGLD_PRUEBAS_ONLY=loaztwwpwsaqzdtdtvvj.
El comando no crea el marcador. Si falta, verificar el destino antes de seguir.

1. `npm.cmd run preview:maintain -- check`: solo lectura; valida destino, CA,
   propietario, marcadores, historial/checksums, RLS y ACL. Informa pendientes;
   con todo aplicado ejecuta status y diff.
2. Revisar respaldo y pendientes originales, luego ejecutar
   `npm.cmd run preview:maintain -- migrate --apply loaztwwpwsaqzdtdtvvj`.
   Usa prisma migrate deploy y verifica historial completo, seguridad,
   migrate status y diff. No hay baseline nuevo ni inserts al ledger.
3. Ejecutar
   `npm.cmd run preview:maintain -- provision --apply loaztwwpwsaqzdtdtvvj`.
   Exige todas las migraciones aplicadas y ejecuta exclusivamente la provisión
   revisada. Una desviación requiere investigación; no hay bandera para omitirla.
4. Repetir check y provisión; probar en navegador login, panel,
   revisión/corrección, categoría aprobada, grupo, inscripción,
   recuperación/cancelación, revocación y otro club/usuario.

No usar credenciales de producción/runtime para migrar, reset, db push o resolve.
No ejecutar SQL de limpieza o datos de la review. Titular/subdelegado de Sprint 2
queda fuera. Desplegar producción desde main no actualiza esta base de pruebas.

## Pruebas

test:ci incluye SQL exacto PDGLD-64, LF/CRLF, checksum alterado, reintentos,
migraciones no revisadas y guardas de conexión/comando de Preview.
verify-production-security.mjs conserva PDGLD-57 y prueba ambos planes en
transacciones reversibles: Docker sin RLS, marcadores parciales, defaults
globales/de esquema, PUBLIC, herencia y exposición de tabla/columna.

`npm run test:preview-runtime` usa el harness existente: crea una base local con
nombre aleatorio, aplica originales y activa RLS únicamente en ese fixture.
Reproduce 42501, instala dos veces el mismo plan y conecta **la aplicación** con
el rol limitado. El propietario prepara únicamente fixtures. Reutiliza suites
HTTP de cuentas/RF22, afiliaciones, correcciones y equipos, y ejecuta el
autorizador real para los 28 permisos de SUPERADMIN. Comprueba alcance,
rollback, concurrencia, idempotencia, bloqueos sin UPDATE real y ledger denegado.
Los dos casos que parten de Docker sin RLS permanecen en sus suites originales
y se omiten únicamente en el recorrido que exige RLS.

La conexión efectiva del cliente de fixtures se valida antes de escribir: host
loopback, puerto 5432/5433, propietario postgres y nombre aleatorio exacto creado
por el harness. SQL exige también el marcador y que la base temporal pertenezca
a la sesión. No se usa inet_server_addr() para deducir localhost: en Docker o
un puerto reenviado devuelve la interfaz del servidor, distinta del host usado
por el cliente. La ruta remota mantiene el proyecto fijo, CA/TLS, propietario y
base postgres de pruebas. test:ci incluye rechazos de hosts externos, sockets,
puertos, bases y roles ajenos antes de mutar los fixtures.

El workflow incorpora estas comprobaciones en PostgreSQL temporal 15/17. Véase
[la evidencia local y los pendientes remotos](../validation/PDGLD-64-despliegue-preview.md).

Referencias: [SELECT con bloqueo](https://www.postgresql.org/docs/15/sql-select.html),
[defaults del rol creador](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html),
[privilegios efectivos y herencia](https://www.postgresql.org/docs/17/functions-info.html).
