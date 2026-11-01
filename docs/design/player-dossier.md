# PDGLD-101 — Primera captura y consulta documental

Ruta de gestión /players/registrations/[registrationId]/documents, enlazada desde el listado autorizado de jugadores. Conserva ManagementShell, un único main, Geist, tokens y navegación existentes. El expediente completo vive en página; no crea un segundo encabezado ni otra matriz de roles en cliente.

La edad se presenta al registro, con la fecha de referencia y la distinción menor/mayor. Requisitos configurados en tarjetas con texto obligatorio/opcional, recibidos vigentes, revisados y faltantes. La ausencia o inconsistencia de configuración tiene mensaje explícito y no representa aprobación.

Captura mediante SelectField para requisito y posición. Selección de archivo siempre disponible y entrada de cámara como alternativa del dispositivo. Etiquetas y ayudas asociadas, foco visible, resultado anunciado con role=status y acción primaria con relleno semántico. No se muestra CURP, nombre original de archivos almacenados, rutas o claves en el listado.

El padre conserva archivo e intención en memoria; las fases preparación/carga/confirmación mantienen la misma operación ante incertidumbre. Consultar acuse no escribe; el reintento manual prosigue en la última fase confirmada. Se bloquea doble envío mediante ref y controles deshabilitados. No hay borrador persistente: al salir o recargar se pierde la selección; una escritura ya enviada puede terminar aunque se abandone la página. El aviso beforeunload protege salida/recarga completa; no equivale a persistir datos entre rutas.

Las sustituciones exigen la versión vigente y conservan historial. El documento nuevo queda pendiente de revisión. El consentimiento del tutor no se presenta como acreditado al cargar el archivo. Nunca se muestra una acción ficticia de aprobación deportiva.

Validación ejecutada con backend/sesión/PostgreSQL aislados reales: escritorio oscuro 1280×900, móvil claro 375×812, selección por flecha/Enter/Tab, estados recibidos y copia privada. No hubo desbordamiento horizontal. La carga y confirmación completas se probaron por HTTP real con Supabase de pruebas; no mediante clics del navegador ni cámara física. Recuperación ante fallos cubierta con transporte sintético del cliente. Evidencia y reproducción en docs/validation/PDGLD-100-storage.md.
