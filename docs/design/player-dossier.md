# PDGLD-101 — Primera captura y consulta documental

Se distingue Jugador activo de Expediente completo. La constancia CURP sigue requerida para completar expediente, pero un adulto verificado puede habilitarse antes y continuar con CURP/foto dentro de la ventana autorizada. El panel muestra ese estado sin afirmar que los archivos hayan sido revisados. Reglas y límites en [habilitación automática](../architecture/player-automatic-activation.md).

La opción Foto del jugador se añade al selector compartido para todas las edades y categorías. Se puede completar después del alta mientras el expediente esté pendiente. Tiene cámara integrada compartida con INE, permiso explícito, un único selector PNG/JPEG, vista previa y confirmación. Cambiar de documento limpia el archivo seleccionado para evitar adjuntarlo por error a otro requisito. Los reemplazos conservan historial y requieren la versión vigente; una respuesta incierta conserva el contrato existente para consultar/reintentar.

En esta entrega es opcional, sin introducir un bloqueo deportivo nuevo; permitir añadirla después del alta no define su eventual obligatoriedad para habilitación. Es independiente de selfie y autorización del tutor. Se conservan ManagementShell, SelectField y tokens. Chrome con datos sintéticos comprueba cámara, único selector y formatos de foto; la cámara física y aceptación visual completa siguen pendientes.

Ruta de gestión /players/registrations/[registrationId]/documents, enlazada desde el listado autorizado de jugadores. Conserva ManagementShell, un único main, Geist, tokens y navegación existentes. El expediente completo vive en página; no crea un segundo encabezado ni otra matriz de roles en cliente.

La edad se presenta al registro, con la fecha de referencia y la distinción menor/mayor. Requisitos configurados en tarjetas con texto obligatorio/opcional, recibidos vigentes, revisados y faltantes. La ausencia o inconsistencia de configuración tiene mensaje explícito y no representa aprobación.

Captura mediante SelectField para requisito y posición. Selección de archivo siempre disponible y entrada de cámara como alternativa del dispositivo. Etiquetas y ayudas asociadas, foco visible, resultado anunciado con role=status y acción primaria con relleno semántico. No se muestra CURP, nombre original de archivos almacenados, rutas o claves en el listado.

El padre conserva archivo e intención en memoria; las fases preparación/carga/confirmación mantienen la misma operación ante incertidumbre. Consultar acuse no escribe; el reintento manual prosigue en la última fase confirmada. Se bloquea doble envío mediante ref y controles deshabilitados. No hay borrador persistente: al salir o recargar se pierde la selección; una escritura ya enviada puede terminar aunque se abandone la página. El aviso beforeunload protege salida/recarga completa; no equivale a persistir datos entre rutas.

Las sustituciones exigen la versión vigente y conservan historial. El documento nuevo queda pendiente de revisión. El consentimiento del tutor no se presenta como acreditado al cargar el archivo. Nunca se muestra una acción ficticia de aprobación deportiva.

Validación ejecutada con backend/sesión/PostgreSQL aislados reales: escritorio oscuro 1280×900, móvil claro 375×812, selección por flecha/Enter/Tab, estados recibidos y copia privada. No hubo desbordamiento horizontal. La carga y confirmación completas se probaron por HTTP real con Supabase de pruebas; no mediante clics del navegador ni cámara física. Recuperación ante fallos cubierta con transporte sintético del cliente. Evidencia y reproducción en docs/validation/PDGLD-100-storage.md.
