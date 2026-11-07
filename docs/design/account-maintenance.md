# Interfaz de mantenimiento de cuentas — PDGLD-118

Ruta `/accounts` dentro de `(management)`. Hereda ManagementShell, encabezado,
menú de cuenta y navegación existentes: no añade otro main, shell o selector de
tema. El destino aparece solo con lectura global de users, comprobada en servidor.
Crear cuenta permanece en `/accounts/new`, con su capacidad independiente.

## Consulta y detalle

El Server Component delega lectura y autorización al módulo de cuentas. Búsqueda
literal por username, paginación numerada y tamaño de página reutilizan el contrato
existente. Los enlaces conservan filtros codificados; buscar vuelve a la primera
página. Solo se muestran username y estado en la colección autorizada, con vacío,
carga, filtros inválidos, servicio no disponible y acceso denegado.

El detalle utiliza FormDialog. Con READ global se consulta el DTO mínimo. Solo
UPDATE global habilita la consulta separada de identificadores y las operaciones;
el correo no se muestra a lectores sin ese permiso. Las dos lecturas del detalle
deben coincidir en cuenta y revisión. Los endpoints siguen comprobando identidad,
permiso y alcance en cada petición, independientemente del botón o menú.

## Operaciones breves

- Username: edición separada de correo, motivo de 10 a 300 caracteres y confirmación
  explícita. Se normaliza con el mismo contrato del login y se avisa de revocación
  de sesiones y posible invalidación de solicitudes de correo pendientes.
- Correo: solicita un destino pendiente mediante operationKey; no edita email por
  PATCH. El anterior conserva el login hasta confirmar propiedad. Se muestran
  estado, vencimiento y transporte de confirmación/aviso anterior por separado.
  NOT_CONFIGURED informa que no se envió el mensaje; ACCEPTED no acredita entrega.
  No hay tokens, enlaces secretos o contraseñas en la interfaz. Una confirmación
  consultada oculta el correo antiguo hasta volver a leer los identificadores.
- Baja/reactivación: deriva el destino del estado consultado, exige motivo y
  confirmación, y conserva personas, roles e historial. Se explican los efectos
  sobre sesiones; reactivar no recupera sesiones anteriores. La protección del
  administrador operativo se mantiene en el servicio, con sus mensajes vigentes.

Se reutilizan SelectField, FormDialog, ActionLink, primary-action y tokens de claro/
oscuro. Etiquetas, ayudas y errores están asociados a los controles; los estados
incluyen texto y no dependen solo del color. La lista usa tarjetas adaptables y
los formularios conservan alturas mínimas, foco y acciones de la base compartida.

## Conflictos, incertidumbre y sesión

El controlador bloquea doble envío y edición durante una escritura. Un 409 exige
consultar y revisar la versión actual; nunca reemplaza silenciosamente la revisión
ni reenvía un payload. Ante red/5xx/acuse inválido mantiene la operación incierta:

- Username/estado: consultar sin reenviar. El estado actual no demuestra que esa
  escritura haya ocurrido; el mensaje evita atribuir un resultado no probado.
- Correo: consulta autorizada por operationKey y reintento manual exclusivamente
  del mismo payload/revisión/clave. Un 404 de consulta no demuestra un fallo del
  POST que aún pudiera estar en vuelo. No se genera otra clave para ese reintento.

Cerrar un diálogo no cancela ni reenvía una escritura. La operación incierta queda
visible al reabrir y bloquea selección, búsqueda y paginación propias. La captura
vive solo en memoria de esta página; no se presenta como borrador persistido y
se advierte que salir/recargar puede perderla. No usa localStorage, IndexedDB o
sessionStorage. Los resultados tardíos no repueblan datos tras cerrar el ciclo.

Un 401, cambio obligatorio de contraseña o pérdida de permisos oculta colección,
filtros, contadores, detalle, correo y pendientes. Cambiar username/estado propios
reconoce el acuse y pide iniciar sesión con las sesiones anteriores revocadas.

## Estado de validación

El controlador, adaptador HTTP y HTML React tienen controles con respuestas
sintéticas. La validación integrada con Chrome real, NextAuth y PostgreSQL 15/17
aprobó consulta, operaciones, revocación de sesiones, revisión obsoleta,
NOT_CONFIGURED, denegación y recorrido de teclado/foco. Se comprobó el diálogo en
claro/oscuro a 1280 y 390 px; esto no equivale a una revisión humana completa o a
validación de RLS/Supabase. Ver [resultados .221/.230](../validation/account-maintenance-ui.md).

Transporte real, remitente verificado y plantillas siguen pendientes. La
[pantalla pública de confirmación](account-email-confirmation.md) usa el contrato
de servidor existente con acción explícita; no cambia la solicitud desde gestión.
