# Administración de clubes y equipos

La pantalla `/clubs` reutiliza el shell, tokens, `SelectField`, botones de acción y `FormDialog` existentes. No añade encabezado ni navegación paralelos. Las tarjetas muestran referencia, liga/club y estado textual; los filtros conservan sus valores en la URL y la lista tiene páginas de 50 registros.

El detalle distingue estado propio y contexto de club. La baja explica su efecto operativo y la conservación de inscripciones/partidos; exige motivo y confirmación explícita. Las operaciones sin permiso no se ofrecen y se vuelven a autorizar en servidor.

Captura y errores permanecen en el padre del diálogo. Un envío pendiente bloquea el cierre y el doble envío; una respuesta incierta permite consultar el estado actualizado sin reenviar. El componente compartido conserva gestión de foco, Escape, retorno al origen y advertencia de descarte.

Estados de carga, error recuperable, vacío, falta de permiso y ausencia de conexión tienen texto visible. Los estados heredados Suspendido/Retirado no se presentan como una baja temporal reversible. Nombres con historial remiten al trámite formal. La eliminación definitiva se ofrece solo con capacidad calculada en servidor, sin referencias ni historial y con autoridad de liga/global. Su diálogo explica la irreversibilidad y exige motivo y confirmación explícita; el servidor repite todas las comprobaciones al enviar.

PDGLD-123, 3 de noviembre de 2026: validación automatizada con Chrome headless y sesión/base temporal reales, anchos 390 y 1280, temas claro/oscuro, apertura del diálogo, texto de irreversibilidad, foco dentro, Escape, retorno al botón y ausencia de desbordamiento horizontal. Comando: definir CHROME_BIN y ejecutar `npm run test:club-maintenance`. Sin CHROME_BIN se ejecutan las comprobaciones HTTP/PostgreSQL, pero no la parte de navegador. No equivale a una revisión estética manual ni a un envío de eliminación mediante navegador; las escrituras se validan mediante pruebas del servicio real.

La lista usa la comprobación de referencias de PDGLD-122 para mostrar bloqueos coherentes con el servicio. Presenta motivos de bloqueo por historial, club inactivo o permiso de consulta, y distingue el éxito de eliminación del resto de cambios. La versión permanece en el contrato de concurrencia y se retira de la presentación al usuario.
