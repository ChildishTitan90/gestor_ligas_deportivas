# PDGLD-137 — Evidencia de generación y restricciones

Estado: evidencia local de la rama `feat/PDGLD-25-canchas-pendientes`, basada
en el trabajo de PDGLD-24 y PDGLD-25. Los cambios siguen sin commit ni push;
esta evidencia no constituye aceptación funcional ni resultado de CI remoto.

## Generación y propuestas parciales

El generador considera temporada, categoría, grupo, equipos, jornadas,
descansos, canchas y restricciones. Cuando se solicita permitir pendientes,
puede guardar una propuesta parcial sin reservar recursos: los encuentros que
no se acomodaron conservan jornada, local y visitante, con cancha y horario
nulos. La propuesta también puede contener encuentros completos. Los factores
registrados describen lo detectado al generar y no sustituyen la revalidación
posterior.

La búsqueda parcial intenta maximizar los encuentros programados sin traslapes.
Si alcanza el límite de tiempo o intentos antes de demostrar el máximo, conserva
la mejor combinación encontrada e informa que podría haber otra con menos
pendientes. Un resultado completo no garantiza disponibilidad futura.

La propuesta no crea partidos oficiales, no reserva canchas y no publica. Su
confirmación posterior debe volver a comprobar permisos, autorización,
disponibilidad y reservas. La pantalla se documenta en
`docs/validation/PDGLD-136-pantalla.md`.

## Integración con PDGLD-25

La rama incorpora el ajuste de propuestas de Karol y el validador compartido.
La prueba con PostgreSQL local ha cubierto generar, recuperar, ajustar, revalidar
y enviar una propuesta a revisión, así como versión obsoleta, bloqueo de cancha,
permisos y ediciones simultáneas. También se probó completar un encuentro
pendiente, conservar los motivos de otros y rechazar la aprobación mientras
queden pendientes. Enviar a revisión no publica ni reserva.

El detalle autorizado y el ajuste usan la propuesta guardada, su versión de
temporada y su versión de edición. El validador se ejecuta en una transacción
`SERIALIZABLE`; valida estructura y restricciones de los encuentros completos y
conserva los pendientes para el ajuste posterior. Antes de aprobar se exige que
no queden encuentros pendientes. La información de sesión y permisos se obtiene
en el servidor. La interfaz de ajuste y sus límites están descritos en
`docs/architecture/scheduling-proposal-integration.md`.

## Autorización de canchas y concurrencia

Con datos sintéticos en PostgreSQL temporal, las pruebas comprobaron que una
cancha de otro club no queda habilitada únicamente con la aprobación del dueño;
el rechazo del dueño o de la liga tampoco la habilita. Dos aprobaciones permiten
usarla dentro de la ventana autorizada, incluyendo partido y holgura; se rechaza
un horario fuera de esa ventana. Se probaron identidades diferentes para el
solicitante, el dueño y la liga.

La generación y el ajuste bloquean la temporada durante su transacción. La
decisión del préstamo adquiere el mismo bloqueo antes de cambiar su estado. Las
pruebas forzaron dos escenarios y comprobaron la espera con PostgreSQL:

1. Una aprobación de la liga iniciada durante la generación espera al cierre de
   esta; la propuesta generada no usa la autorización aún pendiente.
2. Una aprobación iniciada durante un ajuste espera al cierre del ajuste. El
   ajuste con préstamo pendiente se rechaza sin cambiar la versión; tras la
   aprobación, un nuevo intento se revalida y se guarda.

Estos escenarios comprueban los órdenes descritos; no demuestran todos los
posibles intercalados ni sustituyen una prueba del entorno con RLS habilitado.

## Pruebas y medición ejecutadas

- `npm run test:scheduling`: **19 pruebas** del motor, restricciones y ventanas
  de préstamo, incluidas búsqueda parcial y límite de búsqueda.
- `tests/integration/scheduling.test.ts` mediante `scripts/test-scheduling.mjs`:
  ejecución aprobada en PostgreSQL local temporal, con General y grupos de cuatro
  y cinco equipos, localías, descansos, bloqueos, permisos, reintentos,
  concurrencia y los escenarios de préstamos descritos arriba. El runner eliminó
  la base y el rol temporales al terminar.
- `npm run typecheck` y ESLint de los archivos modificados: aprobados en las
  comprobaciones locales ejecutadas.
- `tests/e2e/scheduling-proposals.test.mjs`: cuatro casos Chrome aprobados, en
  390/1440 píxeles y temas claro/oscuro, con respuestas simuladas. Incluyen la
  presentación de pendientes, motivos y aviso de límite; no prueban sesiones ni
  servicios reales.
- Una ejecución local del servicio con **20 equipos, 19 jornadas, 190 encuentros,
  cuatro canchas y una vuelta** registró aproximadamente **6,05 segundos**.
  Es una medición de ese escenario y entorno, no una garantía para otros tamaños
  ni una verificación del entorno desplegado. En pruebas previas a estos cambios
  se documentaron ejecuciones con PostgreSQL 15 y 17; no se atribuye esa matriz
  a la versión final sin volver a ejecutarla.

## Pendiente de aceptación

- Ejecutar al final el recorrido completo en la aplicación con sesiones y
  permisos reales, incluyendo canchas pendientes, sus motivos y su ajuste.
- Verificar la versión final en los entornos y versiones PostgreSQL requeridos,
  incluyendo RLS donde corresponda, y registrar el resultado del CI remoto.
- Integrar los cambios locales, enlazar la implementación y la evidencia en
  Jira y actualizar el estado según el resultado. No se ha cerrado PDGLD-137.
