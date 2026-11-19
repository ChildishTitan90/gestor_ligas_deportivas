# PDGLD-137 — Evidencia de generación e integración pendiente

Estado: pruebas locales para revisión, no aceptación ni cierre de Jira. La rama
`feat/PDGLD-24-programacion` contiene avances locales de PDGLD-24/135/136/137;
la revisión y el CI del cambio final aún deben completarse.

## Resultados locales

- `npm run test:scheduling`: pruebas del motor, restricciones y ventanas de préstamo.
- `node scripts/test-scheduling.mjs`: PostgreSQL local temporal. Tabla General y
  fase de grupos con cuatro y cinco equipos, parejas únicas y descansos; distribución
  incompleta; dos vueltas en cancha compartida con bloqueo, intervalo y tramos;
  ausencia de traslapes, inversión de localía y conflictos sin propuesta inválida.
- El mismo runner prueba permiso ausente y permiso de otra liga, repetición sin
  duplicado, dos actores con solicitudes distintas y rechazo de una clave ajena,
  control de versión, rollback, ACL limitadas y préstamos aprobados/rechazados.
  Las llamadas concurrentes se iniciaron juntas; la prueba no fuerza un orden de
  adquisición del bloqueo. El runner elimina su base y rol temporales.
- `node scripts/test-scheduling.mjs --browser`: navegación, configuración,
  generación, recuperación tras perder el acuse, recarga y falta de horarios;
  los mensajes de combinación imposible y límite se verifican con respuestas
  simuladas. El caso de falta de horarios utiliza el servicio real local.
- Medición de una muestra: 20 equipos, 19 jornadas, 190 encuentros, cuatro
  canchas y una vuelta; 8,17 segundos para el grupo completo en PostgreSQL 15
  local. Condiciones y límites en `docs/architecture/scheduling-generation.md`.
- `npm run typecheck` pasó después de los cambios locales de pruebas y mensajes.

Los resultados son evidencia de desarrollo local. Falta verificar la revisión
externa y el CI del commit definitivo; no acreditan aceptación funcional ni el
comportamiento de todas las configuraciones o del entorno desplegado.

## Entrega disponible para PDGLD-25

El generador crea una fila en `sports_management.schedule_proposals`, con ID de
operación, temporada, primera jornada, versión de reglamento referenciada,
autor y fecha. `parameters` contiene un objeto `formatVersion: 1` con contexto
de grupo y categoría, versión de temporada, reglamento y número de versión,
motivo, zona horaria, nombres de referencia y `state: DRAFT_PROPOSAL`. Cada
encuentro incluye jornada y `matchdayId`, local, visitante, cancha, inicio,
fin y `reservedUntil`; también se guardan descansos y `matchdayId` de cada uno.
Los identificadores de local/visitante y descanso corresponden a inscripciones
de equipo en temporada (`season_teams.id`). Inicio, fin y holgura son instantes
ISO; `reservedUntil` incluye el tiempo de separación de la cancha.

Una propuesta guardada **no reserva recursos, no crea partidos oficiales y no
publica**. Pueden existir propuestas alternativas para un mismo grupo. El ajuste
de PDGLD-25 debe comprobar autorización, revalidar reglas y disponibilidad sobre
el estado vigente, y aplicar su propio control de versiones, autoría y auditoría.
El campo `seasonVersion` es la versión observada al generar, no una versión de
edición de la propuesta. La publicación sigue el flujo correspondiente de RF16.

La lectura actual de la pantalla es `GET /api/scheduling/proposals` con
`seasonId` y `groupId`, autenticación de sesión y permiso `scheduling:CREATE`
con ámbito de liga. Devuelve ID, fecha y una proyección para revisión visual.
**No es aún el contrato completo de ajuste:** su esquema de lectura elimina,
entre otros, `matchdayId`, `reservedUntil`, `seasonVersion`, reglamento, autor y
estado. No se debe inferir que la respuesta de esa ruta contenga esos datos ni
usar una copia antigua como autorización o validación para guardar ajustes.

## Por completar con Karol y la persona revisora

1. Compartir una versión revisable de nuestra rama y acordar el contrato de
   lectura/escritura que PDGLD-25 necesita para su propuesta mínima, incluidos
   versiones, revalidación y controles de acceso. La rama actual todavía no se
   ha entregado mediante PR; no se comprobó la integración con PDGLD-25.
2. Conectar el ajuste de Karol y ejecutar el recorrido integrado: generar,
   recuperar, ajustar, revalidar y enviar a revisión sin publicar automáticamente.
   Verificar dos ediciones concurrentes y el rechazo de una versión obsoleta.
3. Pedir revisión a otra persona y enlazar PR, CI y evidencia en las tareas.
   No se ha solicitado ni registrado esa revisión desde este documento.

Los escenarios de prueba eliminan sus propuestas sintéticas al terminar. No se
deja una propuesta persistente en una base compartida ni se expone información
de una liga real. Para preparar una demostración conjunta, acordar un entorno y
datos de prueba con quien revise.

## Contrato local del validador compartido

`validateScheduleProposalInTransaction(tx, actorId, input)` se exporta desde
`src/features/scheduling/server/service.ts`. Es exclusivo de servidor. Recibe
`proposalId`, `expectedSeasonVersion` y la lista completa de encuentros, cada uno
con `round`, `matchdayId`, `home`, `away`, `venueId` y `start` ISO UTC. No debe
recibir el actor desde el navegador: el llamador debe obtenerlo de la sesión.
La función exige una transacción `SERIALIZABLE`, comprueba `scheduling:UPDATE`
en la liga, bloquea temporada y propuesta, y lee la configuración vigente.

Permite intercambiar local y visitante y cambiar cancha y horario. Conserva los
enfrentamientos y las jornadas existentes; mover jornadas o cambiar equipos no
forma parte del contrato actual. Comprueba la estructura de cada vuelta, la
alternancia de localía entre vueltas, duración y holgura, disponibilidad,
bloqueos, jornada y temporada, descansos, sanciones, préstamos aprobados,
canchas permitidas y traslapes contra otros encuentros y partidos que reservan
recursos. Recalcula `end`, `reservedUntil`, preferencias y descansos en el
servidor. Devuelve `{ok:true,matches,byes}` normalizados, o `{ok:false,code,
conflicts}`; cada conflicto de horario incluye jornada, equipos y código.

La función **no guarda cambios ni comprueba la versión de edición de PDGLD-25**.
Karol debe comprobar esa versión y guardar la salida normalizada dentro de la
misma transacción, manejar los conflictos de serialización y conservar su propia
autorización, auditoría y estados. `seasonVersion` protege la configuración, no
sustituye la versión de edición. La validación no reserva canchas; las operaciones
que confirmen partidos deben volver a revalidar y coordinar reservas de recursos.
La integración real con PDGLD-25, sus controles de concurrencia y la revisión
del PR siguen pendientes; esta interfaz todavía puede necesitar ajustes conjuntos.

### Adaptación en PDGLD-25

El cuarto argumento opcional de `validateScheduleProposalInTransaction` es
`action: "UPDATE" | "APPROVE"`, con valor predeterminado `UPDATE`. Se decide
exclusivamente en servidor: edición y envío usan UPDATE, aprobación usa APPROVE.
Así Presidencia puede revalidar al aprobar sin recibir permiso de edición.
El navegador no puede elegir este argumento. Ambas acciones aplican exactamente
las mismas restricciones y exigen ámbito de liga sin concesiones de club.
El adaptador y las pruebas están en `docs/architecture/scheduling-proposal-integration.md`.
