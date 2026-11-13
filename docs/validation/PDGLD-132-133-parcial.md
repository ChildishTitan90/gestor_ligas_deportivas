# PDGLD-132 y PDGLD-133: avance independiente

El servicio implementa programación, confirmación, inicio, suspensión y cancelación con versión, motivo, autorización e historial. El inicio y la suspensión corresponden al capturista autorizado de la liga. La pantalla `/matches/recording` presenta estas acciones según permisos y estado, con navegación por páginas de 50 partidos.

La prueba `test:match-transitions-db` usa PostgreSQL temporal y comprueba permisos, aislamiento de la consulta del capturista, reenvíos, concurrencia, historial y reservas. `test:match-transitions` cubre reglas y selección de acciones. CI ejecuta estas comprobaciones con Node.js y TypeScript, sin Chrome para las transiciones de partidos. `test:match-transition-browser` queda como herramienta opcional local con respuestas sintéticas; ya no es un paso de CI. La interacción visual requiere validación manual o esa herramienta opcional.

La paginación se verifica con 55 partidos sintéticos en PostgreSQL temporal, sin duplicados ni omisiones. `npm run test:match-transitions-preview` inicia sesión por HTTP, comprueba la página autorizada, ejecuta la transición y su reenvío con Prisma bajo el rol limitado `gestor_ligas_preview`, y verifica versión, estado e historial persistidos. Una nueva petición HTTP debe mostrar «En curso» y la acción «Suspender partido». No simula clics ni depende de hidratación o mensajes transitorios de React. La invocación del servicio comprueba la lógica y los permisos de base, pero no sustituye el envío del formulario mediante una Server Action.

Validación local del 13 de noviembre de 2026: pasó la integración Preview con `CHROME_BIN` apuntando a un ejecutable inexistente, confirmando que no se lanza Chrome. Pasaron las siete pruebas de reglas/presentación, TypeScript y ESLint de los archivos de código modificados. Falta ejecutar CI remoto con este cambio. Las capturas y verificaciones de foco documentadas previamente corresponden al recorrido anterior y no se regeneran en esta suite.

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
