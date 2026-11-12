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

## Revisión de pendientes · 12/11/2026

El PR #53 fue fusionado como d46c2db. Esta revisión parte de ese estado de
`origin/develop`. La publicación de un seguimiento requiere otro PR, porque un
PR fusionado ya no admite nuevos commits ni puede convertirse de nuevo a Draft.

### Decisión pendiente sobre mitades

[PDGLD-68](https://victoranhernandez.atlassian.net/browse/PDGLD-68), comentarios
10026, 10032 y 10036 del 30/10, recoge el reporte de Sergio de que un jugador puede
jugar un tiempo en una categoría y la otra mitad en otra. Las aclaraciones validan
participación entre categorías, edades, carta y ascenso por fuerzas. Ninguna
precisa la correspondencia temporal entre esas mitades. El estado Hecho del ticket
no aporta las condiciones que faltan para automatizar ese caso.

La fuente de ERS accesible sigue siendo
[ERS_Gestor_Ligas_Deportivas_IEEE830, versión 0.1](https://docs.google.com/document/d/1iJRdP4IOxhM__ft8X_y5gWOeOOflszzZcCvfqr4ckPU/edit),
del 03/10. RF02 trata inscripción única y RF03 captura de cédula. No define esta
excepción. El PDF completo citado por el proyecto continúa sin localizar en las
fuentes accesibles. Se conserva `PARTICIPATION_RULE_PENDING` ante coincidencia o
horario incompleto.

Ejemplo ilustrativo que requiere decisión de Liga/profesor, con equipos distintos
y ascenso ya autorizado del jugador, en hora local de Morelia. Los horarios y
minutos del ejemplo son supuestos, pendientes del reglamento de cada categoría:

- Partido A de origen programado de 10:00 a 11:30. El jugador disputa su primer
  periodo, del minuto 0 al 45.
- Partido B de destino programado de 10:15 a 11:45. Se solicita su segundo
  periodo, del minuto 0 al 45.
- Si ambos siguen el horario previsto, los periodos pueden quedar separados. Si
  A se retrasa veinte minutos, pueden coincidir. Los minutos actuales son
  relativos a cada periodo y no acreditan esos instantes reales.

Falta que Liga/profesor defina si basta elegir primer periodo en A y segundo en B
o si deben quedar separados en tiempo real. Para la segunda opción debe definir
qué reloj y evidencia se usan, cómo cuentan descanso y retrasos, si se permiten
fracciones o reingreso en ambas mitades, y desde qué temporada/categorías rige.
Sin esa respuesta, el mismo payload puede representar un cruce permitido o uno
simultáneo. No se fijan duraciones, márgenes ni equivalencias de periodo por
inferencia.

### Punto de integración con PDGLD-18

[PDGLD-18](https://victoranhernandez.atlassian.net/browse/PDGLD-18) y sus subtareas
147/148/149 siguen Por hacer, a cargo de Víctor. Inicio objetivo 16/11 y entrega
revisable 19/11. Se comprobaron las ramas remotas y los PR disponibles el 12/11.
No se encontró una implementación de captura online para integrar. En el árbol
actual, `/matches` y `/matches/[matchId]/lineup` muestran consulta. No existe
entrada HTTP o Server Action que invoque `recordParticipationInTransaction`.
Sus consumidores actuales están en `tests/integration/match-eligibility.ts`.

El servicio de cédulas de PDGLD-18 debe realizar estas operaciones:

1. Obtener el actor desde la sesión del servidor, validar el payload y autorizar
   captura, alcance y estado del partido mediante los contratos de PDGLD-85/86.
2. Abrir una única transacción. Crear o resolver cédula DRAFT y alineación por
   sus identificadores oficiales. Mantener el dorsal del partido según su propio
   contrato, separado del dorsal habitual del DTO de elegibilidad.
3. Invocar `recordParticipationInTransaction(tx, actorId, input)` desde esa misma
   transacción. `input` contiene `matchId`, `lineupId`, `expectedMatchVersion`,
   `expectedReportVersion` y `periods`. Cada periodo contiene `periodNumber`,
   `entryMinute` y `exitMinute`, con minutos relativos y nulos explícitos.
4. Conservar el bloqueo compartido de partido hasta confirmar toda la escritura.
   Un error revierte también los cambios de alineación y cédula del consumidor.
   `STALE_MATCH` exige volver a consultar la versión del partido conservando la
   captura del usuario. `STALE_REPORT` exige resolver la versión de cédula.
   `PLAYER_NOT_ELIGIBLE` exige mostrar los motivos de la reevaluación autorizada.
   No se continúa una transacción fallida ni se cambia la versión para reenviar
   automáticamente una operación incierta.
5. Devolver el acuse después del commit. Para varios jugadores, cada llamada
   incrementa la versión de cédula y la siguiente usa `reportVersion` devuelta por
   la anterior. Si falla una, toda la operación compuesta debe revertirse.
6. Reabrir mediante una lectura autorizada de la cédula y de sus periodos. La
   lectura de elegibilidad actual presenta periodos agrupados por Persona y
   temporada y no sustituye la lectura exacta de una cédula/alineación guardada.

Existe una diferencia de autorización que debe resolverse en la integración:
PDGLD-18 contempla DATA_ENTRY autorizado y árbitro designado. El contrato actual
de PDGLD-16 exige siempre designación propia de árbitro, además de CREATE/UPDATE.
Por tanto, DATA_ENTRY todavía no puede consumirlo sin una política deliberada de
captura por alcance. PDGLD-18/85/86 deben definir y probar ese acceso antes de
ampliar el servicio común. Ocultar el botón o enviar un rol desde el navegador
no aporta autorización.

El recorrido de aceptación pendiente debe usar sesión real de una cuenta
sintética operativa, designación aprobada, partido capturable y candidato
habilitado. Desde Mis partidos debe abrir cédula, capturar tiempos, guardar con
acuse, navegar fuera y volver a abrir comprobando los periodos persistidos.
Debe repetir guardado con reprogramación concurrente y comprobar conflicto,
conservación del payload y ausencia de sobrescritura de la captura anterior.
El servicio actual ya tiene regresión PostgreSQL de esa carrera. La pantalla,
sesión HTTP y reapertura de cédula siguen dependiendo de PDGLD-18.

### Evidencia de esta revisión

Sobre develop d46c2db, el 12/11 pasaron `npm run typecheck`, `npm run lint`,
`npm run test:match-eligibility-integration` (19/19) y
`npm run test:match-eligibility-browser` (1/1). La integración utiliza servicios
reales y PostgreSQL 15 desechable con proveedores simulados. Demostró selección
por partido, ascenso autorizado, sanciones y guardado con reprogramación
concurrente, conflicto y conservación de periodos. Chrome demuestra la consulta
con DTOs sintéticos en ambos temas y tamaños. El recorrido autenticado de captura,
guardado y reapertura desde una cédula sigue pendiente porque su flujo no existe
en las fuentes consultadas. El fetch final confirmó d46c2db.
