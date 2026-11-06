# PDGLD-118 — identificadores de acceso

Contrato local actualizado el 5 de noviembre de 2026. Sustituye la edición directa
de email publicada en PR #43; la evidencia histórica permanece en
[validación de identificadores](../validation/account-identifier-maintenance.md).
El flujo nuevo se detalla en [correo pendiente](account-email-change.md).

## Usuario de acceso

`PATCH /api/account-maintenance/:id/identifiers` recibe exclusivamente
`{changes: {username}, expectedRevision, confirmed: true, reason}`. Los objetos
son estrictos: enviar `email` solo o junto con username da 400. No se interpreta
como solicitud pendiente ni se permite editar identidad, contraseña, estado o roles.

Se reutiliza `usernameSchema`: trim, 1–64 caracteres ASCII (letras, números, punto,
guion y guion bajo), minúsculas. `users_username_unique` sobre `lower(username)`
garantiza unicidad también ante carreras; conflicto se traduce a 409
`DUPLICATE_ACCOUNT`, sin identificar propietario ni devolver SQL. Se conserva la
protección frente a alias de correo ambiguos heredados.

El GET en la misma ruta conserva `{id, username, email, revision}` mínimo para
edición autorizada; email siempre es el vigente, nunca un destino pendiente.
Ambos requieren identidad operativa y `users:UPDATE` global, sin ámbito parcial
ni context_only. Listados siguen sin correo. Respuestas `private, no-store`;
escrituras con origen/JSON controlados y límite de 4096 bytes.

La operación toma bloqueo RF22 exclusivo, reautoriza y bloquea cuenta en la
transacción. Revisión compartida con estado y solicitud/confirmación de correo:
una captura obsoleta da 409 `ACCOUNT_CHANGED`; ausencia de cambio efectivo da
`ACCOUNT_IDENTIFIERS_UNCHANGED`, sin efectos. Un cambio real modifica solo
username, incrementa revisión y versión, revoca sesiones y audita atómicamente.
Conserva email y su prueba de propiedad, contraseña, persona, asignaciones y
referencias. Una edición de username posterior a solicitar correo invalida esa
confirmación por revisión/versión incompatible.

Auditoría mínima: actor/cuenta, motivo, revisiones, nombre del campo cambiado y
revocación; sin identificadores, hashes de contraseña o tokens. Una respuesta
503/perdida exige consulta y nueva decisión; no hay idempotencia por operación
para username. No atribuir éxito por observar únicamente una revisión distinta.

## Correo, autenticación e identidad

El correo cambia solo tras la solicitud y confirmación del
[contrato específico](account-email-change.md). Hasta confirmar, `users.email`
conserva el correo anterior para login. La nueva dirección no se usa para
recuperación/entrega de credenciales por estar pendiente. Confirmar propiedad
no crea una sesión ni constituye recuperación de contraseña.

NextAuth 4 sigue usando CredentialsProvider. `lockAuthUser` relee username/email
bajo FOR UPDATE y `matchesLoginIdentifier` comprueba el identificador vigente
después de esperar. `createIdentityToken` revalida versión al crear sesión. Se
conservan contraseñas, bloqueos, intentos, actividad y cambio obligatorio. Cambiar
el propio username o confirmar correo revoca también las sesiones del afectado.

`people` sigue fuera de este PATCH. Sergio confirmó solicitud del delegado con
evidencia y aprobación administrativa, historial, unicidad de CURP, invalidación
dependiente y reevaluación de habilitación. Su implementación sigue pendiente en
el módulo de jugadores/personas. No basta incrementar `identity_version` para
implementar el historial o corregir todos los estados persistidos. Reset
administrativo PDGLD-119 y recuperación PDGLD-32 también siguen pendientes.

## Preview y pruebas

Conservar las ACL por columna, sin UPDATE completo de users ni administración de
roles. El plan Preview añade las ACL del flujo pendiente y `email_verified_at`,
detalladas en su contrato; no se desactiva RLS ni se cambia Docker a RLS.
Las pruebas sin servicios y las ejecuciones aprobadas de mantenimiento `.203`
y Preview/RLS `.204` en PostgreSQL 15/17 se registran en
[validación de correo](../validation/account-email-change.md).
