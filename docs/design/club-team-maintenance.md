# Administración de clubes y equipos

La pantalla `/clubs` reutiliza el shell, tokens, `SelectField`, botones de acción y `FormDialog` existentes. No añade encabezado ni navegación paralelos. Las tarjetas muestran referencia, liga/club y estado textual; los filtros conservan sus valores en la URL y la lista tiene páginas de 50 registros.

El detalle distingue estado propio y contexto de club. La baja explica su efecto operativo y la conservación de inscripciones/partidos; exige motivo y confirmación explícita. Las operaciones sin permiso no se ofrecen y se vuelven a autorizar en servidor.

Captura y errores permanecen en el padre del diálogo. Un envío pendiente bloquea el cierre y el doble envío; una respuesta incierta permite consultar el estado actualizado sin reenviar. El componente compartido conserva gestión de foco, Escape, retorno al origen y advertencia de descarte.

Estados de carga, error recuperable, vacío, falta de permiso y ausencia de conexión tienen texto visible. Los estados heredados Suspendido/Retirado no se presentan como una baja temporal reversible. Nombres con historial remiten al trámite formal y la eliminación definitiva permanece deshabilitada.

Pendiente de validación visual interactiva: escritorio/móvil, ambos temas y teclado sobre la nueva pantalla. Se reutilizan controles probados, pero eso no constituye evidencia de este recorrido completo.
