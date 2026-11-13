# PDGLD-132 y PDGLD-133: avance independiente

El servicio implementa programación, confirmación, inicio, suspensión y cancelación con versión, motivo, autorización e historial. El inicio y la suspensión corresponden al capturista autorizado de la liga. La pantalla `/matches/recording` presenta estas acciones según permisos y estado, con navegación por páginas de 50 partidos.

La prueba `test:match-transitions-db` usa PostgreSQL temporal y comprueba permisos, aislamiento de la consulta del capturista, reenvíos, concurrencia, historial y reservas. `test:match-transitions` cubre reglas y selección de acciones. `test:match-transition-browser` usa respuestas sintéticas, no el servidor real: comprueba móvil/escritorio, claro/oscuro, foco, Escape y envío del formulario. Estas pruebas no sustituyen un recorrido completo en navegador con sesión y base reales.

Ambas subtareas permanecen abiertas. Falta probar el recorrido completo en navegador con sesión y base reales, comprobar paginación con más de 50 partidos y revisar accesibilidad visual. La reprogramación requiere acordar su contrato con programación y canchas; no presentación, confirmación de cédula, resultado y expediente disciplinario requieren integración con PDGLD-18 y sus dependencias. No se aplica sanción automática. CI remoto y revisión humana también están pendientes.
