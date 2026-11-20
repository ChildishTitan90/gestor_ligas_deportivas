# PDGLD-136 — Pantalla de generación y propuestas

## Comportamiento

En **Generar calendario**, el usuario autorizado selecciona temporada y grupo,
solicita la generación y consulta las jornadas, equipos, localías y descansos.
Una propuesta completa muestra cancha y horario. La generación conserva la clave
de operación para recuperar una respuesta incierta; la propuesta no crea partidos
oficiales, reservas ni publicaciones.

Si no todos los encuentros tienen una combinación viable, la pantalla puede
presentar una propuesta parcial. Cada encuentro sin cancha muestra **Pendiente**
en cancha y horario. La pantalla muestra los factores registrados al generar,
por ejemplo disponibilidad, autorización, bloqueo o posible conflicto con otro
encuentro. Son datos de esa generación: al ajustar se revalidan las condiciones
vigentes. Cuando no hay motivos guardados, se indica que no se registró un motivo
y se orienta a consultar disponibilidad y autorización.

La búsqueda parcial tiene límites de tiempo e intentos. Si se agotan antes de
demostrar el máximo de encuentros programados, la pantalla indica que podría
ser posible programar más. Los pendientes se pueden completar en **Propuestas
de programación** mediante **Ajustar encuentro**. Una propuesta con pendientes
puede enviarse a revisión, pero su aprobación se rechaza hasta completarlos y
revalidar las restricciones. La confirmación y reserva de partidos oficiales
pertenecen a su flujo posterior y requieren su propia comprobación.

## Evidencia de esta rama local

- `npm run typecheck` y ESLint de los componentes modificados: aprobados.
- `node --test tests/e2e/scheduling-proposals.test.mjs`: cuatro casos aprobados
  en Chrome, a 390 y 1440 píxeles y con preferencia clara y oscura. Las
  respuestas se simulan. Comprueban propuesta completa, pendiente, motivos,
  aviso de límite, pendiente sin motivo y captura de cancha y horario.
- La prueba integrada `tests/integration/scheduling.test.ts`, ejecutada en
  PostgreSQL local temporal, comprobó generar una propuesta parcial, guardar
  motivos, conservarlos al ajustar otro encuentro, enviar pendientes a revisión
  y rechazar su aprobación. La base temporal se eliminó al terminar.
- Las pruebas de búsqueda parcial comprueban conservación de encuentros sin
  choques y la indicación de límite. No garantizan que una búsqueda interrumpida
  encuentre el máximo posible.

## Pendiente para la aceptación

- Ejecutar al final el recorrido de generación, recuperación, ajuste y revisión
  en la aplicación integrada con sesiones y permisos reales, incluyendo una
  propuesta pendiente y sus motivos.
- Integrar los cambios locales y registrar el resultado del CI de la versión final.
  Las ejecuciones aquí descritas no son CI remoto ni una validación visual con
  datos reales. No se ha actualizado el estado de Jira por esta documentación.
