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
