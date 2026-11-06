# PDGLD-118 — mantenimiento con Preview/RLS

Validación del 5 de noviembre de 2026 sobre `71c7290` y el paquete local de
identificadores y compatibilidad Preview, sin staging, commit ni push.

## SQL y privilegios mínimos

La comparación del plan completo con HEAD muestra una única ampliación:
UPDATE por columna de `users.username`, `email`, `is_active` y
`maintenance_revision`. No cambian las políticas, la matriz RF22, roles,
asignaciones, membresías ni privilegios completos de tabla.

| Operación | Columnas/operaciones SQL utilizadas | Cambio de ACL |
| --- | --- | --- |
| GET lista, detalle y datos de edición | SELECT de users y catálogo de autorización; bloqueo de autorización existente | Ninguno: SELECT y soporte de bloqueos ya concedidos |
| PATCH identificadores | UPDATE users.username, email, maintenance_revision, version | Las tres primeras; version ya concedida |
| PATCH baja/reactivación | UPDATE users.is_active, maintenance_revision, version | is_active y revisión compartida; version ya concedida |
| Revocación de ambos PATCH | UPDATE sessions.revoked_at; SELECT user_id, revoked_at e id para filtro/resultado | Ninguno; se conservan last_activity_at/expires_at requeridos por autenticación |
| Auditoría de ambos PATCH | INSERT audit_logs.id, user_id, action, table_name, entity_id, previous_data, new_data, reason, occurred_at; lectura de resultado | Ninguno: incluye los defaults materializados por Prisma |

El runtime es un LOGIN privado de backend. RLS permanece activo, sin BYPASSRLS,
superusuario, CREATE ROLE/DB ni membresías. Sus políticas no reemplazan el RBAC:
cada endpoint conserva identidad operativa y permiso global del servidor. No se
concede UPDATE completo de tabla ni acceso de administración adicional a roles
o asignaciones. La autorización de lectura/edición no procede del navegador.

## Ejecución real con rol limitado

Comando presentado antes de iniciar los servicios:

```sh
node scripts/test-delegate-isolated.mjs --run-id 118a2026-1105-4e18-8a15-000000000318 --account-maintenance-preview --execute
```

El nuevo perfil reutiliza **la misma suite completa** de mantenimiento y sus
reglas de identificadores, sin duplicar servicios ni omitir aserciones. Separa:

- Propietario postgres para migraciones, provisión, fixtures y observación de
  datos/estadísticas en la base desechable.
- Next con DATABASE_URL y DIRECT_URL del LOGIN `gestor_ligas_preview`.
- Pruebas SQL y Prisma con otra conexión limitada a esa misma base.

El puente IPC exige destinos loopback, puertos fijos, base propia y roles
distintos; rechaza una URL propietaria usada como runtime, otra base o un destino
externo. Las conexiones de Next se etiquetan mediante application_name y se
comprueba en pg_stat_activity que todas usan realmente el LOGIN limitado. La
conexión de las pruebas SQL no puede satisfacer esa comprobación por sí sola.

| Regresión | PG15 | PG17 |
| --- | --- | --- |
| GET autorizado de lista, detalle y edición con cabecera privada | Aprobada | Aprobada |
| PATCH autorizado de username/email y baja/reactivación | Aprobada | Aprobada |
| Denegación sin sesión/permiso global o con ámbito insuficiente | Aprobada | Aprobada |
| Revisión obsoleta, disputas de unicidad y conflicto edición/estado | Aprobada | Aprobada |
| Conservación de persona/referencias/asignaciones y auditoría mínima | Aprobada | Aprobada |
| Revocación, cookies antiguas, reactivación, edición propia y carrera del login | Aprobada | Aprobada |
| Fallo de auditoría revierte escritura, revisión, versión y sesiones | Aprobada | Aprobada |
| Protección de bajas concurrentes SUPERADMIN y rechazo de alternativas no disponibles | Aprobada | Aprobada |
| Alta Prisma con default maintenance_revision y rollback de fixture | Aprobada | Aprobada |
| RLS activo e identidad SQL de aplicación/probe limitadas | Aprobada | Aprobada |
| ACL por columna exactas; sin UPDATE de tabla ni atributos/membresías privilegiados | Aprobada | Aprobada |
| UPDATE denegado en users.id/person_id/created_at/MFA, people.first_name, sesiones ajenas a revocación, auditoría histórica y roles/asignaciones | Aprobada | Aprobada |
| Ledger denegado, aislamiento público y reprovisión idempotente sin cambiar datos/RBAC/atributos | Aprobada | Aprobada |

Los casos que antes exigían denegar UPDATE de maintenance_revision/is_active se
ajustaron a la concesión ahora autorizada y se sustituyeron por columnas ajenas
al alcance. No se eliminaron los controles de inmutabilidad ni se amplió la
tabla completa. `SUPERADMIN_AVAILABILITY_DECISION_REQUIRED` conserva su política
provisional; verificar el rechazo no decide que esas bajas deban permitirse.

También aprobaron lint, sintaxis, los 73 controles puros del pipeline y las 10
pruebas de mantenimiento. Esta integración justifica cerrar la brecha del GET
que anteriormente era solo una conclusión estática. La matriz administrativa
anterior sigue documentada por separado: no se reinterpretó como prueba RLS.

## Recursos, limpieza y evidencia

PostgreSQL 15 y 17 secuenciales, imágenes postgres:15/17-bookworm, contenedor y
red exclusivos por versión, 768 MiB/2 CPU y tmpfs sin volúmenes ni bind mounts.
PostgreSQL en 127.0.0.1:55415/55417; Next en 127.0.0.1:56515/56517. Copias sin
`.env`, instalación npm ci del lockfile y Prisma regenerado. Se aplicaron SQL de
migraciones, provisión y fixtures exclusivamente en las bases desechables.

Se comprobaron la eliminación de bases, contenedores, redes, procesos,
listeners, copias y cachés propios. Se conservaron nueve archivos originales
de evidencia en una carpeta privada duradera, con hashes SHA-256 verificados,
directorios 0700 y archivos 0600. Los originales no se proponen para versionar.
Este informe es el resultado saneado.

`compose.yml`, documentos internos, stashes y migraciones publicadas conservan
sus hashes. Los servicios de mantenimiento, contratos y pruebas de
identificadores del paquete previo no se modificaron para hacer pasar Preview.
Sin Supabase, bases habituales, proveedores reales, staging, commit ni push.

El nuevo perfil es una validación local ejecutable, no un despliegue ni una
afirmación de CI remoto aprobado. Los controles puros del selector/ACL están en
test:ci; el workflow actual no ejecuta automáticamente esta matriz HTTP completa.
Se mantienen pendientes datos personales/deportivos, interfaz y las decisiones
de verificación/entrega de correo de PDGLD-119/32.
