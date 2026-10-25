# Gestor de Ligas Deportivas

MVP para la Liga Municipal de Fútbol Amateur de Morelia.

Stack actual: Next.js 16, React 19, Tailwind CSS 4, NextAuth 4, Zod 4 y Prisma 7.10. Desarrollo con Node.js 24.x y PostgreSQL 15 local mediante Docker.

Las dependencias directas están fijadas al lockfile; Prisma CLI, Client y adaptador PostgreSQL usan 7.10.1. Usa Node.js 24 y npm 11.19 o posterior dentro de 11.x. La [revisión PDGLD-71](docs/revision-dependencias-pdgld71.md) documenta la actualización, compatibilidad, scripts permitidos y el hallazgo residual de braces pendiente de decisión en revisión.

## Instalación del equipo

Sigue la [guía de instalación y trabajo](docs/guia-equipo.md). Incluye Docker Desktop, Git, variables locales, comprobaciones de las 96 tablas y flujo Jira/GitHub.

Resumen para quien ya instaló las herramientas:

1. Clona `develop` después del merge del entorno.
2. Copia `.env.example` a `.env` si no existe; sustituye los marcadores.
3. Ejecuta `npm ci`.
4. Ejecuta `docker compose -f compose.yml up -d --wait`.
5. En una base nueva, ejecuta `npx prisma migrate deploy` y `npx prisma generate`.
6. Ejecuta `npx prisma migrate status` y verifica las tablas con el comando de la guía.
7. Ejecuta `npm run dev` y abre http://localhost:3000.

En PowerShell puedes usar `npm.cmd` y `npx.cmd`.

## Base de datos

`prisma/migrations/0_init/migration.sql` contiene el SQL inicial completo: 96 tablas en `sports_management`, restricciones, funciones, triggers, vistas y catálogos. Docker inicia PostgreSQL; Prisma Migrate crea y actualiza el esquema. El volumen `postgres_data` conserva los datos al detener el contenedor. `db/init.sql` se conserva como referencia histórica y ya no está montado en Docker.

El esquema está en `prisma/schema.prisma`; la CLI usa `prisma.config.ts`. El baseline `0_init` ya se verificó y registró tanto en la base local de Víctor como en Supabase. Una base existente sin historial necesita verificación y registro del baseline antes de aplicar migraciones; una base nueva utiliza `migrate deploy` directamente.

Consulta la [guía de migraciones](docs/migraciones.md) para crear cambios y recibir los del equipo. Por decisión de Víctor, Supabase conserva RLS habilitado en sus 96 tablas y Docker continúa sin RLS. `0_init` registra la estructura común y no reproduce por sí solo la seguridad de una nueva base Supabase. No reapliques el SQL ni reinicies la base compartida.

El seed sintético de PDGLD-47 se ejecuta explícitamente con `npm run db:seed`, después de migrar y generar el cliente. `npm run test:seed` reconstruye una base temporal local y verifica dos ejecuciones, UUID, relaciones, auditoría y rollback. Consulta [semillas e identidad de pruebas](docs/seed.md) para sus parámetros y resultados; Prisma 7 no lo ejecuta automáticamente al migrar.

## Flujo del equipo

Crea ramas desde `develop` actualizado: `tipo/PDGLD-N-descripcion`. Incluye la clave real en commits y títulos de PR. Los PR de trabajo apuntan a `develop`; las liberaciones pasan de `develop` a `main`.

Versionamos `.env.example` con marcadores. Los secretos y archivos `.env` no se suben.

## Autenticación local — PDGLD-48

NextAuth 4 Credentials valida correo/contraseña con Zod y verifica Argon2id contra PostgreSQL mediante Prisma 7. La sesión JWT solo expone UUID y estado de cambio obligatorio; la cuenta vigente se vuelve a comprobar en servidor. Cuentas temporales permanecen restringidas.

Consulta [desarrollo local, pruebas y demostración](docs/authentication.md), [contratos para PDGLD-49/50/51](docs/architecture/authentication.md) y [pantallas mínimas y tokens](docs/design/auth-access.md). Para el trabajo diario, ejecuta una vez `npm run seed:dev` para cargar cuentas sintéticas persistentes en la base local y después usa `npm run dev`. `npm run test:auth` utiliza una base temporal dentro del mismo PostgreSQL; `auth:demo` es opcional. El login cuenta fallos concurrentes, bloquea tras cinco intentos y exige nuevo acceso después del cambio de contraseña. La inactividad se valida en servidor con sesiones persistentes: `AUTH_IDLE_TIMEOUT_MINUTES=30`, renovación por acciones del usuario y revocación individual al salir. Las consultas automáticas no prolongan ese plazo. Esta integración no termina por sí sola PDGLD-31 ni los controles RBAC y auditoría pendientes.

## Alta de cuentas

El servidor de alta de cuentas de **PDGLD-34 / PDGLD-52** expone `/api/accounts` para SUPERADMIN, con contexto inicial, contraseña temporal, auditoría y pruebas. El [contrato para el formulario PDGLD-53](docs/architecture/account-provisioning.md) documenta entradas y errores. La interfaz conserva su subtarea separada.

## Solicitud de afiliación — PDGLD-57

El backend expone POST `/api/affiliations`: solicitud pendiente con folio único,
directivos, categorías e historial atómicos, autorización del delegado y reenvíos
sin duplicar registros. Consulta el [contrato e integración con PDGLD-59](docs/architecture/affiliation-submission.md)
y la [evidencia local](docs/validation/PDGLD-57-solicitud-afiliacion.md).
El formulario de captura aún requiere la integración de firmas y envío de PDGLD-59.
Hay una migración aditiva nueva: aplicar `npx --no-install prisma migrate deploy`
y `npx --no-install prisma generate` al recibirla en local, conservando datos.
`npm run test:affiliations` valida el backend en una base temporal independiente.
El despliegue a Supabase requiere [revisión de seguridad de la tabla nueva](docs/architecture/affiliation-submission-security.md);
el guard de producción sigue bloqueándolo hasta completar esa revisión.

## Inscripción de equipos — PDGLD-62 / PDGLD-64

El backend ofrece opciones, consulta e inscripción en `/api/team-enrollments`,
con estado inicial `REGISTERED` (INSCRITO), alcance por club, alta atómica e
idempotencia persistente. El [contrato para PDGLD-63](docs/architecture/team-enrollment.md)
describe las modalidades de equipo existente/nuevo y los errores.
La migración aditiva distingue categorías solicitadas de autorizadas; no las
autoriza automáticamente. `npm run test:team-enrollments` ejecuta HTTP real y
PostgreSQL local desechable, también incorporados en CI 15/17.
La aprobación real de PDGLD-60, las pantallas de PDGLD-63 y la definición de
activación siguen siendo dependencias separadas; no se habilita transición a ACTIVE.

## CI/CD

El workflow `.github/workflows/ci-cd.yml` comprueba los PR y los cambios en `develop` y `main`: instalación reproducible, pruebas del pipeline, ESLint, compilación y reconstrucción de las migraciones en PostgreSQL 15 y 17. El resultado conjunto se llama **CI listo para integrar**.

La base Supabase actual se destina a producción. Las migraciones se despliegan mediante una ejecución manual desde `main`, después de pasar CI. Los PR y el merge a `develop` utilizan bases temporales de prueba. Consulta [CI/CD y activación en GitHub](docs/ci-cd.md) para configurar los secretos, publicar el workflow y hacer una liberación. Este CD actualiza la base de datos; el alojamiento de la aplicación sigue pendiente.
