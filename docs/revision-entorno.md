# Revisión del entorno — PDGLD-71

Fecha: 11 de octubre de 2026. Responsable consultado en Jira: Sergio.

## Comprobaciones

- `npm ci` instaló las dependencias del lockfile en una copia limpia, sin `--legacy-peer-deps`.
- Se sustituyó el hook `prisma skills sync || exit 0`: Prisma 7.10 de esa instalación no reconoce `skills`. El nuevo hook `prisma generate` se ejecutó correctamente.
- La generación del cliente Prisma, ESLint y `next build` con TypeScript terminaron correctamente.
- La prueba utilizó variables ficticias; no se conectó a Supabase ni ejecutó consultas contra la base real.
- Para esa prueba se copió el motor Prisma desde su caché de lectura al espacio de trabajo y se indicó su ubicación mediante `PRISMA_SCHEMA_ENGINE_BINARY`, porque este entorno restringe escrituras en la caché de Windows. Este ajuste solo se usó en la prueba; no se agregó al proyecto.
- La validación de Docker Compose pasó. El entorno de revisión bloqueó el acceso al motor Docker: no se confirmó el arranque de PostgreSQL ni la ejecución efectiva del SQL.
- Los 96 nombres de tablas declarados en `db/init.sql` coinciden con los 96 modelos de `prisma/schema.prisma`. Esa comparación no sustituye una prueba de DDL, restricciones o triggers en PostgreSQL.

## Auditoría npm

`npm audit --json` reportó 9 entradas con severidad alta, ninguna crítica. Son paquetes afectados, incluyendo dependencias que heredan una alerta; no representan necesariamente nueve fallos independientes.

| Paquete | Relación |
|---|---|
| prisma | Dependencia directa de desarrollo |
| @prisma/config | Dependencia transitiva |
| deepmerge-ts | Dependencia transitiva |
| mysql2 | Dependencia transitiva del tooling; no cambia que la aplicación use PostgreSQL |
| eslint-config-next | Dependencia directa de desarrollo |
| @next/eslint-plugin-next | Dependencia transitiva |
| braces | Dependencia transitiva |
| fast-glob | Dependencia transitiva |
| micromatch | Dependencia transitiva |

Advisories identificados por npm:

- [braces: denegación de servicio por patrones anidados](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- [deepmerge-ts: agotamiento de pila por objetos recursivos](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
- [mysql2: degradación del plugin de autenticación](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr).
- [mysql2: descompresión sin límite](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3).

No se aplicaron correcciones automáticas ni cambios de versión principal. npm propuso Prisma 6.19.3 y eslint-config-next 14.2.35 como cambios principales; no encajan automáticamente con el stack Prisma 7 / Next.js 16.

## Trabajo de PDGLD-71

Sergio debe revisar la ruta de cada dependencia, su exposición real y versiones compatibles; proponer un cambio concreto y comprobar instalación, generación, lint y build después de modificarlo. No usar `npm audit fix --force` sin evaluar el cambio.

## Trabajo que continúa en otros tickets

- **PDGLD-44:** la conexión local y las 96 tablas se verificaron por TCP al preparar el baseline. La configuración de Docker sigue validada; la preparación de Supabase de pruebas debe verificarse aparte.
- **PDGLD-45:** ya existe `prisma/migrations/0_init` y se verificó y registró en Docker y Supabase. La alineación de RLS local queda pendiente por decisión de Víctor; el pipeline todavía no está implementado.
- **PDGLD-47:** RBAC y semillas idempotentes de pruebas.
- **PDGLD-48:** cliente Prisma con su adaptador PostgreSQL y autenticación con NextAuth Credentials/Zod.

Los tickets no se cambiaron de estado ni de asignación durante esta revisión.

## Validación posterior del baseline — PDGLD-45

- La migración completa se ejecutó en una base temporal vacía sobre PostgreSQL 15.19. Su estructura coincidió con la base local existente: 96 tablas, 693 columnas, 579 restricciones, 408 índices, 15 funciones, 119 triggers y 2 vistas; también se verificaron políticas, privilegios y la extensión `btree_gist`.
- `migrate diff` no encontró diferencias entre la base local y el esquema de Prisma. Una ejecución de `migrate dev --create-only` comprobó la reconstrucción en la shadow database sin cambios de esquema; su migración vacía de prueba se retiró.
- Se registró `0_init` en la base local. La estructura y los conteos de las 96 tablas permanecieron iguales. `migrate status` confirmó un historial actualizado y `migrate deploy` confirmó que no había migraciones pendientes.
- La base temporal de prueba se eliminó. No se reinició ni se vació la base local del proyecto.
- La conexión de sesión de Supabase se encontró comentada en `.env`. La verificación SSL inicial falló; se resolvió utilizando el certificado de CA proporcionado por Víctor, conservando la validación del certificado y del servidor.
- Supabase usa PostgreSQL 17.11 y conserva RLS habilitado en las 96 tablas, sin políticas ni `FORCE`. La estructura común coincidió; se verificaron las diferencias de representación de vistas y del privilegio `MAINTAIN` del propietario respecto a PostgreSQL 15 local.
- Se propuso y probó una migración para reflejar RLS localmente; la revisión automática rechazó aplicarla. Víctor eligió conservar RLS solo en Supabase y dejar pendiente la alineación local. La propuesta se retiró del historial activo y no se cambió RLS en Docker.
- Se registró únicamente `0_init` en Supabase. Sus objetos de aplicación, RLS y conteos de las 96 tablas permanecieron iguales. Prisma confirmó que no hay migraciones pendientes en ambas bases.
- Se retiraron los permisos por defecto de los roles de API sobre la nueva tabla `public._prisma_migrations`; `postgres` conserva acceso y el contenido del historial permaneció igual. No se cambiaron los permisos de las tablas de la aplicación.
- `db/init.sql` se conservó como referencia histórica porque la revisión automática rechazó eliminarlo. El montaje que lo ejecutaba se retiró de Compose; el flujo del equipo ahora aplica las migraciones versionadas.

