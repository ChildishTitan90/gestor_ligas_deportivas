# Orientación en programación

La pantalla de generación muestra un recorrido de tres pasos: elegir contexto,
preparar una propuesta y consultar el calendario. La selección del grupo y la
consulta de una propuesta existente determinan el paso actual; cambiar de
contexto vuelve al primer paso. Los pasos indican «Actual», «Completado» o
«Pendiente» mediante texto y símbolos, sin depender solo del color.

Cada propuesta muestra su estado persistido: borrador, en revisión o aprobada.
Al volver a borrador se muestra de nuevo ese estado, sin inferir un historial.
La aprobación es operativa; la publicación pertenece al proceso posterior. Las
ventanas de generación, ajuste y revisión muestran el contexto disponible de
temporada, grupo o encuentro para ayudar a identificar lo que se está editando.

La presentación usa una columna en móvil y tres columnas en pantallas más
anchas, con los colores semánticos y componentes compartidos. El caso de Chrome
`tests/e2e/scheduling-proposals.test.mjs` comprueba las transiciones de los
indicadores, el contexto del encuentro y el regreso a borrador con respuestas
simuladas, a 390/1440 píxeles en claro/oscuro. El recorrido en la aplicación
integrada con sesiones reales y la validación visual quedan para la revisión
final acordada por el equipo.

## Intercambio de equipos

En una propuesta en borrador, cada jornada presenta sus encuentros en bloques.
El usuario puede arrastrar un equipo sobre otro de un partido diferente de la
misma jornada o seleccionar ambos mediante botones, también con teclado o en
dispositivos táctiles. «Ver detalles» conserva la consulta y el ajuste de
cancha y horario.

Antes de guardar se muestra la lista de enfrentamientos y descansos que
cambiarían en todas las jornadas. El intercambio permuta ambos equipos en el
calendario y conserva el partido directo entre ellos, evitando repetir cruces.
El servidor vuelve a generar el cambio, valida estructura y permisos, comprueba
la versión y registra el motivo. Las canchas y horarios de los encuentros
modificados quedan pendientes y se deben validar de nuevo; los demás encuentros
se conservan. Una propuesta enviada o aprobada no ofrece el intercambio.

La prueba de Chrome usa respuestas simuladas y cubre arrastre, selección y
vista previa. La prueba PostgreSQL temporal verifica el guardado, permisos,
versión y conservación de encuentros sin cambios; el recorrido completo con
sesiones reales sigue pendiente de la validación final.
