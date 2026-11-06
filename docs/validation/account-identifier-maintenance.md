# PDGLD-118 — validación de edición de identificadores

Validación del 5 de noviembre de 2026 sobre `71c7290` y los cambios locales de
esta entrega. Sin staging, commit ni push. Reglas y decisiones pendientes en
[edición de identificadores](../architecture/account-identifier-maintenance.md).

## Alcance implementado

GET/PATCH `/api/account-maintenance/:id/identifiers`, con `users:UPDATE` global,
contrato estricto, normalización existente de username/email y revisión
administrativa compartida con baja/reactivación. Los índices de PostgreSQL
garantizan unicidad insensible a mayúsculas ante concurrencia; los conflictos
devuelven `DUPLICATE_ACCOUNT` sin revelar la identidad ocupada. Se rechazan
también correos que colisionan con usernames heredados de otra cuenta.

Estado personal, person_id, autoría histórica, referencias, roles, cargos y
vigencias permanecen intactos. Un cambio real incrementa revisión y versión de
sesión, revoca todas las sesiones y audita en una sola transacción. El evento
guarda campos cambiados y revisiones, no los valores de acceso ni secretos.
El login revalida el identificador vigente después de obtener el bloqueo de la
cuenta para rechazar una búsqueda anterior a la edición.

## Pruebas sin servicios

- Mantenimiento: 10/10, incluidos cinco casos nuevos de normalización, campos
  prohibidos, revisión/no-op, traducción acotada de índices y revalidación de login.
- Alta de cuentas: 24/24; pipeline y aislamiento: 72/72. Total: 106 pruebas.
- Lint y sintaxis aprobados.
- Typecheck completo aprobado en una copia sin `.env`, con dependencias exactas
  del lockfile, Prisma 7.10.1 generado y rutas regeneradas con `next typegen`.
  Se corrigió una anotación de tipo de la consulta; no se relajaron los tipos.
  La copia se eliminó y el entorno generado del workspace no se modificó.

## Integración PG15/17

Comando de la ejecución final aprobada:

```sh
node scripts/test-delegate-isolated.mjs --run-id 118a2026-1105-4e18-8a15-000000000221 --account-maintenance --execute
```

La suite completa `account-maintenance.test.mjs` aprobó en ambas versiones,
incluidos los siete casos anteriores de consulta/estado y ocho casos nuevos:

| Caso nuevo | PG15 | PG17 |
| --- | --- | --- |
| Lectura de edición y PATCH denegados sin autoridad global; rechazo de campos personales/deportivos | Aprobado | Aprobado |
| Usuario/correo ocupados, alias heredado y captura sin cambios sin efectos | Aprobado | Aprobado |
| Edición normalizada conserva persona completa, campos estables de users y asignaciones; auditoría mínima, cookies revocadas y acceso nuevo | Aprobado | Aprobado |
| Dos cuentas disputan username y email: un éxito y un conflicto por cada campo | Aprobado | Aprobado |
| Edición y baja con la misma revisión: solo una escritura confirma | Aprobado | Aprobado |
| Fallo de auditoría revierte identificadores, revisión, versión y sesiones todavía activas | Aprobado | Aprobado |
| Login ya descubierto espera el bloqueo y rechaza el identificador anterior | Aprobado | Aprobado |
| Edición del propio correo revoca la sesión del actor y permite un login nuevo | Aprobado | Aprobado |

El caso de carrera del login usa una escritura sintética controlada sobre la
fila bloqueada para situar la edición entre búsqueda y autenticación. No es una
modificación del backend de producto. Tres ejecuciones previas (218–220) no
aprobaron PG15 y no iniciaron PG17. Se corrigió el fixture, que observaba el mismo
snapshot de estadísticas durante la transacción, con `pg_stat_clear_snapshot()`;
la aserción del bloqueo se mantuvo. Véase la [documentación de PostgreSQL](https://www.postgresql.org/docs/15/monitoring-stats.html#MONITORING-STATS-VIEWING).
El diagnóstico del runner conserva solo archivo/línea mediante IPC, sin cuerpos
HTTP, datos de las aserciones ni logs completos de autenticación.

## Aislamiento, conservación y límites

Recursos presentados antes de cada inicio: imágenes `postgres:15-bookworm` y
`postgres:17-bookworm`, secuenciales, contenedor y red propios por versión,
768 MiB/2 CPU, tmpfs sin volúmenes ni montajes del repositorio. PostgreSQL en
loopback 55415/55417 y Next en 56515/56517. Copias sin `.env`, instalación propia
`npm ci` y Prisma regenerado. Migraciones, catálogo y fixtures únicamente en
bases desechables del runner.

Se comprobaron limpieza de contenedores, redes, procesos, listeners, bases,
copias y cachés propios, y la eliminación de la copia de TypeScript. Evidencia
de las cuatro ejecuciones y del typecheck conservada fuera del repositorio en
una carpeta privada duradera con manifiesto SHA-256 verificado. Solo este informe
contiene resultados saneados para revisión.

En esta matriz administrativa inicial no se amplió la ACL de Preview ni se modificaron migraciones
publicadas. `compose.yml`, los tres documentos internos y stashes se conservaron.
Sin Supabase, bases habituales ni consultas a proveedores reales de CURP/INE.
Esta matriz no acredita edición con el rol Preview ni un nuevo CI remoto. La
ampliación mínima y su validación se registran después en
[mantenimiento Preview](account-maintenance-preview.md).

## Revisión inicial de la entrega para el PR #43

Se revisaron los 16 archivos locales y los consumidores de autenticación/sesión,
el proveedor NextAuth y el plan SQL de Preview. No se encontró un bypass en la
revalidación del identificador: conserva el bloqueo, la política de intentos y
cambio obligatorio; la sesión se vincula a la versión comprobada bajo bloqueo.
Esta conclusión combina revisión estática y las pruebas ya registradas; no se
repitieron suites durante la preparación documental.

La matriz inicial usa conexión **administrativa postgres** en copias
desechables y comprueba RBAC de aplicación. No demuestra el alcance SQL de un
LOGIN limitado ni RLS. La validación Preview anterior de alta Prisma, documentada
en `account-preview-maintenance-revision.md`, corresponde a otra operación y
no acredita este PATCH. En la ACL inicial faltaban UPDATE(username, email,
maintenance_revision); el GET no necesita nuevas columnas según la revisión
estática, pero tampoco se ejecutó bajo el rol limitado. No se concedieron permisos.

Cambiar el correo no lo marca como verificado ni habilita recuperación o entrega
de credenciales. Las condiciones previas de PDGLD-119 y PDGLD-32 se detallan en
el documento de arquitectura. No hay implementación de esos flujos que pueda
usar automáticamente la nueva dirección en esta entrega.

Estado del alcance: username/email completados y validados localmente, pendientes
de commit/publicación en el PR. Datos personales/deportivos, interfaz y edición
con el runtime Preview limitado seguían pendientes en esa revisión; esta última
brecha se aborda en el informe posterior enlazado. El PR remoto solo contiene
los commits publicados; su descripción debe distinguirlos del paquete local.

Pendientes: flujo de corrección de personas compartidas e invalidación de
verificaciones de PDGLD-13/14 (incluidos nombres/apellidos), propiedad/notificación
del nuevo correo, recuperación de credenciales e interfaz. Los campos de persona
y deportivos permanecen rechazados; no se marca correo verificado ni se envían
mensajes. La política provisional de disponibilidad SUPERADMIN sigue vigente.
