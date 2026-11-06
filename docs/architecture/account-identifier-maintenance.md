# PDGLD-118 — edición de identificadores de acceso

## Campos y reglas de esta entrega

| Campo | Regla existente reutilizada | Efecto de un cambio real |
| --- | --- | --- |
| `users.username` | Trim, 1–64 caracteres, letras ASCII, números, punto, guion y guion bajo; minúsculas | Nueva revisión, versión de sesión y revocación de todas las sesiones |
| `users.email` | Trim, correo válido, máximo 254 caracteres; minúsculas | El mismo efecto, porque también identifica el acceso |

Se reutilizan `usernameSchema` y `emailSchema` de autenticación, compatibles con
el alta. PostgreSQL garantiza unicidad con `users_username_unique` y
`users_email_unique`, ambos sobre `lower(...)`. Se traducen también sus conflictos
concurrentes a 409 `DUPLICATE_ACCOUNT`, sin identificar al propietario ni devolver
SQL o el valor ocupado. Un correo que coincide con el usuario heredado de otra
cuenta también se rechaza para evitar la ambigüedad ya reconocida por el login.

El permiso requerido es `users:UPDATE` global, no context_only y sin ámbito
parcial, según el servicio de mantenimiento existente. No se añaden permisos ni
roles. La lectura destinada a editar devuelve exclusivamente id, usuario, correo
y revisión, y exige esa misma autoridad de edición. Los listados siguen sin correo.

`PATCH /api/account-maintenance/:id/identifiers` recibe
`{changes: {username?, email?}, expectedRevision, confirmed: true, reason}`.
Se exige al menos un campo; los objetos son estrictos. La revisión se comparte
con baja/reactivación: dos operaciones sobre la misma revisión no pueden ganar.
Una petición sin cambios efectivos devuelve 409 `ACCOUNT_IDENTIFIERS_UNCHANGED`
sin incrementar versiones, auditar o revocar. La lectura previa se obtiene por
GET en la misma ruta, con `Cache-Control: private, no-store`.

El servicio obtiene la identidad del servidor, toma el bloqueo RF22 exclusivo,
autoriza de nuevo, bloquea la cuenta y escribe en una transacción. Id, person_id,
autoría histórica, referencias, contraseña, asignaciones, roles y cargos no
cambian. La auditoría identifica actor y cuenta y registra solo nombres de
campos cambiados, revisiones y la revocación; no copia los identificadores, datos
de persona, contraseñas o tokens. El motivo debe describir la decisión
administrativa sin incluir credenciales ni identificadores personales.

Cada cambio real revoca todas las sesiones e incrementa `users.version` en la
misma transacción. Afecta también a quien edita su propia cuenta. Un login nuevo
necesita el identificador vigente y la contraseña existente. Se revalida el
identificador después del bloqueo de autenticación para que una búsqueda previa
al cambio no autentique posteriormente con el valor antiguo. El mecanismo
existente de creación de sesiones también revalida la versión bajo bloqueo.

Errores recuperables: 400 validación, 404 cuenta ausente, 409 revisión obsoleta,
datos sin cambios o identificador ocupado. En conflicto se vuelve a consultar y
se requiere una decisión nueva; no se reenvía automáticamente. Un 503 o una
respuesta perdida es incierto: consultar no permite atribuir el cambio al envío
anterior. Esta entrega no añade idempotencia por operación ni recuperación de
credenciales. Se mantienen origen, JSON y límite de 4096 bytes del mantenimiento.

## Datos personales y decisiones pendientes

No se habilitan campos de `people`, ni siquiera nombres/apellidos: PDGLD-13/14
los incluyen junto a CURP y nacimiento en la identidad contrastada. El trigger
`version_identity` incrementa `identity_version`; las comprobaciones CURP y las
decisiones de identidad dependen además de fingerprints y versiones. Hace falta
acordar la corrección de personas compartidas, evidencias, invalidación de
verificaciones y revisión de elegibilidad antes de permitir esas escrituras.
Tampoco se habilitan teléfono, domicilio, correo de persona, datos deportivos,
person_id, identificadores técnicos, rol/cargo, contraseña o estado por este PATCH.

El correo de esta ruta es el de acceso en users, no el de contacto en people.
No existe contrato de verificación de propiedad o notificación del nuevo correo;
esas capacidades quedan pendientes. No se marca un correo como verificado ni se
envían mensajes. La política provisional de disponibilidad de SUPERADMIN de la
entrega anterior no cambia. La interfaz y los flujos de recuperación siguen
fuera de esta entrega de backend.

El plan de Preview incorpora UPDATE por columna para username, email, is_active
y maintenance_revision. El permiso de version, la revocación de sesiones y el
INSERT de auditoría ya estaban concedidos. La matriz administrativa inicial no
demostraba Preview/RLS; la comprobación con rol limitado se registra por separado
en [mantenimiento Preview](../validation/account-maintenance-preview.md).

## Revisión de autenticación, recuperación y Preview

`lockAuthUser` mantiene el FOR UPDATE y añade exclusivamente username/email a la
selección de servidor. `credentials.ts` conserva la búsqueda literal y el rechazo
de identidades ambiguas; después del bloqueo, `matchesLoginIdentifier` verifica
el identificador contra la fila actual. Una búsqueda con un valor anterior no
se acepta tras una edición; se verifica una contraseña ficticia y se registra un
fallo sin atribuirlo a una cuenta distinta. La comparación sigue siendo literal
e insensible a mayúsculas, incluidos los usernames heredados con @.

Las ramas de cuenta inactiva, bloqueo temporal, contador de intentos y contraseña
válida no se sustituyen. La edición no reinicia intentos, quita bloqueos ni cambia
`must_change_password`. `createIdentityToken` vuelve a bloquear y compara la
versión obtenida al autenticar: una edición posterior a validar la contraseña
impide emitir una sesión con la versión antigua. El token y los controles de
sesión conservan el cambio obligatorio, vencimiento, estado y revocación. Los dos
campos adicionales no se incluyen en los DTO de sesión.

El backend actual usa únicamente CredentialsProvider: el correo nuevo sigue
necesitando la contraseña vigente para entrar. El esquema users no tiene un
estado de correo verificado y esta operación no crea tal evidencia. No hay
consumidores de `password_resets` ni un proveedor de login/enlace por correo en
el código de aplicación revisado; la presencia de esa tabla no habilita un flujo.

- **PDGLD-119:** la recuperación administrativa y entrega de credenciales requieren
  decidir quién acredita identidad, qué evidencia admite, destinatario y canal
  comprobados, vigencia, intentos y tratamiento de entregas inciertas. Un operador
  con `users:UPDATE` no acredita por ello la propiedad de la dirección nueva.
- **PDGLD-32:** antes de activar recuperación por correo, definir y persistir la
  prueba de propiedad y el destino verificado, separados del simple identificador
  mutable. Vincular tokens a la identidad/versión pertinente y resolver su
  invalidación al cambiar correo; no basta consultar el valor actual de users.email.
  Los tokens de la tabla histórica no se consumen ni se generan aquí.

La verificación y notificación del correo siguen pendientes. No se envían
credenciales, enlaces, códigos o mensajes al modificar estos campos.

| Operación de identificadores | Privilegios Preview actuales | Conclusión de revisión estática |
| --- | --- | --- |
| GET autorizado | SELECT users y privilegios de autorización/bloqueo existentes | Sin nuevas ACL de lectura; se verifica con el perfil limitado |
| PATCH de identificadores | UPDATE(username, email, maintenance_revision, version), UPDATE sessions.revoked_at e INSERT de auditoría | Concesión mínima de las tres primeras columnas; version y dependencias ya estaban cubiertas |
| PATCH de estado | UPDATE(is_active, maintenance_revision, version) y las mismas dependencias | Añade is_active y comparte la revisión con edición |

El PATCH asigna ambos identificadores, incluso al editar solo uno. is_active se
concede expresamente para baja/reactivación, no por arrastre de la edición. No se
otorga UPDATE completo de tabla ni nuevas ACL de roles/asignaciones o membresías.
RLS sigue habilitado y el servidor exige autorización global por operación; una
conexión backend con políticas permisivas no reemplaza ese RBAC. El perfil
`--account-maintenance-preview` identifica las conexiones de Next y comprueba su
LOGIN real, separado del propietario usado para preparar y observar fixtures.
