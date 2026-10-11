# Gestor de Ligas Deportivas

MVP para la Liga Municipal de Fútbol Amateur de Morelia.

Stack actual: Next.js 16, React 19, Tailwind CSS 4, NextAuth 4, Zod 4 y Prisma 7.10. Desarrollo con Node.js 24.x y PostgreSQL 15 local mediante Docker.

## Instalación del equipo

Sigue la [guía de instalación y trabajo](docs/guia-equipo.md). Incluye Docker Desktop, Git, variables locales, comprobaciones de las 96 tablas y flujo Jira/GitHub.

Resumen para quien ya instaló las herramientas:

1. Clona `develop` después del merge del entorno.
2. Copia `.env.example` a `.env` si no existe; sustituye los marcadores.
3. Ejecuta `npm ci`.
4. Ejecuta `docker compose -f compose.yml up -d --wait`.
5. Verifica las tablas con el comando de la guía.
6. Ejecuta `npx prisma validate` y `npx prisma generate`.
7. Ejecuta `npm run dev` y abre http://localhost:3000.

En PowerShell puedes usar `npm.cmd` y `npx.cmd`.

## Base de datos

`db/init.sql` inicializa una base vacía con 96 tablas en `sports_management`. Docker lo ejecuta solo la primera vez que crea un volumen vacío. El volumen `postgres_data` conserva los datos al detener el contenedor.

El esquema está en `prisma/schema.prisma`; la CLI usa `prisma.config.ts`. El historial de Prisma Migrate queda pendiente en PDGLD-45. No reapliques el SQL ni uses comandos que reinicien la base compartida.

## Flujo del equipo

Crea ramas desde `develop` actualizado: `tipo/PDGLD-N-descripcion`. Incluye la clave real en commits y títulos de PR. Los PR de trabajo apuntan a `develop`; las liberaciones pasan de `develop` a `main`.

Versionamos `.env.example` con marcadores. Los secretos y archivos `.env` no se suben.
