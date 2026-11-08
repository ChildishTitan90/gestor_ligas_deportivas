# PDGLD-117 — corrección privada e historial

La página de corrección vive en `(management)` y aporta una sección dentro del
ManagementShell existente, sin otro encabezado ni main. Reutiliza SelectField,
primary-action y los tokens compartidos; el selector de decisión tiene etiqueta
asociada. Las cuentas y la navegación conservan sus servicios y permisos.

El solicitante captura identidad, motivo y hasta tres evidencias privadas. La
solicitud pendiente no cambia Persona ni habilitación. Secretaría devuelve o
aplica con atestaciones explícitas; no resuelve su propia solicitud. Una persona
compartida exige autoridad sobre todas sus referencias. Los errores de identidad
y motivo se asocian a sus campos y el acuse recibe foco.

Durante el envío se bloquean solicitudes duplicadas. Ante respuesta incierta se
conserva la captura en la página y se ofrece consultar sin reenviar. La captura
no se anuncia como borrador persistido; recargar o salir la pierde. El servidor
conserva claves de operación y conflictos de versión independientemente de UI.

En una temporada cerrada, el expediente presenta el nombre capturado o
«Información histórica no disponible». No presenta edad/documentos/habilitación
calculados con people actual como hechos históricos. Participaciones mantiene
estados registrados y explica que la evaluación histórica no está disponible.
Aplicar sigue bloqueado aun con nombres capturados; solicitar/devolver continúa.

La validación de navegador usa Chrome y datos sintéticos, con autenticación y
servicios reales sobre PostgreSQL desechable. Las capturas de ambos temas y
tamaños no sustituyen una revisión manual completa de accesibilidad o contraste.
