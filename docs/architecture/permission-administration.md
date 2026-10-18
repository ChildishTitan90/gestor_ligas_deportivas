# PDGLD-54: administración de asignaciones de permisos

El servicio `src/features/permissions/server/service.ts` administra exclusivamente
los vínculos de `role_permissions` con roles y permisos que ya existen. No crea
roles, módulos, acciones o contextos y no contiene una segunda matriz RF22. El
catálogo inicial pertenece a `prisma/permissions-data.ts` de PDGLD-55. Los casos
de `tests/integration/permission-administration.test.mjs` son fixtures sintéticos
aislados en una base local desechable, no concesiones de producción.

## Entradas y contratos

Todas las entradas obtienen la identidad con la sesión NextAuth 4 existente y
`requireOperationalUser()`. No aceptan actor, rol autorizante ni permisos desde
el navegador. Las respuestas llevan `Cache-Control: private, no-store`.

| Entrada | Permiso requerido | Contrato |
| --- | --- | --- |
| `GET /api/permissions` | `users / READ`, global | Catálogo y asignaciones de todos los roles. |
| `GET /api/permissions?roleCode=SUPERADMIN` | El mismo permiso global | Catálogo de permisos y asignaciones del rol seleccionado. |
| `PATCH /api/permissions` | `users / UPDATE`, global y sin caducidad; autoridad sobre la concesión según las reglas siguientes | JSON validado descrito abajo. |

Una lectura devuelve `{ roles: [{code,name}], permissions: [{id,module,action}],
assignments: [{id,roleCode,permissionId,contextOnly}] }`. No incluye titulares de
cuentas, sesiones, hashes ni otros datos personales. El filtro acepta un solo
`roleCode` del catálogo, sin parámetros adicionales.

Para conceder o cambiar el alcance de un vínculo:

```json
{
  "roleCode": "SECRETARY",
  "permissionId": "uuid-del-permiso-existente",
  "granted": true,
  "contextOnly": true,
  "reason": "Motivo concreto de la decisión administrativa"
}
```

Para revocar se envían `roleCode`, `permissionId`, `granted: false` y `reason`.
No se envía `contextOnly` en una revocación. El motivo tiene entre 10 y 500
caracteres; los objetos son estrictos. La entrada exige JSON, origen de confianza
según `NEXTAUTH_URL`, rechaza `sec-fetch-site: cross-site` y limita el cuerpo a
8 KiB. No se habilita CORS. No hay pantalla administrativa en este ticket.

Respuesta correcta: `{roleCode,permissionId,granted,changed}`. Repetir una
solicitud que ya coincide con la base devuelve `changed: false` sin generar un
evento artificial de auditoría. No sustituye controles de concurrencia de una
futura interfaz: cada petición expresa una decisión individual sobre un vínculo.

| Estado | Código | Significado |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | No existe una sesión autenticada vigente. |
| 403 | `PASSWORD_CHANGE_REQUIRED` | La sesión solo permite cambiar la contraseña. |
| 403 | `FORBIDDEN` | Falta autoridad global vigente para administrar la concesión solicitada. |
| 403 | `INVALID_ORIGIN` | Escritura enviada desde un origen no permitido. |
| 400 | `VALIDATION_ERROR`, `INVALID_PAYLOAD`, `INVALID_CATALOG_ENTRY` | Contrato o catálogo inválido. |
| 409 | `LAST_PERMISSION_MANAGER` | El cambio dejaría sin un gestor permanente operativo. |
| 413 | `PAYLOAD_TOO_LARGE` | Cuerpo superior al límite. |
| 503 | `SERVICE_UNAVAILABLE` | Fallo interno sin exponer información de conexión. |

## Reglas contra escalamiento

Un vínculo de rol afecta a todos sus titulares actuales y futuros; no puede
editarse desde un ámbito local. Toda escritura requiere `users /
UPDATE` global, vigente y sin caducidad. Para conceder o ampliar un vínculo,
incluso con `contextOnly: true`, se comprueba además una de estas facultades:

- El actor ya posee ese mismo módulo/acción mediante una asignación global,
  `context_only = false`, vigente y sin `ends_at`.
- Para una concesión operativa, el actor posee `users / APPROVE`
  global, vigente y sin caducidad. Esta es una facultad administrativa explícita
  para aprobar asignaciones; no concede el derecho a ejecutar la operación.

Los permisos de autoridad del módulo canónico `users` siempre
exigen la primera condición, sin alternativa por APPROVE. La clasificación se
comparte con la delegación de roles mediante `isAuthorityPermissionModule` en el
motor común. Un módulo futuro que gestione autoridad debe incorporarse a esa
clasificación antes de habilitar sus concesiones.

Esta distinción respeta la RF22: un gestor de usuarios y roles puede administrar
la concesión de programación CREATE/UPDATE aunque su propia operación de
programación sea READ/APPROVE. Exigirle todos los permisos operativos cambiaría
de hecho esa separación de funciones. Tener solo `users / UPDATE`
mantiene la administración limitada a facultades operativas ya poseídas. El
catálogo aprobado representa esta aprobación mediante `users / APPROVE`.
El motor no agrega concesiones ni usa la matriz inicial como fallback.

Una delegación temporal no produce una concesión permanente, porque
`role_permissions` no contiene fecha de expiración. Tanto UPDATE como la
facultad que respalda la concesión deben provenir de asignaciones sin caducidad.
Las lecturas pueden usar autoridad temporal mientras esté vigente.

Las comprobaciones se realizan sobre PostgreSQL en la transacción. No se usa el
nombre de un rol para autorizar. SUPERADMIN puede recibir, ajustar o perder sus
concesiones por este mismo contrato. Modificar un rol que tiene el propio actor
requiere las mismas facultades administrativas explícitas; nunca permite crear
autoridad de cuentas o permisos que el actor no posea. Revocar APPROVE retira en
la siguiente petición con la misma sesión la facultad de aprobar concesiones
operativas ajenas, aunque UPDATE siga vigente.

## Atomicidad, concurrencia y último gestor

Antes de autorizar o leer los vínculos que se editarán, la escritura toma
`lockAuthorization(tx, "exclusive")`, bloqueo consultivo de transacción
PostgreSQL `(54, 2026)`. Los guards de autorización toman la versión compartida
de ese mismo bloqueo. Se evita promover un bloqueo compartido a exclusivo y
se serializan dos cambios de política concurrentes. La segunda petición vuelve
a comprobar el estado confirmado por la primera.

Tras escribir y antes del commit debe existir al menos una cuenta activa, sin
cambio obligatorio ni bloqueo vigente, con autoridad global de READ y UPDATE
para `users`, ambas sin caducidad, iniciadas y `context_only = false`.
Las capacidades pueden proceder de roles diferentes de esa misma cuenta, pero
cada permiso conserva la relación con su propia asignación global. La consulta
protege las cuentas candidatas con `FOR SHARE`. No cuentan cuentas temporales,
inactivas, bloqueadas, concesiones locales, futuras o finitas.

Si falta ese gestor, se revierte el vínculo y su auditoría. El test concurrente
envía dos revocaciones que separadamente parecerían válidas y comprueba que solo
una confirma y la otra recibe 409. Ninguna migración es necesaria.

Toda futura operación que modifique `user_roles`, los permisos o desactive una
cuenta gestora debe reutilizar este bloqueo exclusivo y preservar el mismo
invariante antes del commit. El bloqueo consultivo coordina los servicios de la
aplicación; cambios SQL administrativos externos pueden omitirlo y deben seguir
un procedimiento equivalente. No se agregan triggers ni restricciones al esquema.

## Auditoría y coordinación

El baseline ya contiene el trigger `record_audit` sobre `role_permissions`. El
servicio configura `app.user_id` y `app.reason` dentro de la transacción y permite
que el trigger registre exactamente una vez INSERT, UPDATE o DELETE junto con
sus valores anterior/nuevo. No inserta eventos manuales duplicados. Los motivos
son texto administrativo: no deben incluir contraseñas ni datos sensibles.

El PR #12 de Sergio ya aporta el catálogo aprobado: `users` es su único módulo
de usuarios y roles. `role_permissions` conserva su nombre de tabla; este servicio
no instala concesiones de arranque ni crea permisos equivalentes con otros módulos.
Karol puede ampliar pruebas en archivos independientes; el runner debe invocar
`runPermissionAdministrationSuite({databaseUrl,baseUrl})` sobre la base temporal
local, antes de escenarios que agreguen otros gestores. La suite aísla/restaura
los vínculos administrativos previos solo en esa base desechable para comprobar
el caso del último gestor. Nickte puede consumir estos DTO y códigos en futuras
interfaces sin importar módulos de servidor en componentes cliente.
