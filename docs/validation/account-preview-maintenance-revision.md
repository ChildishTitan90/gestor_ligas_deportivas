# PDGLD-118 — compatibilidad del alta Prisma con Preview

Validación local del 5 de noviembre de 2026 sobre `6287d07`, sin commit ni push
de esta corrección. Referencia: [CI #133 del PR #43](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42122076906).

## Causa confirmada y corrección

Ambos jobs de PostgreSQL del CI fallaron en el paso de Preview/RLS. El log de
PG15 contiene `permission denied for table users` para un INSERT generado por
Prisma cuya lista de columnas comienza con `maintenance_revision`. El esquema
declara `maintenance_revision Int @default(0)`; Prisma materializa ese default
en el INSERT aunque el servicio de alta no envíe la propiedad. La lista
`runtimePrivileges.insert.users` no incluía la columna y el backend devolvía
503 donde `catalog-accounts.test.mjs` esperaba 201.

La corrección añade únicamente `maintenance_revision` a esa lista de INSERT.
No añade UPDATE sobre la revisión o `is_active`, permisos completos de tabla,
concesiones RF22, políticas RLS ni cambios de esquema/migraciones. La provisión
existente sigue validando ACL efectivas por columna y rechazando desviaciones.
Esto recupera el alta; no habilita por defecto el cambio de estado de cuentas
con la conexión Preview.

## Regresión

`tests/integration/preview-prisma-account.mjs` se ejecuta desde
`scripts/test-auth.mjs --preview`, antes de la suite de catálogo afectada, y
también desde el perfil aislado `--account-preview`.

- Usa Prisma generado en la copia, conectado como `gestor_ligas_preview`, con
  RLS activo en users; el puente IPC rechaza una conexión propietaria para este
  caso y conserva las restricciones de host, puerto, base y aplicación.
- Crea persona y cuenta sin proporcionar `maintenance_revision`; comprueba
  revisión inicial 0 y confirma mediante una señal del evento SQL que el INSERT
  incluyó la columna. No guarda parámetros, contraseñas ni filas en el log.
- Verifica INSERT por columna, ausencia de INSERT/UPDATE completos de tabla y
  denegación 42501 de UPDATE sobre revisión y estado, incluso sin filas afectadas.
- Revierte el fixture Prisma completo y comprueba conteos sin cambios.
- Los controles puros fijan la lista previa de UPDATE y comprueban la identidad
  limitada del nuevo caso. La batería RLS existente añade las dos denegaciones.

## Ejecuciones aisladas

```sh
node scripts/test-delegate-isolated.mjs --run-id 118a2026-1105-4e18-8a15-000000000133 --account-preview --execute
node scripts/test-delegate-isolated.mjs --run-id 118a2026-1105-4e18-8a15-000000000134 --account-preview --execute
```

| Ejecución | PG15 | PG17 |
| --- | --- | --- |
| 133: regresión Prisma/RLS nueva | Aprobada | Aprobada |
| 133: perfil Preview completo | Aprobado | Falló la aserción existente de “Subdelegado” en `/access`, después de cambiar contraseña |
| 134: regresión Prisma/RLS nueva | Aprobada | Aprobada |
| 134: perfil Preview completo | Aprobado | Aprobado |

La aserción original no se modificó ni se omitió. Su fallo posterior al alta en
la primera ejecución no se reprodujo en el reintento; no se considera demostrada
la causa de esa incidencia de presentación. Se separó la etiqueta diagnóstica
del recorrido HTTP de la correspondiente a la regresión Prisma.

La repetición aprobó las altas HTTP de delegados y los controles existentes de
ACL, RLS, ámbitos y auditoría del perfil. No equivale a repetir todo CI #133:
`catalog-accounts.test.mjs` completo y las otras suites de CI deberán confirmarse
en el siguiente pipeline. El CI remoto no se reejecutó ni se publicó la corrección.

También aprobaron lint, sintaxis y los 72 controles puros de `npm run test:ci`.

## Aislamiento, limpieza y custodia

Imágenes `postgres:15-bookworm` y `postgres:17-bookworm`, secuenciales; contenedor
y red exclusivos por versión, 768 MiB, 2 CPU y tmpfs sin volúmenes ni bind mounts.
PostgreSQL en loopback 55415/55417 y Next en 56515/56517. Copias sin `.env`,
dependencias propias del lockfile y Prisma 7.10.1 regenerado. Aplicación y
regresión conectadas con el rol limitado; fixtures y provisión solo en las bases
desechables. Sin Supabase, bases habituales, seeds dev/demo ni proveedores reales.

Se comprobó la ausencia de contenedores, redes, procesos, listeners, copias y
cachés propios de ambas ejecuciones. Se conservaron 19 archivos originales de
evidencia en una carpeta privada duradera fuera del repositorio, con manifiesto
SHA-256 verificado, directorios 0700 y archivos 0600. Este informe contiene los
resultados saneados; los registros y logs originales permanecen privados.

Hashes de migraciones publicadas, `compose.yml` y los tres documentos internos
conservados. Stashes intactos e índice vacío.
