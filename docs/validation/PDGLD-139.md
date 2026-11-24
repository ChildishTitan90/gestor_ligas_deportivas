# PDGLD-139 — Pantalla de ajuste y revisión

## Resultado local — 21 de noviembre de 2026

En la rama `feat/PDGLD-25-integracion`, sobre el commit `bc7d5e8` y los cambios
locales de la pantalla y sus pruebas, se ejecutaron:

- `node --test tests/e2e/scheduling-proposals.test.mjs`: **4/4** casos en Chrome,
  con 390 y 1440 píxeles, temas claro y oscuro. La prueba usa componentes reales
  y respuestas HTTP simuladas: revisa pasos, estados y mensajes, pendientes,
  intercambio de equipos con selección y arrastre, guardado conjunto, consulta
  de opciones de cancha, captura de fecha y recuperación de solicitudes.
- `node --import tsx --test src/features/scheduling/proposal-actions.test.ts src/features/scheduling/components/proposal-status.test.tsx`:
  **2/2** pruebas de acciones según permiso y estado y de mensajes de propuesta.

## Pantallas, estados y acciones comprobados

| Elemento | Alcance de la comprobación |
| --- | --- |
| Preparar programación | Componentes de generación con contexto de temporada y grupo; indicador de paso actual y pasos completados; presentación de propuesta completa, pendientes, ausencia de motivo y límite de búsqueda, con respuestas simuladas. |
| Estado de la propuesta | Mensajes de borrador editable, revisión con un encuentro pendiente y aprobación operativa diferenciada de publicación; indicadores de borrador, revisión y aprobación. Las pruebas montan componentes, no la página completa del servidor. |
| Encuentros por jornada | Selección y arrastre simulados de equipos, aviso de cambios sin guardar y envío conjunto de dos intercambios; los encuentros afectados indican que cancha y horario quedan pendientes. |
| Detalles y ajuste | Diálogo de un encuentro pendiente: contexto, captura de fecha, consulta simulada de canchas, selección, motivo y guardado; recuperación de una respuesta incierta y protección frente a versiones o cuentas distintas. |
| Envío y revisión | Controles de envío para quien ajusta y de aprobación/devolución para quien revisa, y presentación de error por encuentro incompleto. La separación de acciones visibles se comprueba también mediante la prueba de la función de permisos/estado. |
| Acceso y PDF | La lógica de acciones contempla ausencia de permisos; la página tiene un mensaje de acceso denegado. El PDF y las denegaciones de acceso se probaron a nivel de servicio con datos sintéticos y RLS, no con una sesión real ni con la descarga desde el navegador. |

La prueba Chrome usa datos y respuestas sintéticas; no autentica usuarios reales,
no verifica permisos del servidor ni conecta con PostgreSQL. El arrastre se
simula con eventos del navegador y no sustituye una revisión manual del gesto.
Los temas se prueban como configuraciones del navegador; esta prueba no es una
inspección visual de estilos ni acredita contraste o accesibilidad completos.
La descarga del PDF y el recorrido completo de la página con sesiones reales no
forman parte de estos cuatro casos.

Como evidencia complementaria, la prueba `npm run test:scheduling:preview`
ejecutada durante la revisión de permisos de esta versión pasó con PostgreSQL 15,
RLS y rol limitado; valida servicios y PDF reales con datos sintéticos, no el
navegador. La evidencia de integración se detalla en [PDGLD-138](PDGLD-138.md).

## Recorrido con sesiones de aplicación — 21 de noviembre de 2026

En una base PostgreSQL 17 aislada con datos sintéticos y dos cuentas distintas,
el programador inició sesión, generó una propuesta de 19 jornadas y 190
encuentros, intercambió la localía de un encuentro y la envió a revisión. La
interfaz mostró el cambio guardado, la propuesta en revisión y la versión 3.
Una segunda sesión con permisos de lectura y aprobación, sin edición, abrió la
propuesta y la aprobó. La pantalla mostró «Aprobada para operación», versión 4,
y el enlace de descarga del PDF. Una consulta a la base confirmó 190 partidos y
190 reservas asociados a la propuesta.

Este recorrido usó sesiones y servicios reales de la aplicación con identidades
y datos de prueba; el servidor se conectó a PostgreSQL como administrador, por
lo que no demuestra RLS en el recorrido HTTP. La prueba separada de Preview
cubre RLS a nivel de servicio. Se observó el enlace del PDF, pero no se descargó
ni se abrió durante este recorrido. El usuario informó que probó la descarga y
apertura el día anterior; no se repitió ni se inspeccionó el archivo en esta sesión.

En un segundo entorno aislado de cuatro equipos, una cuenta sin permisos no vio
la opción de programación y, al acceder directamente, recibió el mensaje de
acceso denegado. El programador seleccionó dos equipos de encuentros distintos,
guardó el intercambio y observó cuatro encuentros pendientes. Asignó a cada uno
cancha y horario desde sus detalles; al consultar el mismo horario para dos
partidos de una jornada, la cancha ya ocupada dejó de ofrecerse. Después envió
la propuesta. Otra sesión con permiso de revisión la devolvió con motivo; la
interfaz confirmó el cambio a borrador, versión 8, y el programador volvió a ver
los controles de edición. Se comprobó el intercambio por selección, no mediante
un gesto de arrastre manual. El motivo se capturó en la interfaz; en este
recorrido no se volvió a consultar su registro directamente en la base.

## Pendiente para el recorrido con sesiones reales

- Comprobar el recorrido HTTP con RLS activo si se exige en el entorno de aceptación.
- Probar la disposición visual, contraste y navegación por teclado en móvil y escritorio.
- Comprobar el arrastre con interacción real; las pruebas actuales lo simulan.
- Repetir las comprobaciones necesarias sobre la versión final integrada y
  ejecutar el CI de GitHub después de subir la rama.
- Resolver cómo integrar el trabajo de PDGLD-85 que contiene esta rama y
  enlazar el PR y la evidencia de aceptación.

Estas pruebas locales no equivalen al cierre de la subtarea; se debe comprobar
la versión que finalmente se suba y se integre.
