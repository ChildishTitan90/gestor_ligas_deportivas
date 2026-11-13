# PDGLD-132 y PDGLD-133: avance independiente

El servicio implementa programación, confirmación, inicio, suspensión y cancelación con versión, motivo, autorización e historial. El inicio y la suspensión corresponden al capturista autorizado de la liga. La pantalla `/matches/recording` presenta estas acciones según permisos y estado, con navegación por páginas de 50 partidos.

La prueba `test:match-transitions-db` usa PostgreSQL temporal y comprueba permisos, aislamiento de la consulta del capturista, reenvíos, concurrencia, historial y reservas. `test:match-transitions` cubre reglas y selección de acciones. `test:match-transition-browser` usa respuestas sintéticas, no el servidor real: comprueba móvil/escritorio, claro/oscuro, foco, Escape y envío del formulario. Estas pruebas no sustituyen un recorrido completo en navegador con sesión y base reales.

La paginación se verificó con 55 partidos sintéticos en PostgreSQL temporal, sin duplicados ni omisiones. Además, `node scripts/test-auth.mjs --match-transitions` con `CHROME_BIN` ejecutó con sesión, servidor y base temporales reales el inicio de un partido desde la pantalla del capturista; verificó el estado y las tres entradas de historial. Se inspeccionaron capturas en 390/1280 píxeles y ambos temas, sin desbordamiento horizontal; se comprobó el foco dentro del diálogo. La prueba cubre el inicio, no todos los roles y acciones ni una auditoría completa de accesibilidad.

Ambas subtareas permanecen abiertas. La reprogramación requiere acordar su contrato con programación y canchas; no presentación, confirmación de cédula, resultado y expediente disciplinario requieren integración con PDGLD-18 y sus dependencias. No se aplica sanción automática. CI remoto y revisión humana también están pendientes.

## Recuperación de respuesta incierta

La interfaz conserva el identificador de operación, la versión, el destino y el motivo
después de una respuesta incierta. Es posible cerrar y reabrir el diálogo y enviar
exactamente el mismo contenido. Mientras exista una solicitud incierta se advierte al
salir de la página, y no se presentan otras acciones para el mismo partido. El servidor
revalida permisos y recupera el acuse sin repetir efectos. Un error definitivo muestra
su causa y no se presenta como envío incierto. La captura no sobrevive a una recarga.

La prueba de navegador simula una respuesta incierta, cierra y reabre el diálogo y
comprueba que el segundo envío conserva todo el contenido. Las pruebas de servidor
preexistentes verifican reenvíos, concurrencia, alcance e historial en PostgreSQL.
