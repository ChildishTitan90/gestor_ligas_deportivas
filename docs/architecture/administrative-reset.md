# PDGLD-119: restablecimiento administrativo

Desde /accounts, un administrador con UPDATE global confirma la identidad
en persona o mediante un canal previamente registrado, indica el motivo sin
datos sensibles y confirma el efecto sobre la cuenta. El sistema audita la
atestación del administrador; no realiza una verificación externa de identidad.

El único destino implementado es el correo vigente con propiedad verificada.
No se recibe un destino del cliente. Sin transporte configurado, la operación
no modifica la cuenta. No se usa el correo pendiente ni se emite un enlace de
recuperación autónoma.

La credencial temporal se genera con 32 bytes aleatorios y se almacena solo como
hash Argon2id. El servidor exige revisión vigente y serializa las escrituras con
el bloqueo RF22 y de cuenta. Impide la operación sobre la cuenta propia, una
cuenta inactiva o el último administrador operativo. Incrementa revisión y
versión, invalida sesiones y recuperaciones previas, y audita en la misma
transacción. La entrega ocurre después del commit: un fallo o resultado incierto
se informa sin deshacer ni reenviar automáticamente. La credencial expira a los
30 minutos. El primer login consume su uso y abre únicamente la sesión de
cambio obligatorio, limitada también por el vencimiento. La contraseña nueva
reemplaza el hash y requiere volver a entrar.

Las pruebas integradas de mantenimiento usan un adaptador inyectado solo en
pruebas. La entrega operativa sigue pendiente del transporte y remitente
verificado. Un resultado ACCEPTED no acredita recepción. Si la entrega falla,
consultar el estado y decidir una nueva operación manual tras comprobar otra
vez la identidad. No se deben copiar contraseñas en motivos, bitácoras o Jira.

## Identidad privada y sesión restringida

La versión de credencial permanece en el JWT cifrado y en módulos server-only,
no en la sesión pública. El endpoint de cambio obtiene la identidad desde la
cookie, revalida la sesión y compara la versión tras bloquear la cuenta. No
acepta una versión enviada por el cliente. Las fechas de sesión no pueden
prolongarse más allá de admin_reset_expires_at. Al terminar el cambio se limpian
los campos administrativos y se invalida el JWT anterior por versión.

El reset usa reloj SQL tras el bloqueo y marca SUPERSEDED las solicitudes de
correo pendientes. Hash, revisión, versión, revocaciones, invalidaciones y
atestación auditada se confirman o revierten juntos. La entrega ocurre después:
FAILED o UNKNOWN no revierten la operación ni autorizan reenvío automático.
La consulta de detalle tras una respuesta perdida no reconstruye el acuse de
entrega ni la credencial; el mensaje debe conservar esa incertidumbre.

La comprobación real PG15/PG17 y el bloqueo de proveedor/remitente se detallan en
[validación PDGLD-119](../validation/administrative-reset.md). Las cuentas con
correo histórico sin propiedad verificada permanecen bloqueadas para entrega;
no se registra esa verificación por iniciativa del sistema.
