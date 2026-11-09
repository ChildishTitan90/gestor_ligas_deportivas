# Operación de mantenimiento de cuentas

Guía de PDGLD-120, revisada el 7 de noviembre de 2026. Corresponde a la
interfaz del PR #43; no autoriza cambios SQL manuales ni entrega real de correo.
La [matriz de aceptación](../validation/account-maintenance-acceptance.md)
separa evidencia técnica de criterios pendientes.

## Entrar y consultar

Iniciar sesión con una cuenta operativa y abrir Administración → Administrar
cuentas, o `/accounts`. Se requiere `users:READ` global; una concesión de liga
no permite administrar una identidad global. Crear cuenta conserva su ruta y
permiso independiente. No interpretar un enlace visible en un layout persistente
como autorización: el servidor vuelve a comprobar cada petición.

Buscar por username; la búsqueda es literal y no distingue mayúsculas. Revisar
página, filtros y cuenta antes de abrir «Ver detalle». No se listan personas sin
cuenta ni expedientes deportivos. La colección contiene username y estado;
leer el correo exige la capacidad de actualización global.

## Editar y cambiar estado

Con `users:UPDATE` global, abrir el detalle vigente y elegir la operación.
Para username, capturar el nuevo valor, un motivo de 10–300 caracteres sin
secretos ni datos sensibles y la confirmación. La normalización y unicidad se
comprueban en servidor/base, también ante carreras. Un duplicado se corrige;
no crear otra persona ni alterar roles/cargos para resolverlo.

Baja y reactivación exigen motivo y confirmación. Conservan persona, referencias,
asignaciones e historial; ambas invalidan sesiones anteriores. Reactivar exige
iniciar sesión de nuevo, no recupera cookies antiguas. No hay eliminación
permanente en esta pantalla. El último SUPERADMIN requiere otro respaldo activo,
con asignación vigente, READ/UPDATE global, sin bloqueo ni cambio obligatorio.
No retirar permisos ni editar SQL para eludir esa protección. La coordinación
con cambios de roles y periodos pertenece a PDGLD-36.

Los datos personales y la identidad deportiva (CURP, nombres, verificaciones y
habilitación) no se corrigen aquí. Canalizar la solicitud con evidencia y
aprobación al flujo de personas/jugadores pendiente; conservar referencias y
unicidad de afiliación. No usar la edición de username como sustituto.

## Cambio de correo

Solicitar el nuevo correo desde la operación específica; el vigente sigue siendo
el de acceso hasta confirmar propiedad. Abrir el enlace no confirma: la pantalla
pide una acción explícita. El token vence, es de un uso y una nueva solicitud
sustituye la anterior. Tras confirmar se revocan sesiones; iniciar sesión con el
identificador vigente. No copiar enlaces/tokens a motivos, tickets o capturas.

`NOT_CONFIGURED` significa que no se envió correo. `ACCEPTED` solo acredita que
el transporte aceptó, no recepción. La entrega real está bloqueada hasta configurar
proveedor, remitente/dominio verificado, secretos privados, plantillas y operación
de errores. No marcar correos históricos como verificados para evitar el bloqueo.

## Restablecimiento administrativo de acceso (PDGLD-119)

1. Confirmar cuenta y ámbito. No restablecer la cuenta propia, una inactiva o
   el último administrador operativo sin respaldo.
2. Verificar explícitamente la identidad en persona o mediante un canal
   previamente registrado, según el procedimiento adoptado por el equipo.
   Elegir el método, atestarlo, indicar motivo y confirmar. La aplicación audita
   la declaración del operador; no verifica identidad en un proveedor externo.
3. El servidor resuelve exclusivamente el correo vigente con propiedad verificada;
   nunca el pendiente ni un destino facilitado para esta incidencia. Si falta
   esa prueba, escalar al equipo: no cambiar el destino ni conceder verificación.
4. Sin proveedor la cuenta permanece sin cambios y no se afirma envío. Con
   transporte, la transacción revoca sesiones/recuperaciones previas, invalida
   solicitudes pendientes de correo y reemplaza la credencial anterior; después
   intenta entregar. `FAILED`/`UNKNOWN` no deshacen ese cambio.
5. La credencial aleatoria expira en 30 minutos y solo admite un primer login.
   Permite exclusivamente cambiar la contraseña; completar el formulario y volver
   a entrar con la nueva. La credencial temporal y las sesiones anteriores ya no
   sirven. Si vence también la sesión restringida, no intentar prolongarla.

No recuperar la temporal desde la base ni copiarla a Jira/logs. Una nueva emisión
requiere otra decisión manual, identidad verificada y revisión vigente. Adopción
humana del procedimiento y validación de entrega real siguen pendientes en PDGLD-119.
La recuperación autónoma PDGLD-32 es otro flujo.

## Conflictos y resultados inciertos

- Revisión obsoleta: usar «Revisar versión actual», comprobar el cambio y volver
  a decidir; no sustituir silenciosamente la revisión ni reenviar automáticamente.
- Respuesta perdida/5xx: conservar la incertidumbre y consultar sin reenviar.
  Una revisión distinta no prueba quién cambió la cuenta ni recupera el acuse de
  entrega. Cerrar el diálogo no cancela una escritura enviada.
- Solicitud de correo: conciliar por su clave de operación; un reintento manual
  conserva exactamente clave, payload y revisión. No inventar otra solicitud.
- Denegación o sesión revocada: iniciar sesión de nuevo o pedir revisión de
  permisos. No conservar como válidos datos privados de una sesión perdida.
- La captura del diálogo vive en memoria: recargar o salir puede perderla; no
  es un borrador persistido. Registrar la incidencia con operación/hora y resultado
  conocido, sin contraseñas, tokens, correos reales ni conexiones.

## Revisión y puesta en operación

El equipo debe revisar la matriz, aprobar el procedimiento de identidad y resolver
la entrega real antes del cierre correspondiente. Conservar el PR Draft mientras
falten criterios de su alcance. CI verde no acredita entrega real, despliegue ni
revisión humana. No repetir matrices aprobadas si el código que cubren no cambia;
una corrección requiere solo su regresión pertinente en entornos aislados.


Actualización técnica (8 de noviembre de 2026): se eligió Resend para pruebas y
se implementó el adaptador HTTP. La activación permanece explícita y depende de
configuración completa. Un único envío real con `onboarding@resend.dev` fue
aceptado por Resend y su recepción en Hotmail fue confirmada por el usuario;
la configuración con dominio propio en producción sigue sin validar. Véase
[contrato y validación del proveedor](../architecture/resend-test-provider.md).
