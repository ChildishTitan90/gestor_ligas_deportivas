# Semillas sintéticas, identidad y auditoría — PDGLD-47

Revisión local: 14 de octubre de 2026. PR #3, rama `feat/PDGLD-47-modelar-identidad-roles`, cabeza revisada `49635cbdb72bc2c7ccd7285eeb99465d74e8b95a`, base `develop`. El remoto y el checkout coincidían antes de editar. Se conservó `.next-auth-tests/`, resultado local de PDGLD-48; no forma parte de este cambio.

## Ejecución explícita

Requisitos: Node.js 24, dependencias del lockfile y PostgreSQL local con las migraciones aplicadas. La instalación conserva Prisma, cliente y `@prisma/adapter-pg` 7.10.0; `tsx` 4.23.15 ejecuta TypeScript. No se cambia el esquema ni `0_init`.

En PowerShell, desde la raíz del repositorio:

```powershell
npm.cmd ci
npx.cmd --no-install prisma validate
npx.cmd --no-install prisma migrate deploy
npx.cmd --no-install prisma generate
npm.cmd run db:seed
```

Este procedimiento usa exclusivamente una base **local de desarrollo/pruebas**. Configura `DATABASE_URL` y `DIRECT_URL` en tu `.env` local con tus credenciales, siguiendo `.env.example`. No copies ni publiques conexiones reales. La CLI conserva el historial en `public`; los modelos siguen en `sports_management`. `db:seed` llama a `prisma db seed`, configurado mediante `migrations.seed: "tsx prisma/seed.ts"`. Prisma 7 exige ejecución explícita: migrar no dispara el seed automáticamente. [Documentación oficial](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding).

El seed carga `.env` sin sobrescribir variables del proceso y valida la URL antes de crear el cliente. Admite PostgreSQL en `localhost`, `127.0.0.1` o `::1`, con base y credenciales explícitas; rechaza destinos remotos, fragmentos y parámetros que puedan sustituir host/base/usuario. Si existe `DIRECT_URL`, debe identificar la misma base local. Se admite únicamente el parámetro `schema`, con `public`, `sports_management` o ambos separados por coma, como en el entorno del equipo (`schema=public,sports_management`). Se rechazan esquemas ajenos y listas con entradas vacías. Los errores se reportan sin URL, credenciales, objetos del driver ni datos privados. El adaptador administra y cierra su pool con `$disconnect()`.

## Datos de prueba

El baseline ya contiene los roles oficiales, `SOCCER` y `Liga Municipal de Futbol de Morelia`. El seed recupera `SOCCER` por código y conserva los UUID y nombres existentes de los roles; solo crea un código oficial si falta. No añade variantes, permisos ni asignaciones.

Los 12 códigos son `SUPERADMIN`, `EXECUTIVE_PRESIDENT`, `SECRETARY`, `TREASURER`, `DISCIPLINARY_BOARD`, `REFEREE_MANAGER`, `SCHEDULER`, `CLUB_DELEGATE`, `REFEREE`, `DATA_ENTRY`, `PLAYER` y `GUEST`.

El contexto adicional es **sintético**, conservando los nombres del seed del PR:

| Entidad | Fixture / clave de reutilización |
| --- | --- |
| Liga | `Liga de Fútbol Morelia`, clave `name`, zona `America/Mexico_City`, activa |
| Temporada | `Temporada 2026`, clave `(league_id, sport_id, name)`, estado `PLANNED` |
| Fechas | Inicio `2026-01-01`, fin `2026-12-31`, fechas UTC de PostgreSQL `date` |
| Categoría | `Primera Fuerza`, clave `(league_id, sport_id, name)` |
| Reglamento | Versión `1`, estado `DRAFT`, clave `(season_id, version_number)`, sin aprobación ni archivo |
| Categoría por temporada | Clave `(season_id, category_id)`, reglamento de la misma temporada, jerarquía `1`, tipo `OPEN`, corte `2026-01-01`, edades mínima/máxima sin definir |
| Grupo | `Grupo A`, clave `(season_category_id, name)` y `season_id` de esa categoría por temporada |

Las fechas, jerarquía y tipo permiten probar persistencia y relaciones; **no son calendario ni reglamento aprobados por el cliente**. No se inventan puntos, desempates, elegibilidad, permisos ni parámetros del reglamento. Un fixture existente con fechas, estado, reglamento o categoría por temporada incompatibles produce error y rollback; no se sobrescribe información oficial para hacer pasar el seed.

## Atomicidad y auditoría

Todas las escrituras usan una transacción interactiva. Un bloqueo advisory transaccional serializa corridas simultáneas de este seed. Las búsquedas usan las claves únicas completas del esquema; las FK compuestas mantienen reglamento/categoría por temporada/grupo en la misma temporada. El servicio también selecciona categoría y temporada bajo la misma liga y deporte. No busca temporada, categoría o grupo solo por nombre.

`competition_rules` tiene `record_audit`, y `audit_change()` exige `app.user_id` y `app.reason`; el actor debe existir por FK en `users`. Por eso el fixture crea una persona de auditoría reservada (`47000000-0000-4000-8000-000000000001`) y un usuario sintético `seed-pdgld-47-audit`, correo reservado `seed-pdgld-47-audit@example.invalid`, **inactivo y sin roles**. `password_hash` contiene un marcador inválido para autenticación; no existe contraseña administrativa ni cuenta de acceso. No se crean personas reales, CURP, sesiones o tokens. El UUID del usuario se obtiene por `person_id` único y permanece estable. Si esa identidad fue alterada, el seed falla en lugar de modificarla.

El contexto de auditoría se fija con `set_config(..., true)` en la misma transacción; desaparece al terminar. El trigger genera el único evento `INSERT` del reglamento. El seed no escribe manualmente en `audit_logs`. En repeticiones lee el reglamento sin actualizarlo, evitando eventos adicionales. Tampoco actualiza temporadas, cuyos UPDATE/DELETE están auditados. No desactiva triggers, historial inmutable, protección de temporadas cerradas o de reglamentos aprobados.

## Verificación reproducible

```powershell
npm.cmd run test:seed
```

El harness crea un contenedor PostgreSQL 15 temporal con contraseña aleatoria, puerto dinámico publicado solo en loopback y datos en memoria `tmpfs`, sin volúmenes. No usa `.env` para elegir su destino. Aplica las migraciones mediante `migrate deploy`, genera el cliente y ejecuta `tsx --test tests/integration/seed.test.ts`. Al terminar detiene únicamente el contenedor creado por esa ejecución. No reinicia ni elimina volúmenes del proyecto y no conecta a Supabase.

Las pruebas consultan y comparan contenido completo, cantidades, UUID y relaciones de las 96 tablas antes y después. Antes de las dos ejecuciones exitosas prueban un fallo deliberado en el último INSERT, mediante trigger/función/secuencia exclusivos de la base temporal; comprueban que se alcanzó el grupo y que rollback también revierte actor y auditoría. Esos objetos de prueba se retiran en `finally`, sin alterar migraciones. Luego prueban contextos con nombres iguales y dos ejecuciones simultáneas. También comprueban errores de entorno y conexión sin secretos en salida.

CI ejecuta `npm run test:seed -- --existing` en cada servicio temporal PostgreSQL 15/17 después de sus controles de integridad. Esa opción exige `CI=true`, ambas URL de proceso para `gestor_ligas_ci` en loopback:5432/5433 y solo `schema=public`; requiere la base recién migrada, sin seed previo. No está destinada a bases del equipo ni producción. `test:ci` sigue siendo las 12 pruebas de controles del pipeline; la prueba de seed tiene su comando independiente y paso explícito en CI.

## Evidencia local

Corrección posterior de compatibilidad con el entorno del equipo: la validación inicialmente rechazaba `schema=public,sports_management`. Se amplió exclusivamente la lista de esquemas admitidos, sin cambiar `.env` ni permitir destinos remotos u otros parámetros. Se verificó la configuración local sin abrir una conexión. La prueba de integración ahora ejecuta las dos corridas CLI usando ambos esquemas separados por coma: **19/19 pruebas pasaron** en PostgreSQL 15 temporal con tmpfs, incluyendo rollback, UUID/conteos/relaciones estables, auditoría única y rechazo de esquemas ajenos o entradas vacías. Las dos corridas produjeron los mismos conteos de la tabla siguiente. Las verificaciones anteriores y sus UUID se conservan como evidencia de esa ejecución independiente.

La ejecución inicial del harness, desde una copia aislada con `npm ci` y PostgreSQL 15 en tmpfs, pasó **17/17 pruebas**, sin omisiones. Las cantidades medidas después de cada una de las dos corridas CLI fueron:

| Tabla | Baseline | Primera | Segunda |
| --- | ---: | ---: | ---: |
| roles | 12 | 12 | 12 |
| sports | 1 | 1 | 1 |
| leagues | 1 | 2 | 2 |
| seasons, categories, competition_rules, season_categories, groups (cada una) | 0 | 1 | 1 |
| people, users (cada una) | 0 | 1 | 1 |
| audit_logs | 0 | 1 | 1 |
| permissions, role_permissions, user_roles (cada una) | 0 | 0 | 0 |

UUID observados en ambas corridas de esa misma base temporal:

| Entidad | UUID primera = segunda |
| --- | --- |
| SOCCER | `fd4a4b87-938c-498c-9228-8e8ee5173d07` |
| Liga sintética | `7aff9469-59fb-4454-b811-1a2f39e2d397` |
| Temporada | `59b9be41-051c-4bc2-8f33-0b5c4f15384a` |
| Categoría | `bd44f1d8-43ef-4b92-b87d-e4e6ef7ca6e3` |
| Reglamento | `f7f58b06-b254-4d62-b164-313a408d76f4` |
| Categoría por temporada | `d85cdda9-8f1f-4b5b-9c49-5bcebb623fc8` |
| Grupo | `8de60eac-be45-42fc-b56d-3b0e36274748` |

Estos UUID documentan una prueba, no son identificadores universales. Cada base nueva genera sus UUID; cada repetición sobre la misma base los conserva. La comparación completa también verificó todos los UUID del catálogo y del actor, sus relaciones y los demás datos de las 96 tablas, sin cambios entre corridas. El único evento auditado era `INSERT` de `competition_rules`, con actor sintético y motivo de PDGLD-47; el segundo seed no añadió eventos.

Pasaron `prisma validate`, `test:ci` (12/12), `ci:guard-migrations` y `git diff --check`. En la copia aislada pasaron `npm ci` con generación Prisma 7.10.0, `npm run lint`, `npm run build` (Next.js 16.4/Turbopack, TypeScript, 4 páginas estáticas) y `tsc --noEmit --incremental false`. También pasó ESLint en el checkout excluyendo solo `.next-auth-tests/**` por argumento de ejecución, sin cambiar configuración.

Además, en otro contenedor propio PostgreSQL **15.19** con tmpfs y puerto loopback 5433, pasaron `migrate deploy` (`0_init`), `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (código 0, sin diferencias) y `npm run ci:database` (96 tablas, objetos SQL, restricciones de CURP, savepoints y rollback). Se comprobó allí el modo de CI `npm run test:seed -- --existing`: **17/17**, cero fallos u omisiones, mismos conteos/UUID entre corridas. Ambos contenedores de verificación final fueron detenidos por sus respectivos procedimientos; no se tocaron volúmenes del proyecto.

La compilación directa inicial encontró un fallo de Turbopack en el loader de CSS; el typecheck directo encontró rutas generadas de PDGLD-48 en `.next/dev/types`. La verificación aislada con instalación limpia pasó con los archivos actuales del PR, sin incluir `.env`, `.git`, `.next` ni `.next-auth-tests/`. No se borraron resultados locales para lograr la comprobación y no se ocultaron errores de TypeScript. El historial y `schema.prisma` permanecieron intactos.

## Revisión de identidad y pendientes

Se revisaron `people`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_logs`, `authentication_events` y sus restricciones/triggers del baseline. `users` tiene índices SQL sobre `lower(username)` y `lower(email)` que Prisma no representa como claves `@unique`; el fixture usa `person_id` y no inventa un upsert por nombre. `user_roles` tiene restricciones de periodo y alcance de delegado (club+liga), pero no una clave natural arbitraria para un upsert. Los eventos de autenticación y auditoría son historiales distintos y append-only.

El seed verifica persistencia de identidad y auditoría de su fixture; no implementa login, autorización o RBAC. **La matriz de permisos y sus alcances aprobados sigue pendiente**. Si forma parte del criterio de cierre de PDGLD-47, impide dar por completo el ticket; este cambio no la inventa. Los controles backend de permisos y alcance también requieren su implementación correspondiente. La autenticación PDGLD-48 permanece fuera de este cambio. PostgreSQL 17 y las ejecuciones remotas de CI quedan pendientes hasta publicar la rama; no se ejecutó commit, push, merge, aprobación, despliegue ni cambio en Jira.
