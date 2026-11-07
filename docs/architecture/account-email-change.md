# PDGLD-118 — correo pendiente y confirmación de propiedad

Implementación local del 5 de noviembre de 2026, posterior al head publicado de
PR #43 (`619faa0`). No publicada. Mantenimiento `.203` y Preview/RLS `.204`
validados en PostgreSQL 15/17, conforme al informe enlazado. El caso de solicitudes
concurrentes se ejecutó contra PostgreSQL en `.204`. La
conservación del correo anterior para login, antes propuesta técnica, fue
autorizada por el usuario al solicitar esta implementación.

## Contrato HTTP actual

Todas las respuestas son `private, no-store`. Las escrituras exigen JSON, origen
permitido y cuerpo de hasta 4096 bytes mediante el control compartido. Los
servicios exclusivos de servidor contienen reglas y transacciones.

- `POST /api/account-maintenance/:accountId/email-change`: identidad operativa
  y `users:UPDATE` global; recibe `{email, operationKey, expectedRevision, reason,
  confirmed: true}`. UUID de operación estable, correo normalizado con el esquema
  de autenticación y motivo de 10–300 caracteres. Devuelve 202 por intención
  persistida, **sin afirmar entrega**. DTO: `id`, `status`, `revision`, `expiresAt`,
  `confirmationDelivery`, `previousNoticeDelivery`, `completionNoticeDelivery`.
- `GET /api/account-maintenance/:accountId/email-change?operationKey=UUID`:
  requiere la misma autoridad y el mismo solicitante que creó la operación.
  Consulta la intención después de una respuesta incierta, sin secretos ni
  direcciones. El vencimiento efectivo también se determina por `expiresAt`;
  `PENDING` significa no consumido, no garantiza que cuenta/autoridad sigan válidas.
- `POST /api/account-maintenance/email-change/confirm`: recibe exclusivamente
  `{token}` en el cuerpo. La posesión del secreto prueba propiedad del destino;
  no necesita sesión del destinatario ni crea una. Revalida el administrador
  solicitante desde el servidor y su permiso global vigente. Devuelve
  `{status: "CONFIRMED", revision, sessionsRevoked: true, completionNoticeDelivery}`.
  GET no consume tokens (405). No hay tokens en query strings o respuestas.
- `PATCH /api/account-maintenance/:accountId/identifiers`: acepta solo
  `{changes: {username}, expectedRevision, reason, confirmed: true}`. `email`,
  incluso junto con username, devuelve 400; no se convierte silenciosamente en
  solicitud pendiente. El GET de identificadores conserva el correo vigente.

Errores adicionales: 409 `EMAIL_CHANGE_INVALID` para secreto incorrecto, usado,
reemplazado, vencido o cuenta incompatible; `ACCOUNT_CHANGED`,
`ACCOUNT_IDENTIFIERS_UNCHANGED`, `ACCOUNT_NOT_OPERATIONAL`, `DUPLICATE_ACCOUNT`,
`EMAIL_OPERATION_CONFLICT`; 429 `EMAIL_CHANGE_RATE_LIMITED`; 404
`EMAIL_CHANGE_NOT_FOUND`/`ACCOUNT_NOT_FOUND`; validación 400, identidad/autoridad
401/403 y fallo interno 503 sin diagnóstico sensible. La revocación de autoridad
del solicitante produce 403 también en confirmación.

## Persistencia y transacciones

Migración nueva `20261105020000_pdgld118_pending_email`; baseline y migraciones
publicadas intactos. `account_email_changes` guarda cuenta/solicitante, clave y
huella de operación, correo anterior/nuevo, hash del token, revisión reservada,
versión de sesiones, motivo, fechas, estado y acuses separados. Una restricción
parcial permite una sola PENDING por cuenta y otra hace única la operación por
solicitante. Los destinos pendientes no se reservan globalmente.

El token tiene 32 bytes aleatorios, prefijo `ec1_`, hash SHA-256 con dominio
`EMAIL_CHANGE`, TTL de 30 minutos y un solo uso. Nunca se almacena en claro. Es
independiente de `password_resets`, tokens de sesión y verificación de documentos.
Una nueva solicitud aceptada sustituye la anterior; el token viejo deja de servir.
Reintentar la misma operación y payload devuelve su intención, sin emitir token
o reenviar; reutilizar la clave para otro payload da conflicto. Límite de una
solicitud nueva por minuto y cinco por hora/cuenta. No hay reenvío automático.

Solicitud y confirmación toman primero el bloqueo RF22 exclusivo compartido por
estado y username. La solicitud reautoriza, bloquea cuenta, comprueba revisión,
estado y unicidad/alias heredados, sustituye anteriores, incrementa la revisión
administrativa y audita sin revocar sesiones ni cambiar `users.email`/`version`.
La captura admite como máximo revisión 2147483645 para reservar ambos incrementos.

Dos solicitudes nuevas para la misma cuenta y revisión, con claves de operación
distintas, no se sustituyen mutuamente: solo una se confirma como intención y la
otra obtiene 409 `ACCOUNT_CHANGED`, sin escritura ni envío. Reemplazar requiere
releer la revisión vigente, una operación nueva y respetar el minuto entre
solicitudes. El reemplazo aceptado marca la anterior SUPERSEDED; su token ya no
confirma. El [caso integrado](../validation/account-email-request-concurrency.md)
verifica esta política sin modificar límites ni expectativas de aplicación.

La confirmación bloquea solicitud/cuenta, relee el reloj SQL tras el bloqueo y
verifica no consumo, vigencia, autoridad, actividad/bloqueo, versión, revisión y
correo anterior. Comprueba de nuevo unicidad y ambigüedad; el índice PostgreSQL
`users_email_unique` resuelve también carreras con escritores ajenos al bloqueo.
En una transacción cambia email y `email_verified_at`, incrementa revisión y
versión, revoca todas las sesiones, invalida resets sin usar, consume la solicitud
y audita. Un error, incluido fallo de auditoría, revierte todos esos efectos.
Dos confirmaciones del mismo token tienen un solo ganador; dos cuentas con
solicitudes por el mismo destino también. No se cambia contraseña, username,
persona, roles, intentos, bloqueo ni cambio obligatorio.

`email_verified_at` es NULL para los correos históricos; no implica que el correo
anterior ya sirva para recuperación. Auditoría: responsable, motivo, UUID de
operación, revisiones y revocación; sin direcciones, token o enlace. La tabla de
solicitudes contiene datos privados, no se expone como DTO y necesita una futura
política operativa de retención. No se promete protección ante SQL directo.

## Transporte y proveedor pendiente

`src/server/email/transport.ts` define el adaptador intercambiable. La conexión
de aplicación devuelve `null`: no hay proveedor ni fallback de demostración.
Sin configuración se persiste la intención con `NOT_CONFIGURED`; ningún secreto
sale al cliente. Para poder entregar esa intención se deberá crear una nueva
solicitud explícita después de configurar el proveedor: no se puede reconstruir
el token desde su hash.

Después de commit se envía comprobación **solo al nuevo destino** y aviso sin
secreto al anterior; tras confirmar se avisa otra vez al anterior. Las pruebas
inyectan transporte sintético desde código de servidor. El adaptador recibe el
token en memoria y una clave idempotente por mensaje; no debe registrar payloads.
No se modifican ni utilizan las tablas generales de notificaciones, que carecen
del contrato de destinatario/secreto específico de este flujo.

Los acuses son `PENDING`, `ACCEPTED`, `FAILED`, `UNKNOWN` o `NOT_CONFIGURED`.
ACCEPTED solo significa aceptación del proveedor. Un timeout queda UNKNOWN; fallo
al guardar el acuse deja PENDING persistido y UNKNOWN en la respuesta. No se
declara entrega, no se deshace un commit por fallo de correo y no se reenvía a
ciegas. La consulta y la clave de operación permiten revisar la incertidumbre.

Falta elegir e implementar proveedor, dominio/remitente verificados, secretos de
servidor, límites/timeouts del adaptador y plantillas privadas. La pantalla pública
para pegar token o abrir un enlace con secreto en fragmento (y confirmar por POST)
no está implementada; nunca ponerlo en URL de API/query string o logs. También
quedan cancelación/reenvío explícitos y tratamiento operativo de entregas inciertas.
No se añade una cola ni infraestructura nueva. Reset administrativo y corrección
de identidad conservan sus decisiones confirmadas e implementación pendiente.

## Preview y validación

La migración conserva el modo de RLS de `users`: Docker sigue sin RLS; si el
entorno ya lo tiene, la tabla nueva nace protegida sin políticas abiertas. Revoca
PUBLIC. El plan privado de Preview añade SELECT/INSERT y UPDATE exclusivamente
de estado/consumo/acuses, sin modificar token/destinos ni eliminar solicitudes;
añade UPDATE de `users.email_verified_at` y solo SELECT(user_id,used_at)/UPDATE(used_at)
de resets para invalidarlos. No cambia roles de personas ni habilita recuperación.
El despliegue de una tabla nueva sigue detenido por el control de seguridad de
producción hasta revisar/aprobar su plan; no se modifica ese control aquí.

Véanse [resultados y comandos aislados](../validation/account-email-change.md).
