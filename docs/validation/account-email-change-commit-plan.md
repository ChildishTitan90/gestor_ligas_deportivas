# PDGLD-118 — selección del siguiente commit de PR #43

Preparación local del 6 de noviembre de 2026. Sin staging, commit ni push.
Selección comparada contra el head publicado de PR #43:
`619faa0ef393c880c4a1b14034724f86912dbbe3` (HEAD local y remoto del PR).
`origin/develop` actualizado antes de revisar: `53c2628`, ancestro de HEAD.
El PR permanece Draft hacia develop; no se modificó remotamente.

## Resumen del cambio

- Solicitud de correo pendiente y consulta por operación; el anterior conserva
  login hasta confirmar propiedad. Confirmación mediante token aleatorio con hash,
  vencimiento y uso único, independiente de password_resets.
- Revisión/reemplazo y unicidad concurrentes; confirmación atómica de email,
  prueba de propiedad, versión/revisión, auditoría, revocación e invalidación de
  resets previos. No se permite edición directa de email en identifiers; username
  conserva su operación y autenticación con contraseña.
- Transporte intercambiable, sin conexión real ni fallback simulado en producto;
  NOT_CONFIGURED sin proveedor y ningún token en DTO. Simulación solo en pruebas.
- Decisión confirmada SUPERADMIN con protección intacta y error actualizado.
  Reset administrativo y corrección de identidad: acuerdos documentados,
  implementación pendiente en sus contratos propios.
- Migración nueva y ACL mínimas Preview; sin cambios de migraciones publicadas,
  lockfile, versiones o controles de seguridad/producción.

## Archivos exactos seleccionados

La lista es una whitelist para una autorización posterior. No usar git add .,
git add -A ni globs que incorporen los archivos excluidos. M indica modificación
respecto a HEAD; A indica archivo nuevo, todavía no registrado en el índice.

```text
A docs/architecture/account-email-change.md
M docs/architecture/account-identifier-maintenance.md
A docs/architecture/account-maintenance-decisions.md
M docs/architecture/account-maintenance.md
A docs/validation/account-email-change-commit-plan.md
A docs/validation/account-email-change-isolated-results.json
A docs/validation/account-email-change.md
A docs/validation/account-email-request-concurrency.md
M docs/validation/account-identifier-maintenance.md
M package.json
A prisma/migrations/20261105020000_pdgld118_pending_email/migration.sql
M prisma/schema.prisma
M scripts/ci/delegate-preview-privileges.test.mjs
M scripts/preview/runtime-plan.mjs
M scripts/verification/account-isolated-worker.mjs
A src/app/api/account-maintenance/[accountId]/email-change/route.ts
A src/app/api/account-maintenance/email-change/confirm/route.ts
A src/features/accounts/email-change-contract.ts
M src/features/accounts/maintenance-contract.test.ts
M src/features/accounts/maintenance-contract.ts
A src/features/accounts/server/email-change-core.ts
A src/features/accounts/server/email-change.test.ts
A src/features/accounts/server/email-change.ts
M src/features/accounts/server/maintenance-http.ts
M src/features/accounts/server/maintenance.ts
A src/server/email/transport.ts
A tests/integration/account-email-change.mjs
M tests/integration/account-identifiers.mjs
M tests/integration/account-maintenance-preview.mjs
M tests/integration/account-maintenance.test.mjs
```

Resumen numérico de esta selección: 30 archivos (15 modificados y 15 nuevos), +1929/-190 líneas.
Incluye este plan. Los archivos nuevos se contabilizan como adiciones completas;
git diff --stat por sí solo no los muestra mientras no están en el índice.

## Exclusiones exactas preservadas

```text
compose.yml
docs/validation/account-delegate-commit-plan.md
docs/validation/account-delegate-pr-draft.md
docs/validation/account-delegate-worktree-inventory.md
```

Son cambios/documentos ajenos a esta entrega, conservados intactos. No se
seleccionan .env, credenciales, tokens emitidos, logs originales, respaldos,
registros privados o copias temporales. Solo entran resúmenes saneados y hashes
de manifiestos, no los manifiestos/registros originales o sus payloads.

## Correspondencia con lo ejecutado

| Evidencia | PostgreSQL 15 | PostgreSQL 17 | Alcance |
| --- | --- | --- | --- |
| Mantenimiento .203 | Aprobado y limpiado | Aprobado y limpiado | Suite anterior al caso integrado nuevo; no repetida |
| Preview/RLS .204 | Aprobado y limpiado | Aprobado y limpiado | Next/runtime limitado y ACL/RLS, incluido caso nuevo de solicitudes concurrentes |
| Mantenimiento .201 | Sin pruebas por socket Docker | No iniciado | Fallo de entorno; limpieza recuperada |
| Preview/RLS .202 | Sin pruebas funcionales por ETIMEDOUT de npm | No iniciado | Fallo de preparación/red; limpieza verificada |

Los bloqueos no son fallos funcionales ni aprobaciones. Las ejecuciones que
alcanzaron la suite aprobaron. Los acuerdos se reflejan en la
[matriz vigente](../architecture/account-maintenance-decisions.md) y el
[resultado estructurado saneado](account-email-change-isolated-results.json).

La revisión sin servicios comprobó registros y manifiestos privados conservados:
.203 y .204 tienen passed/cleaned en ambas versiones y todos sus archivos coinciden
con sus manifiestos. Los cinco checksums fuente registrados por .204 (suite,
worker, instalador, package.json y lockfile) coinciden con los archivos actuales.
La migración nueva corresponde a la aplicada por el runner, que aplica el SQL del
árbol; no se ha cambiado después. Los 23 archivos versionados de migraciones
(incluido migration_lock.toml) coinciden byte a byte con HEAD. La migración de
mantenimiento anterior ya pertenece al PR publicado, no a este siguiente commit.

Se revisaron el diff de archivos existentes y el contenido completo de todos
los nuevos. El índice permanece vacío. Fuera de la selección solo quedan las
cuatro exclusiones declaradas; no hay otros cambios detectados. Los acuerdos de
Sergio no se presentan como implementación de reset o corrección de identidad.

Verificación previa conservada: 25 pruebas de mantenimiento sin servicios,
74 controles de infraestructura, lint, Prisma validate y tipado completo en copia
independiente sin .env y con tipos regenerados. El entorno original tiene tipos
antiguos; no se afirma que su typecheck directo apruebe. En esta preparación no
se repitieron servicios ni las matrices; solo lectura, comprobaciones estáticas
y correcciones de documentación. El CI remoto de este contenido aún no existe.

## Mensaje de commit propuesto

```text
PDGLD-118: verificar el cambio de correo pendiente y formalizar acuerdos de cuentas

Conservar el correo anterior para login hasta confirmar un token de un solo uso.
Actualizar correo, revisiones, auditoría y revocación de forma atómica; retirar
la edición directa de email y mantener username.

Alinear la protección de SUPERADMIN con la disponibilidad operativa confirmada
por Sergio y documentar los acuerdos de restablecimiento e identidad pendientes.

Validación: mantenimiento .203 y Preview/RLS .204 aprobados en PostgreSQL 15/17,
con limpieza verificada; .204 incluye solicitudes concurrentes y reemplazo.
Transporte simulado solo en pruebas: no acredita entrega real de correo.

Pendientes: transporte real, remitente verificado, plantillas y pantalla
de confirmación. El plan de seguridad de producción sigue pendiente.
```
