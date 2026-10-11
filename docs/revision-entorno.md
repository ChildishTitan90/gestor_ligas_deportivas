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

- **PDGLD-44:** confirmar en Docker Desktop que el servicio está sano, que existen las 96 tablas y que la URL local permite conectarse. La preparación de Supabase de pruebas debe verificarse aparte.
- **PDGLD-45:** construir el baseline e historial de migraciones sin perder objetos SQL especiales. Hoy no existe `prisma/migrations`.
- **PDGLD-47:** RBAC y semillas idempotentes de pruebas.
- **PDGLD-48:** cliente Prisma con su adaptador PostgreSQL y autenticación con NextAuth Credentials/Zod.

Los tickets no se cambiaron de estado ni de asignación durante esta revisión.

