# CI/CD del Gestor de Ligas Deportivas

CI revisa el código y las migraciones antes de integrar cambios. CD aplica las migraciones revisadas a Supabase cuando el administrador inicia una liberación.

## Estado actual

- El flujo y sus controles están preparados localmente. Todavía no se han publicado en GitHub ni guardado en un commit de esta tarea.
- Docker y Supabase ya tienen registrado el baseline `0_init`.
- El environment de GitHub `supabase-production` ya está creado y permite desplegar solamente desde `main`. Su variable `SUPABASE_PROJECT_REF` está configurada.
- Los secretos `SUPABASE_MIGRATION_URL` y `SUPABASE_CA_CERT` ya se guardaron en ese environment con autorización de Víctor. Se comprobó Supabase solo en lectura: 96 tablas con RLS, historial protegido, modelos coincidentes y cero migraciones pendientes.
- Este CD actualiza la base de datos. El despliegue de la página web a un hosting se configurará después.

## Qué hace GitHub automáticamente

Al abrir o actualizar un PR hacia `develop` o `main`, y al integrar cambios en esas ramas, GitHub ejecuta:

1. Instalación con `npm ci` y generación del cliente Prisma.
2. Comprobación de que las migraciones compartidas no se modificaron, borraron ni renombraron.
3. Las 12 pruebas actuales de los controles del pipeline, revisión del código y compilación de Next.js.
4. Reconstrucción de bases temporales PostgreSQL 15 y 17 desde las migraciones. La primera reproduce la versión de Docker; la segunda, la de Supabase.
5. Comparación entre el esquema Prisma y las tablas reconstruidas, además de comprobaciones de integridad y unicidad de CURP.
6. En la propuesta local de PDGLD-48, `npm run test:auth` verifica Credentials mediante HTTP y otra base temporal local en cada versión PostgreSQL. Incluye rechazo, restricción de cambio obligatorio, revalidación de cuenta y reinicio del servidor. La ejecución real de esta ampliación en GitHub queda pendiente de publicar y revisar los cambios; [ejecución local y límites](authentication.md).

Estas pruebas usan bases desechables de GitHub. No consultan ni modifican Supabase.

Cuando todo termina correctamente aparece **CI listo para integrar**. Si una comprobación falla, el check queda en rojo y se debe corregir antes de integrar el PR.

## Primera publicación del flujo

Crea una rama para esta tarea si todavía no estás en ella:

Los archivos están en la copia local que actualmente usa `chore/PDGLD-44-entorno-equipo`. El entorno restringió la escritura de referencias dentro de `.git`; no creó una rama, commit o push. El comando siguiente crea la rama desde esa copia y conserva los commits previos del entorno y baseline. Si todavía no están en `develop`, el PR incluirá también esos antecedentes; revísalos o integra primero el entorno/base antes de liberar CI/CD.

```powershell
git switch -c chore/PDGLD-40-ci-cd
```

Guarda solamente estos archivos:

```powershell
git add .github/workflows/ci-cd.yml scripts/ci/deploy-supabase.mjs scripts/ci/migration-helpers.mjs scripts/ci/guard-migrations.mjs scripts/ci/verify-database.mjs scripts/ci/migration-helpers.test.mjs docs/ci-cd.md docs/guia-equipo.md docs/migraciones.md docs/revision-entorno.md README.md .gitattributes package.json package-lock.json

git commit -m "PDGLD-40: incorporar CI y despliegue controlado de migraciones"

git push -u origin chore/PDGLD-40-ci-cd
```

Abre un PR hacia `develop` con el título:

`PDGLD-40: incorporar CI y despliegue controlado de migraciones`

El push a esta rama de trabajo no inicia un despliegue. Al abrir el PR comenzarán las comprobaciones de CI. Revisa sus resultados en la pestaña **Checks** del PR o en **Actions** del repositorio.

Después del primer resultado correcto, el administrador puede agregar **CI listo para integrar** como status check obligatorio en las reglas existentes de `develop` y `main`. Mantén las restricciones de push y la aprobación por revisión de código que ya tiene el proyecto.

## Configuración de Supabase ya realizada

En GitHub abre **Settings → Environments → supabase-production**.

La rama permitida es `main`, la variable `SUPABASE_PROJECT_REF` está configurada y estos dos **Environment secrets** ya están guardados. Esta tabla documenta cómo mantenerlos o recrearlos; no necesitas cargarlos de nuevo:

| Nombre | Valor que debe guardar el administrador |
|---|---|
| `SUPABASE_MIGRATION_URL` | La conexión de sesión de Supabase, puerto 5432. Está guardada como `DIRECT_URL` comentada en tu `.env`. Copia solamente la URL, sin el nombre de la variable, el signo `#` ni las comillas exteriores. |
| `SUPABASE_CA_CERT` | El contenido completo de `C:\Users\victo\Downloads\prod-ca-2021.crt`, incluyendo las líneas `BEGIN CERTIFICATE` y `END CERTIFICATE`. El valor es el contenido del certificado, no su ruta. |

La conexión transaccional del puerto 6543 podrá usarse para la aplicación según su configuración; este despliegue necesita sesión o conexión directa en el puerto 5432.

Guarda las credenciales en el environment. No las agregues al repositorio, a un PR ni a un ticket. La configuración local del equipo continúa apuntando a Docker.

## Cómo liberar cambios a producción

1. El equipo trabaja en ramas con la clave Jira y abre PR hacia `develop`.
2. Cada PR pasa revisión humana y CI. Al integrar, los compañeros actualizan su Docker siguiendo la guía de migraciones.
3. Cuando una versión está lista para producción, abre un PR de `develop` hacia `main`. Revisa y aprueba sus cambios; exige CI correcto antes de integrarlo.
4. En GitHub abre **Actions → CI y migraciones de producción → Run workflow**.
5. Selecciona la rama **main**, activa **deploy_production** y ejecuta el flujo.

GitHub vuelve a comprobar esa versión. Solo si todo pasa inicia el job **Migraciones Supabase producción**. Si `main` cambió mientras la ejecución esperaba, el despliegue se detiene y se debe iniciar uno nuevo con la versión actual.

Un PR, un push a `develop`, un push a `main` o una ejecución manual con la opción desactivada ejecutan comprobaciones, pero no despliegan la base de producción.

## Cómo aplica las migraciones

El despliegue verifica el proyecto de destino, su certificado SSL y el historial de migraciones ya aplicadas. Después ejecuta `prisma migrate deploy`: aplica únicamente las migraciones pendientes que vienen en la versión revisada de `main`.

Los despliegues de producción se ejecutan uno a la vez. Una nueva ejecución no cancela otra que ya esté aplicando cambios. No se modifica el baseline `0_init` ni se repite su creación de tablas.

Al terminar se comprueban el historial, el esquema Prisma y la seguridad existente. El flujo no ejecuta `db push`, `migrate reset` ni `migrate resolve` para corregir errores automáticamente.

## RLS y cambios que necesitan revisión adicional

RLS permanece habilitado en Supabase y apagado en Docker, conforme a la decisión del equipo. El pipeline no activa RLS ni cambia permisos automáticamente.

Por ahora, el despliegue detiene migraciones que incluyan creación de tablas o desactivación de RLS. Esos cambios necesitan un plan específico de seguridad en Supabase antes de incorporarlos a este mecanismo de liberación.

El filtro de SQL es conservador y puede detectar esas palabras incluso en un comentario; no interpreta SQL dinámico. Un fallo de verificación posterior no deshace las migraciones ya aplicadas. El administrador debe revisar el estado y preparar la corrección adecuada.

La revisión del SQL sigue siendo necesaria: las pruebas en una base vacía no reproducen todos los datos ni todas las reglas de acceso de producción. Si dos PR introducen migraciones en un orden incompatible, el control de historial pide resolverlo antes de desplegar.

## Si algo falla

Abre la ejecución en **Actions**, entra al job en rojo y revisa el paso que falló.

- Si falla CI, corrige la rama y actualiza el PR.
- Si faltan los secretos o el certificado, corrige el environment.
- Si falla una migración de Supabase, revisa el SQL y el estado de la base antes de volver a ejecutar. No borres tablas, volúmenes ni el historial para forzar el despliegue.

Para crear una migración y recibir las del equipo, consulta [la guía de migraciones](migraciones.md).

## Validación realizada y pendiente

- Instalación limpia con `npm ci`, generación del cliente Prisma y compilación Next.js con TypeScript: correctas en una copia aislada sin `.env` real.
- ESLint, las 12 pruebas del pipeline y el control de migraciones existentes: correctos.
- YAML y expresiones de GitHub Actions: verificados con actionlint 1.7.12.
- PostgreSQL local 15: una base temporal nueva se reconstruyó mediante `migrate deploy`; coincidió con el esquema Prisma, verificó 96 tablas y objetos del baseline, UUID, validaciones de CURP y rollback. Solo se eliminó la base temporal identificada como propia.
- Supabase: conexión estricta con CA y servidor verificados; comprobaciones de estructura, historial, RLS y permisos solo en lectura. No se aplicaron migraciones en esta configuración de CI/CD.
- La matriz PostgreSQL 17 y la ejecución real en los runners de GitHub quedan pendientes del primer PR. La prueba local de PostgreSQL 15 no sustituye esa ejecución.
- Persisten las alertas npm ya documentadas en [PDGLD-71](revision-entorno.md); no se cambiaron versiones principales para ocultarlas.

## Fuentes técnicas

- [Entornos y secretos de despliegue de GitHub Actions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- [Servicios PostgreSQL para pruebas en GitHub Actions](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
- [Migraciones de desarrollo y producción con Prisma 7](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production).
- [Conexiones de PostgreSQL en Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
