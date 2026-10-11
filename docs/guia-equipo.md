# Guía del equipo: instalación local y flujo de trabajo

Actualizada el 11 de octubre de 2026. Sprint 1: inicio lunes 12 de octubre.

Esta guía corresponde al repositorio actual: Next.js 16, React 19, NextAuth 4, Zod 4 y Prisma 7.10. PostgreSQL 15 se ejecuta en Docker; Next.js se ejecuta con Node.js en tu computadora.

Cada integrante tendrá su propia base local. Los datos de Docker no se sincronizan con Supabase ni con las bases de los demás.

## 1. Instala estas herramientas una sola vez

- [Node.js 24 LTS](https://nodejs.org/en/download). Instala la versión de mantenimiento disponible de la familia 24.x y conserva npm, incluido con Node. La revisión local se realizó con Node 24.9.0.
- [Git para Windows](https://git-scm.com/downloads/win).
- [Visual Studio Code](https://code.visualstudio.com/download). Extensiones sugeridas: Prisma, ESLint y Tailwind CSS IntelliSense.
- [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/). Usa el backend WSL 2 y contenedores Linux. Si el instalador pide habilitar WSL o reiniciar, completa esos pasos.

Abre Docker Desktop y espera a que indique que el motor está funcionando. Después abre una terminal nueva de PowerShell:

```powershell
node --version
npm.cmd --version
git --version
docker --version
docker compose version
docker info
```

**Resultado esperado:** aparecen las versiones y `docker info` muestra información del servidor. Tener instalado el comando Docker no significa que su motor esté encendido.

En los comandos usamos `npm.cmd` y `npx.cmd` para evitar el bloqueo de scripts de PowerShell. En Git Bash puedes usar `npm` y `npx`.

## 2. Configura tu identidad en Git

Ejecuta estos comandos reemplazando los textos por tus datos. Usa el correo asociado a GitHub o tu dirección privada de GitHub:

```powershell
git config --global user.name "Tu nombre"
git config --global user.email "TU_CORREO_DE_GITHUB"
```

## 3. Clona el proyecto desde develop

Realiza este paso después de que el PR del entorno esté aprobado y fusionado a `develop`. Antes de ese merge, la rama remota `develop` todavía no tendrá estos archivos.

Desde la carpeta en la que quieras guardar el proyecto:

```powershell
git clone --branch develop https://github.com/ChildishTitan90/gestor_ligas_deportivas.git
cd gestor_ligas_deportivas
git remote -v
git status --short --branch
```

**Resultado esperado:** estás en `develop` y `origin` apunta al repositorio del equipo. Clonar crea el repositorio local y configura el remoto automáticamente; no hace falta ejecutar `git init` ni agregar nuevamente `origin`.

GitHub puede pedirte iniciar sesión. Si el repositorio es privado, Víctor debe haberte concedido acceso.

Si ya tienes una copia, revisa primero `git status`. Con el árbol limpio, actualízala:

```powershell
git switch develop
git pull --ff-only origin develop
```

Si tienes cambios pendientes, consérvalos en una rama antes de actualizar. No uses comandos que descarten archivos.

## 4. Crea tus variables locales

En VS Code abre la carpeta del repositorio. Los archivos `package.json`, `compose.yml` y `.env.example` deben quedar en la raíz.

Copia la plantilla solo si todavía no tienes `.env`:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Abre `.env` y sustituye los marcadores. Elige una contraseña local con letras y números; utiliza exactamente la misma en estas tres líneas:

```dotenv
LOCAL_DB_PASSWORD="TU_PASSWORD_LOCAL"
DATABASE_URL="postgresql://postgres:TU_PASSWORD_LOCAL@localhost:5433/gestor_ligas_dev"
DIRECT_URL="postgresql://postgres:TU_PASSWORD_LOCAL@localhost:5433/gestor_ligas_dev"

NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="TU_SECRETO_LOCAL_GENERADO"
```

Genera tu secreto con este comando y pega el resultado en `NEXTAUTH_SECRET`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Guarda `.env` con **Ctrl + S**. Cada integrante usa sus propios valores locales. La plantilla `.env.example` sí se versiona; `.env` permanece excluido de Git.

**Si ya tenías una base local funcionando:** conserva su contraseña. Cambiar `POSTGRES_PASSWORD` o `.env` no cambia la contraseña de un usuario de PostgreSQL que ya existe dentro del volumen.

El proyecto tiene **NextAuth 4**. Usamos sus nombres estándar `NEXTAUTH_SECRET` y `NEXTAUTH_URL`. La versión instalada también acepta `AUTH_SECRET` como alternativa; tu variable anterior no implica por sí sola un error. Instalar NextAuth aún no implementa el login.

Para el desarrollo diario, las dos URL deben apuntar a `localhost:5433`. El acceso a Supabase de pruebas se configura por separado y se comparte por un canal privado cuando haga falta.

## 5. Instala las dependencias

Desde la raíz del repositorio:

```powershell
npm.cmd ci
```

`npm ci` instala las versiones del `package-lock.json` y al terminar genera el cliente Prisma. No instales versiones nuevas de Prisma, NextAuth u otros paquetes individualmente para empezar a trabajar.

La revisión de este entorno pudo actualizar el lockfile sin `--legacy-peer-deps`. Ese indicador no es un requisito general del proyecto. Si tu instalación muestra un conflicto, conserva el error y coordina su revisión con Sergio en **PDGLD-71**.

El comando puede mostrar una advertencia de ESLint y avisos de vulnerabilidades. No ejecutes automáticamente `npm audit fix --force`: la auditoría actual propone cambios de versión principal que requieren revisión.

## 6. Inicia PostgreSQL con Docker

Desde la raíz del proyecto, comprueba los archivos y la configuración:

```powershell
Get-Item compose.yml, prisma/migrations/0_init/migration.sql | Select-Object Name, Length
docker compose -f compose.yml config --quiet
docker compose -f compose.yml up -d --wait
docker compose -f compose.yml ps
```

**Resultado esperado:** el servicio `db` está funcionando y `healthy`. En una base nueva las tablas se crean en el paso siguiente, mediante Prisma.

Docker proporciona PostgreSQL 15 y el volumen `postgres_data` guarda tus datos. Node se conecta a `localhost:5433`; dentro del contenedor PostgreSQL utiliza `5432`. Cada integrante tiene una instancia y datos independientes.

Usamos `-f compose.yml` para seleccionar el archivo correcto. El SQL anterior `db/init.sql` permanece como referencia histórica; ya no está montado para ejecutarse automáticamente.

## 7. Aplica las migraciones y genera el cliente

**Base nueva:** ejecuta lo siguiente. **Base existente sin historial:** primero debe verificarse y registrarse el baseline según [la guía de migraciones](migraciones.md). El baseline de la base local de Víctor ya está registrado.

```powershell
npx.cmd prisma validate
npx.cmd prisma migrate deploy
npx.cmd prisma generate
npx.cmd prisma migrate status
```

**Resultado esperado:** Prisma aplica `0_init` en una base vacía o la omite si ya está registrada. Después informa que el esquema está actualizado y no hay migraciones pendientes.

Las migraciones se guardan en `prisma/migrations`. Incluyen el SQL completo, con funciones, triggers, vistas y restricciones. La CLI carga `DIRECT_URL` desde `.env`; la configuración fija `public` para el historial de migraciones. Las tablas de la aplicación siguen en `sports_management`.

`0_init` también está registrado en Supabase. Por decisión de Víctor, Supabase conserva RLS activado en las 96 tablas y Docker sigue sin RLS. El historial activo no incluye la propuesta de activar RLS localmente; su alineación queda pendiente. Esto no reemplaza los permisos RBAC del backend.

No necesitas `db pull` para instalar o actualizar tu copia. No uses `db push` para distribuir cambios del equipo ni ejecutes comandos de desarrollo/reset sobre Supabase compartido.

## 8. Comprueba las tablas y la conexión

```powershell
docker compose -f compose.yml exec -T db psql -U postgres -d gestor_ligas_dev -v ON_ERROR_STOP=1 -c "SELECT count(*) AS tablas FROM information_schema.tables WHERE table_schema = 'sports_management' AND table_type = 'BASE TABLE';"
'SELECT 1;' | npx.cmd prisma db execute --stdin
```

**Resultado esperado:** 96 tablas iniciales y ejecución correcta de la consulta. El número de tablas puede aumentar con futuras migraciones aprobadas. `db execute` informa éxito o error y no muestra los datos de la consulta.

Si algo falla, revisa los registros y el estado del historial:

```powershell
docker compose -f compose.yml logs --tail 100 db
npx.cmd prisma migrate status
```

No borres el volumen para resolver una discrepancia. Revisa la conexión y el historial antes de aplicar cambios.

## 9. Levanta Next.js

```powershell
npm.cmd run dev
```

Abre [http://localhost:3000](http://localhost:3000). Para detener Next.js usa **Ctrl + C**.

Ver la pantalla inicial comprueba que Next.js funciona. La verificación de base de datos es la de los pasos 7 y 8. La conexión del cliente Prisma de la aplicación y el login siguen siendo trabajo del Sprint; en Prisma 7 hay que implementar correctamente el adaptador del driver para PostgreSQL.

## 10. Trabaja cada día con Jira y GitHub

1. Abre tu ticket en Jira, revisa sus criterios y dependencias. Pasa a desarrollo al comenzar el trabajo.
2. Con tu copia limpia, actualiza `develop` y crea una rama con la clave real del ticket.
3. Desarrolla, comprueba lo que cambiaste y crea commits que comiencen con esa clave.
4. Sube tu rama y abre un **Pull Request (PR)** hacia `develop`. Un PR es una solicitud para revisar e integrar los cambios.
5. Pasa el ticket a revisión y solicita revisión a otra persona. Víctor/Sergio pueden revisar configuración y backend; Nickte/Karol pueden revisar mutuamente UI y también participar como desarrolladoras.
6. Después de integrar y verificar los criterios de aceptación, completa las pruebas y pasa el ticket a hecho.

Ejemplo; reemplaza la clave por la del ticket que realmente te corresponde:

```powershell
git switch develop
git pull --ff-only origin develop
git switch -c feat/PDGLD-48-integracion-nextauth
# Después de realizar y comprobar tus cambios:
git add RUTA_DEL_ARCHIVO_MODIFICADO
git commit -m "PDGLD-48: integrar autenticación con NextAuth"
git push -u origin feat/PDGLD-48-integracion-nextauth
```

Título del PR: `PDGLD-48: integrar autenticación con NextAuth`. Base: `develop`.

Tipos de rama: `feat`, `fix`, `chore`, `docs`. `main` y `develop` reciben cambios mediante PR, conforme a las reglas de protección del equipo. Para liberar a producción se abre otro PR de `develop` hacia `main`.

**Jira:** `Por hacer → Listo para desarrollo → En desarrollo → Revisión de código → En pruebas → Hecho`. Si una revisión o una prueba falla, el ticket vuelve a desarrollo. Incluir la clave relaciona ramas, commits y PR con Jira cuando la integración está configurada; no mueve por sí solo el ticket. No se verificó una automatización de estados en esta revisión.

## 11. Detén y vuelve a iniciar el entorno

El contenedor se detiene al apagar la laptop. Este Compose no configura reinicio automático: al volver a trabajar, abre Docker Desktop y espera a que arranque. Los datos siguen en el volumen.

Para detener PostgreSQL conservando sus datos antes de apagar la laptop:

```powershell
docker compose -f compose.yml stop
```

Para volver a trabajar:

```powershell
docker compose -f compose.yml up -d --wait
npm.cmd run dev
```

No uses `docker compose down -v` como parte del flujo diario: elimina el volumen y sus datos.

## 12. Crea migraciones y recibe cambios del equipo

Si cambias la base, crea y revisa una migración local; el PR debe incluir tanto `schema.prisma` como la carpeta nueva de migración. El procedimiento completo está en [Migraciones de base de datos](migraciones.md).

Después de recibir un PR fusionado, con el árbol limpio:

```powershell
git switch develop
git pull --ff-only origin develop
npm.cmd ci
docker compose -f compose.yml up -d --wait
npx.cmd prisma migrate deploy
npx.cmd prisma generate
npx.cmd prisma migrate status
```

Git descarga los archivos; Prisma aplica los cambios a tu base. No se copian los datos de otro integrante.

## Soluciones rápidas

| Problema | Qué revisar |
|---|---|
| `empty compose file` | Estás en la raíz, `compose.yml` tiene contenido y guardaste con Ctrl + S. |
| Se está leyendo otro Compose | Usa los comandos con `-f compose.yml`; evita mantener un segundo archivo vacío `compose.yaml`. |
| Docker no conecta al motor | Abre Docker Desktop, espera a que arranque y comprueba `docker info`. |
| Falta `LOCAL_DB_PASSWORD` | Copia la plantilla, reemplaza los marcadores y guarda `.env` en la raíz. |
| No encuentra las migraciones | Actualiza tu copia después del merge del baseline; no crees archivos vacíos para ocultar el error. |
| Base existente sin historial | Pide al administrador verificar y registrar el baseline una sola vez. |
| Puerto 5433 ocupado | Revisa `docker ps` y el servicio que lo usa. Coordina otro puerto y cambia las dos URL locales si es necesario. |
| Contraseña rechazada | Las tres variables deben coincidir con la contraseña con la que se creó el volumen. |
| No aparecen las tablas | Revisa la conexión, los logs y `prisma migrate status`; no borres datos para probar. |
| Se muestra la página inicial, pero no hay login | Es normal en el scaffold; PDGLD-48 aún debe implementar la autenticación. |

## Responsables y alcance del Sprint 1

| Ticket | Actividad | Responsable consultado en Jira |
|---|---|---|
| PDGLD-42 | GitHub/Jira, flujo de ramas y PR | Víctor |
| PDGLD-43 | Scaffold y dependencias Prisma/Zod/NextAuth | Víctor |
| PDGLD-44 | Docker local, variables y Supabase de pruebas | Víctor |
| PDGLD-45 | SQL UUID e historial de migraciones | Víctor |
| PDGLD-47 | Identidad, RBAC y semillas idempotentes | Karol |
| PDGLD-48 | NextAuth Credentials, Prisma y Zod | Víctor |
| PDGLD-71 | Avisos npm y dependencias compatibles | Sergio |

La inicialización SQL contiene catálogos, pero no equivale a tener RBAC, cuentas de prueba o login implementados. Se verificó el baseline de Supabase; todavía debe confirmarse que ese proyecto sea el entorno compartido de pruebas adecuado antes de configurar el pipeline.

## Fuentes técnicas

- [Imagen oficial de PostgreSQL: inicialización y volumen](https://hub.docker.com/_/postgres).
- [Configuración de servicios de Docker Compose](https://docs.docker.com/reference/compose-file/services/).
- [Configuración de Prisma 7](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference).
- [Baseline de una base existente con Prisma](https://docs.prisma.io/docs/orm/v7/prisma-migrate/workflows/baselining).
- [Variables de NextAuth 4](https://next-auth.js.org/configuration/options).
