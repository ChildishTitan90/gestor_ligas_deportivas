# PDGLD-32 · Recuperación de contraseña por correo

El login enlaza a la solicitud de recuperación. Una solicitud válida recibe
la misma respuesta pública antes de consultar la cuenta o contactar al
proveedor. Solo se considera el correo vigente verificado de una cuenta
activa. El transporte Resend existente envía el token en el fragmento de
una URL HTTPS configurada en el servidor. Abrir el enlace no cambia la cuenta.

Se guarda un hash separado por propósito en la tabla password_resets existente.
La emisión se serializa por cuenta y respeta el límite por hora configurado.
Una solicitud nueva no invalida un enlace todavía vigente. El consumo exige
confirmación explícita, cuenta activa y token vigente. Bajo el bloqueo de la
cuenta, el consumo, el cambio de contraseña, la revocación de sesiones y la
auditoría se completan juntos. Cambiar contraseña, correo verificado, estado
o ejecutar el reset administrativo invalida las recuperaciones previas.

La recuperación se mantiene deshabilitada por defecto. Antes de habilitarla,
registrar la política de caducidad y frecuencia, verificar en el entorno de destino los permisos sobre password_resets
y validar la
protección contra abuso en el punto de entrada público. El plan de Preview concede lectura e inserción por columna y permite
actualizar solo used_at, sin borrar solicitudes ni reescribir hashes.
Esto no aplica permisos en producción. Verificar con un buzón controlado
el recorrido desde login hasta el acceso con contraseña nueva; el acuse del
proveedor por sí solo no acredita recepción.

La suite `npm run test:password-recovery-integration` crea una base temporal
con RLS y un rol limitado. Usa un transporte simulado para comprobar que
solo se guarda el hash, que un enlace vencido no cambia la cuenta, que hay
un solo ganador al consumirlo en concurrencia, y que el cambio revoca la
sesión y registra el evento. No sustituye la verificación en navegador.

La transacción fija UTC localmente: el adaptador envía fechas sin offset,
y usar la zona de la sesión alteraría la caducidad y el límite por hora.
La suite usa America/Mexico_City para el rol de aplicación y comprueba que
la expiración guardada coincida con la del mensaje.

Verificación local: suite de integración aprobada en PostgreSQL 15.19 y
17.11 con bases temporales, RLS y transporte simulado. Pendiente verificar
las pantallas y la entrega a un buzón controlado en un entorno autorizado.


## Revisión de rechazo de envío y permisos compartidos

Un rechazo confirmado (`FAILED`) invalida únicamente la operación emitida,
bajo el bloqueo de la misma cuenta y sin modificar su hash ni borrar el registro.
La persona puede solicitar un enlace nuevo antes del vencimiento del anterior,
si aún no alcanzó el límite por hora. Los intentos rechazados también cuentan
para ese límite. No se reintenta automáticamente el envío.

`UNKNOWN` conserva la operación: una pérdida de respuesta no demuestra que el
proveedor haya rechazado el correo. `ACCEPTED` conserva el enlace hasta su consumo
o vencimiento. La respuesta pública sigue siendo el mismo 202 genérico y se
emite antes de consultar la cuenta o enviar; nunca informa existencia de cuenta
ni resultado del proveedor.

La regresión con rol limitado comprueba rechazo, nueva solicitud con token
distinto, consumo del nuevo enlace, rechazo del anterior, entrega incierta y
límite por hora. El plan Preview conserva conjuntamente la inserción de
`password_resets` y los permisos de `venue_loans` integrados en develop.


Validación de esta corrección (18/11/2026): integración PostgreSQL 15.19 y
17.11, 2/2 casos por versión con RLS y rol limitado; pruebas de política 2/2,
transporte simulado 7/7, controles de pipeline 91/91, tipado y lint aprobados.
No se contactó al proveedor real durante estas pruebas. La validación en
Preview continúa pendiente; no se aplicaron permisos ni cambios en producción.
