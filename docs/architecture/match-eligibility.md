# PDGLD-16 · Elegibilidad por partido y contrato con PDGLD-18

Entrega del 10/11/2026 sobre `origin/develop` 0a2fc44. No declara aceptación
funcional ni modifica estados de Jira. PDGLD-32 y PDGLD-29 no forman parte del diff.

## Fuentes y decisiones

- [PDGLD-16](https://victoranhernandez.atlassian.net/browse/PDGLD-16),
  subtareas 144/145/146 y comentarios consultados el 10/11/2026.
- [PDGLD-68](https://victoranhernandez.atlassian.net/browse/PDGLD-68):
  aclaración de Sergio del 30/10 confirma categorías, carta y ascenso consecutivo.
  También reporta un tiempo en cada categoría para partidos coincidentes. No
  determina correspondencia entre periodos, reloj real, retrasos o reingresos.
- [PDGLD-18](https://victoranhernandez.atlassian.net/browse/PDGLD-18): cédula
  online futura, dorsal por partido, tiempos y confirmación atómica.
- Implementaciones integradas de PDGLD-13/14/15, familias explícitas, expediente,
  excepciones de edad y protección histórica de PDGLD-117. Se conserva el dorsal
  de PDGLD-121 integrado en develop.
- Drive permitió leer `ERS_Gestor_Ligas_Deportivas_IEEE830`, versión preliminar
  0.1 del 03/10, con RF02 identidad y RF03 cédula; su RF05 disciplina difiere de
  RF06 en Jira. No se localizó el PDF completo que el repositorio referencia
  como `ERS PROYECTO LIGAS DEPORTIVAS.pdf`. No se afirma contraste completo de ese
  documento ni se cambia la matriz RF22 aprobada por esta discrepancia.

## Servicio

`features/matches/server/eligibility.ts` autoriza sesión mediante la entrada de
página y vuelve a comprobar cuenta operativa, designación APPROVED del árbitro
activo y permiso `match-reports:CREATE` en el partido real. No concede un permiso
general de lectura de jugadores al árbitro. Incluso un administrador sin
designación queda denegado en este recorrido. La navegación consulta el mismo
servicio; una URL directa reautoriza el recurso.

La consulta limita candidatos a la plantilla de cada uno de los dos equipos del
encuentro y a participaciones `AUTHORIZED` del equipo, categoría, club y temporada
de destino. Compartir club o temporada no basta para aparecer en el DTO. Dentro
de ese conjunto se conservan los motivos de bloqueo (incluidas sanciones).

La evaluación utiliza `assessPlayerEligibility`, con inscripción ACTIVE,
identidad/documentos vigentes, excepción de edad autorizada cuando corresponde,
equipo inscrito/afiliado y ámbito. Un ascenso necesita la participación AUTHORIZED
del destino, huella vigente y familia/nivel explícitos consecutivos del mismo
club y temporada. No se deduce una escala de nombres, `hierarchy_order`, Libre,
infantiles o Veteranos. La inscripción original nunca se cambia para alinear arriba.

Se conservan los triggers que impiden reescribir pertenencia o cambiar de equipo
tras el inicio. Las sanciones conservan el alcance existente: Persona o equipos
de los contextos, `blocks_participation`, inicio inclusivo y fin exclusivo. La
nueva opción interna `sanctionAt` evalúa la fecha del partido; los consumidores
anteriores conservan el reloj actual. Sin horario no se certifica elegibilidad.
No se presume levantamiento por cantidad de cumplimientos ni se añade un motor
disciplinario. El dorsal no forma parte de la huella de identidad/documentos.

CLOSED devuelve aviso histórico y ninguna elegibilidad actual; no consulta
nombres vigentes como sustituto de evidencia histórica ni escribe snapshots.
La presentación de la cédula histórica corresponde al consumidor de PDGLD-18.

## Tiempos y cruces

Se leen los periodos existentes de `player_period_participations`, con minutos
relativos al periodo y valores ausentes explícitos. No se infieren minutos jugados
por estar convocado. Otra alineación con intervalos completos y separados no
bloquea por un margen inventado. Una coincidencia o intervalo incompleto devuelve
`PARTICIPATION_RULE_PENDING`: todavía no se puede certificar ese caso. Se examinan
también otras temporadas de la Persona, sin revelar sus detalles privados en el
motivo. Se excluyen partidos cancelados/eliminados.

**Decisión requerida:** la Liga debe precisar qué significa «un tiempo y la otra
mitad»: periodos que pueden combinarse, relación con hora programada/real,
desfases, tiempos incompletos, prórroga y reingreso. Confirmar además si hay
descanso o límite diario y su vigencia por temporada/categoría. No se inventaron
45/90 minutos, distancia, tolerancia ni una prohibición definitiva de compartir
partidos. La excepción coincidente sigue pendiente funcional y mantiene el PR Draft.

## Contrato transaccional para PDGLD-18

- `evaluateMatchInTransaction(tx, actorId, matchId)` devuelve `LineupEvaluation`:
  versión del partido, jugadores por destino, elegibilidad, códigos/motivos y
  periodos. El actor procede del servidor; el navegador no concede identidad,
  rol, club, permiso ni un booleano de elegibilidad confiable.
- `recordParticipationInTransaction(tx, actorId, input)` exige además UPDATE;
  recibe `matchId`, `lineupId`, `expectedMatchVersion`, `expectedReportVersion` y
  `periods: [{periodNumber,entryMinute,exitMinute}]`. Valida enteros, orden de
  entrada/salida, periodos únicos y pertenencia de alineación/cédula al partido.
  Toma `FOR SHARE` sobre `matches` y comprueba su versión bajo ese bloqueo,
  conservado hasta el COMMIT/ROLLBACK del consumidor. Es incompatible con el
  UPDATE de horario y versión, incluso si no modifica claves. La autorización
  existente también usa FOR SHARE; el contrato de escritura lo exige explícitamente.
  No existe todavía un servicio de reprogramación en esta rama: el flujo de base
  actual actualiza `matches` y ejecuta `matches_reservations`, que reconstruye
  reservas. No se sustituyen esos triggers ni se requiere un advisory lock del
  futuro consumidor. En READ COMMITTED, una reprogramación que gana el bloqueo
  hace que el guardado espere y devuelva `STALE_MATCH`; con aislamiento superior,
  PostgreSQL puede abortar por serialización y el consumidor debe revertir toda
  la transacción, nunca continuarla ni reintentar con una versión inventada.
  Reevalúa, exige cédula DRAFT y versión vigente, incrementa versión y reemplaza
  periodos de esa alineación en una transacción. Un fallo conserva los anteriores.
  Los triggers existentes auditan con actor/motivo; no se duplica auditoría manual.
- El consumidor debe invocarlo dentro de la misma transacción que crea/modifica
  alineación y cédula, y aplicar la política de estados del partido de PDGLD-18.
  No exponerlo como escritura independiente ni continuar una transacción tras
  capturar sus errores. No usar un DTO leído anteriormente como autorización.
- No se creó una cédula implícita, endpoint de confirmación, firma, resultado ni
  tabla de clasificación. No se garantiza aún sincronización offline/idempotencia
  de PDGLD-19/20. El versionado rechaza reenvíos obsoletos sin borrar su payload.

No hay migración, paquetes nuevos ni cambio de `compose.yml`. Las tablas y
restricciones existentes permiten este contrato. La integración real y la
validación humana del alcance temporal siguen pendientes antes de aceptar la HU.
