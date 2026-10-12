# Migraciones de base de datos — PDGLD-45

Actualizada el 11 de octubre de 2026. Prisma 7.10 / PostgreSQL.

## Estado actual

- La migración inicial completa está en `prisma/migrations/0_init/migration.sql`.
- El baseline se verificó y registró en `gestor_ligas_dev` de Víctor, en localhost:5433.
- La reconstrucción con Prisma Migrate coincidió con sus 96 tablas, 693 columnas, 579 restricciones, 408 índices, 15 funciones, 119 triggers y 2 vistas. También se compararon políticas y privilegios.
- La estructura y los conteos de datos locales permanecieron iguales después del registro.
- Supabase se verificó mediante su conexión de sesión y el certificado de CA proporcionado por Víctor. Allí se registró `0_init` y Prisma confirmó que no hay migraciones pendientes. Las tablas, sus datos y su RLS existente se conservaron.
- El baseline registra la estructura común: Supabase conserva RLS habilitado en las 96 tablas; Docker continúa sin RLS por decisión de Víctor. La propuesta de alineación local queda pendiente y se retiró del historial activo.
- La comparación contempló las diferencias de PostgreSQL 15 local y PostgreSQL 17 en Supabase: privilegio `MAINTAIN` del propietario y representación equivalente de una vista. No hubo diferencias funcionales en esos objetos.
- La tabla nueva `public._prisma_migrations` quedó sin acceso de los roles de API `anon`, `authenticated` y `service_role`; el administrador `postgres` conserva acceso.
- `db/init.sql` se conserva como referencia histórica. Las migraciones son la fuente de los cambios; Docker ya no ejecuta ese archivo.

El historial de Prisma se guarda en `public._prisma_migrations`. Los modelos y tablas de la aplicación continúan en `sports_management`. La configuración fija explícitamente `schema=public` para la conexión de la CLI y la migración instala `btree_gist` en `public`.

## 1. Instalación en una base local nueva

Después de clonar `develop` con este cambio y preparar tu `.env` local:

```powershell
npm.cmd ci
docker compose -f compose.yml up -d --wait
npx.cmd prisma validate
npx.cmd prisma migrate deploy
npx.cmd prisma generate
npx.cmd prisma migrate status
```

En una base vacía, `migrate deploy` ejecuta la migración inicial y crea las tablas, restricciones y demás objetos. No necesitas ejecutar el SQL manualmente ni hacer `db pull`.

## 2. Base existente: registro único del baseline

**Este procedimiento es para el administrador y solo se hace una vez por base.** Víctor ya lo completó tanto en su base local como en Supabase; no necesita repetirlo.

Antes de registrar otra base existente:

1. Identifica el servidor y la base apuntados por `DIRECT_URL`. Para Supabase usa la conexión directa o el pooler de sesión apropiado, no el de transacciones.
2. Comprueba que no existe un historial anterior incompatible.
3. Compara la estructura existente con la migración inicial completa, incluyendo restricciones, índices, funciones, triggers, vistas y permisos. El conteo de 96 tablas y el diff de Prisma por sí solos no verifican todos esos objetos.
4. Si hay diferencias de la estructura que administra la migración, resuélvelas antes del registro. Las diferencias específicas del entorno deben verificarse y documentarse explícitamente: en este proyecto se conserva RLS solo en Supabase por decisión de Víctor. No marques como aplicados objetos de tablas o cambios que no existen.

Esta comprobación de Prisma es una parte de la verificación; no representa los objetos SQL que Prisma no soporta:

```powershell
npx.cmd prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Cuando la equivalencia esté verificada, registra la migración como ya realizada y comprueba el estado:

```powershell
npx.cmd prisma migrate resolve --applied 0_init
npx.cmd prisma migrate status
npx.cmd prisma migrate deploy
```

El registro no recrea las tablas existentes. No ejecutes `resolve` sobre una base vacía: ahí corresponde `migrate deploy` directamente.

No cambies las credenciales compartidas del equipo para esta operación. El administrador debe usar su entorno de migraciones; los demás mantienen sus URL locales.

## 3. Crear un cambio de base — quien modifica el esquema

Este flujo se usa para los siguientes tickets, después de integrar el baseline. Trabaja sobre tu Docker local.

### Actualiza tu punto de partida

Con el árbol limpio, actualiza `develop`, instala las dependencias y aplica las migraciones de los compañeros:

```powershell
git switch develop
git pull --ff-only origin develop
npm.cmd ci
docker compose -f compose.yml up -d --wait
npx.cmd prisma migrate deploy
npx.cmd prisma generate
```

Crea una rama con la clave real de tu ticket. Ejemplo de formato:

```text
feat/PDGLD-N-descripcion-corta
```

### Modifica schema.prisma y crea el borrador

Una vez editado `prisma/schema.prisma`, valida y genera una migración. Sustituye el nombre por una descripción concreta del cambio:

```powershell
npx.cmd prisma validate
npx.cmd prisma migrate dev --name agregar_campo_club --create-only
```

Prisma crea una carpeta nueva con `migration.sql`. Abre ese archivo y revisa que implemente el cambio esperado. Al renombrar columnas, comprueba que no las elimine y vuelva a crear. Revisa cómo se conservarán los datos y los objetos SQL especiales.

`migrate dev` utiliza una base temporal de comparación, llamada shadow database. El usuario `postgres` local puede crearla automáticamente. No reutilices Supabase ni una base con datos del equipo como shadow database.

### Aplica y prueba la migración local

Después de revisar el SQL:

```powershell
npx.cmd prisma migrate dev
npx.cmd prisma generate
npx.cmd prisma migrate status
npm.cmd run lint
npm.cmd run build
```

Prueba también la funcionalidad que usa el campo o tabla modificados. Si Prisma solicita un reset inesperado, detente y revisa la discrepancia; no lo aceptes automáticamente.

### Incluye la migración en el PR

Sube juntos:

- `prisma/schema.prisma`.
- La nueva carpeta de `prisma/migrations`.
- El código y pruebas relacionados.

Ejemplo; reemplaza `PDGLD-N` por la clave real:

```powershell
git add prisma/schema.prisma prisma/migrations
git commit -m "PDGLD-N: agregar campo de contacto del club"
```

Después sube tu rama y abre un PR hacia `develop`. Si cambió el esquema pero no hay migración, el cambio no está listo para distribuirse.

Una migración aplicada y compartida se conserva intacta. Crea una migración nueva para cambios posteriores; no edites `0_init` ni migraciones que ya recibieron otros.

## 4. Recibir cambios de Sergio o de otro compañero

Después del merge de su PR, con tu árbol limpio:

```powershell
git switch develop
git pull --ff-only origin develop
npm.cmd ci
docker compose -f compose.yml up -d --wait
npx.cmd prisma migrate deploy
npx.cmd prisma generate
npx.cmd prisma migrate status
npm.cmd run dev
```

`git pull` descarga los archivos. `migrate deploy` aplica las migraciones pendientes a tu base local. `generate` actualiza el cliente de TypeScript. No se copian los datos de Docker de Sergio a tu computadora ni a Supabase.

Si estás a mitad de trabajo en una rama, primero guarda tus cambios y coordina la incorporación de `develop`; no cambies de rama o actualices ignorando modificaciones pendientes.

## 5. Aplicar cambios a Supabase

El baseline ya está registrado en la base Supabase actual, destinada a producción. El workflow de [CI/CD](ci-cd.md) utiliza este comando para aplicar migraciones futuras:

```powershell
npx.cmd prisma migrate deploy
```

La conexión de ese proceso debe apuntar a la base Supabase correspondiente. La CLI lee `DIRECT_URL`; la aplicación podrá usar `DATABASE_URL` por separado.

Para verificar el servidor, descarga su certificado desde Database → Settings → SSL Configuration → Download Certificate. Configura la herramienta de conexión para utilizar esa CA y comprobar el nombre del servidor. Conserva las credenciales fuera del repositorio y no desactives la validación del certificado para resolver errores de conexión.

En Prisma CLI 7, la URL de migraciones debe usar `sslmode=require`, `sslaccept=strict` y `sslcert` con la ruta local del certificado de CA. Estos parámetros corresponden a su motor de migraciones; no supongas que el cliente `pg` del backend utiliza exactamente la misma configuración. Esta operación utilizó una URL temporal del proceso y mantuvo `.env` apuntando a Docker.

Antes de desplegar cambios a Supabase, revisa el SQL y comprueba que las tablas protegidas conservan RLS. El pipeline verifica el historial, RLS y permisos de la tabla de migraciones antes y después del despliegue; no activa RLS ni cambia permisos por su cuenta. Detiene de forma conservadora las migraciones pendientes que contienen creación de tablas o desactivación de RLS, hasta preparar y aprobar un plan específico de seguridad de producción. Este filtro no interpreta SQL dinámico ni sustituye la revisión del SQL.

Al crear una nueva base Supabase, ejecutar `migrate deploy` no reproduce por sí solo el RLS de la base actual. Esa seguridad debe configurarse y validarse por separado hasta incorporarla a una migración aprobada. Revisa también los permisos de `public._prisma_migrations`: en la base actual se retiraron los permisos que Supabase asignó por defecto a los roles de API, conservando los del administrador.

RLS activado sin políticas bloquea filas para usuarios ordinarios de PostgreSQL; el propietario y los roles con `BYPASSRLS` pueden omitirlo. La conexión actual como `postgres` no aplica los 12 roles de usuario de la aplicación: el RBAC del backend sigue pendiente y es obligatorio. NextAuth no convierte esos usuarios automáticamente en roles de PostgreSQL.

El workflow está preparado en `.github/workflows/ci-cd.yml`. Prueba los PR y cambios en `develop` y `main` con PostgreSQL temporal 15 y 17. Para producción, primero se revisa e integra una liberación de `develop` a `main`; después Víctor ejecuta manualmente el workflow en `main` con `deploy_production` activado. Debe publicarse y configurarse con los secretos de GitHub antes de usarlo. El push a GitHub por sí solo no modifica Supabase.

Las migraciones nuevas deben conservar el orden del historial de producción. Si dos compañeros crean migraciones en paralelo y una se publica antes, revisa el nombre y SQL de la que todavía no se ha compartido. El despliegue rechaza introducir una migración anterior a otra ya aplicada; una migración compartida o aplicada no se renombra ni se modifica.

No utilices `db push`, `migrate dev` o `migrate reset` para actualizar la base compartida. No reapliques el SQL inicial sobre una base existente.

## Fuentes

- [Baseline de Prisma 7](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/baselining).
- [Creación y edición de migraciones](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations).
- [Aplicación de migraciones en desarrollo y despliegue](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production).
- [Conexión SSL y certificados de Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement).

