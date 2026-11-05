# PDGLD-13/14 — sesión del 04/11/2026, entrega 1

## Diagnóstico previo y alcance acordado

`people.curp` es único; `users.person_id` también. Los cargos y jugadores se
vinculan con Persona. El registro no crea cuentas. La misma CURP y equipo recupera
la inscripción existente; identidades discrepantes no se sobrescriben. La
reutilización exige permisos y alcance, pero faltaba admitir a responsables del
club ya presentes en una afiliación, sin una inscripción anterior de jugador.

La similitud actual compara nombres normalizados (sin acentos/capitalización)
y nacimiento: mismo día admite una edición por nombre/apellido; días adyacentes
exigen nombres iguales. No compara CURP aproximadas, no identifica automáticamente
a la misma persona y no fusiona filas. La CURP exacta es un caso de unicidad y
reutilización, no una segunda solicitud que deba aprobarse. Se conserva la revisión
con versión para posibles homónimos; resolverla no une identidades.

`unique_player_per_season` impide otra inscripción vigente de la misma Persona en
el torneo. El trigger conserva lunes–miércoles, pertenencia inmutable y límites
de cambio de equipo. Se mantienen ambos y sus datos. `hierarchy_order` solo es un
orden existente, sin familia deportiva explícita; no se usará para subir jugadores.
Las propuestas de ascenso/descenso existentes son de equipos, no de jugadores.

Primera entrega: identidades, inscripción de origen y participaciones superiores
separadas, con backend/HTTP y pruebas. Sin pantallas nuevas (entrega 3), cambios
de Jira, commits, push, merge, Supabase ni consultas reales de identidad.

## Modelo y límites de esta entrega

- La inscripción existente es el origen. Conserva Persona, equipo y categoría.
- `player_category_levels` asigna explícitamente familia y nivel por categoría de
  torneo. Niveles mayores son superiores; solo se permite el nivel inmediatamente
  siguiente, conservando Tercera → Segunda → Primera sin saltos directos. El
  número no se deduce del nombre ni del orden visual. No se configuran familias
  o edades reales en la migración. Una familia no mezcla OPEN, YOUTH o VETERANS.
- `player_category_participations` referencia el origen y el equipo superior del
  mismo club/torneo. Nunca crea otra Persona, cuenta o inscripción de origen.
  Una sola participación por origen/categoría; clave de operación y hash para
  reenvíos, unicidad y bloqueos para carreras. Una participación temporal no sirve
  como nuevo origen ni permite encadenar saltos como si fuera promoción definitiva.
- Su estado en esta entrega es PENDING_ELIGIBILITY; `sportsEligible=false` siempre.
  Aceptar la participación superior **no habilita para alineación**. No se crean
  lineups ni se cambia ACTIVE. La habilitación con documentos es la entrega 2 y
  su consumo desde cédulas será del módulo correspondiente.
- No permite otro club, otra temporada, categoría inferior/igual, salto de fuerza,
  familia distinta, política de edad pendiente, excepción de edad sin aprobación,
  inscripción retirada/suspendida o coincidencias pendientes sin resolución vigente.
  Se rechazan sanciones vigentes que bloquean participación para la Persona o los
  equipos implicados; no se implementa el motor de cumplimiento disciplinario.
- Se conserva lunes–miércoles para nuevas participaciones. Consultar/reenvíos
  confirmados no generan otra alta. Permisos de jugador CREATE/READ en ambos
  contextos; configurar familias requiere competitions UPDATE y APPROVE.
- Configuración inicial explícita, auditada e inmutable en esta entrega. Su edición
  y presentación administrativa se revisarán antes de añadir pantallas; no hay
  backfill por nombres ni configuración implícita para equipos existentes.

## Hallazgos reservados para la entrega 2

Los requisitos actuales mezclan document_requirements y posiciones por defecto
(CURP, tutor, alternativas escolares y foto); todavía no consumen integralmente
player_policy.documents de la categoría. Hay que resolver esa correspondencia,
evidencia de nacimiento/CURP y tipos autorizados de identificación opcional.
La activación automática adulta exime CURP y tutor/escolares y comprueba otros
requisitos, pero no evalúa toda la política vigente de torneo. No se declara
corregida aquí. Las nuevas participaciones no heredan esa activación.

Se mantienen CURP verificada, recepción de archivo, aprobación documental,
consentimiento acreditado y habilitación deportiva como estados distintos.
No se convierte INE + selfie en obligación. No se fija 37 en lugar de 35 años,
ni se impone acta + constancia como dos documentos. «Firma para todas» no resuelve
si deben firmar los adultos. La autorización del tutor se conserva.

Dependencias fuera de estas historias: consulta para responsables del club;
cantidad/asignación/conflictos de interés de árbitros; habilitación para cédulas.

## Contratos HTTP de la entrega 1

Todos requieren sesión operativa. POST exige Origin igual al configurado,
JSON acotado y contrato estricto; no acepta rol, club autorizado, edad calculada
ni habilitación enviados por el navegador. Las respuestas son privadas/no-store.

- GET/POST `/api/competitions/seasons/{seasonId}/player-pathways`.
  GET exige competitions READ. POST exige UPDATE y APPROVE en la temporada,
  PLANNED sin inicio, versión vigente y motivo. Cuerpo:
  `{ pathwayCode, expectedSeasonVersion, reason, categories:
  [{seasonCategoryId,level}, ...] }` con categorías distintas, tipo compatible y
  niveles consecutivos desde 1. Reenvío de la misma definición recupera sin
  duplicar; otra definición de una familia ya configurada da conflicto.
- GET/POST `/api/player-registrations/{originRegistrationId}/category-participations`.
  POST recibe `{operationKey,targetSeasonTeamId,reason}`. Autoriza CREATE/READ en
  origen y destino y deriva Persona, club, torneo y categorías del servidor.
  Responde `{id,originRegistrationId,targetSeasonTeamId,targetSeasonCategoryId,
  status:"PENDING_ELIGIBILITY",sportsEligible:false,replayed}`. No devuelve CURP,
  huellas internas ni credenciales. GET reautoriza ambos contextos.

La edad ordinaria se evalúa con `readPlayerPolicy`/`evaluatePlayerAge` existentes,
por año de referencia, para ambas categorías. Una excepción no se presume
aprobada: se rechaza AGE_REQUIRES_REVIEW en esta entrega. Se verifica la revisión
de identidad vigente; no basta una bandera antigua. Las sanciones con
blocks_participation vigente por fechas bloquean una nueva participación para la
Persona o los equipos implicados. No se interpreta una carga de archivo o un
conteo de cumplimientos como levantamiento de una sanción. La habilitación real
debe volver a evaluar disciplina al momento de alinear; no se implementa aquí.

PostgreSQL conserva claves foráneas por torneo, unicidad por origen/categoría y
por actor/operación, pertenencia al club, paso superior consecutivo, tipo/familia,
edad ordinaria, ventana semanal y estado siempre pendiente. Filas y niveles son
inmutables y auditados una sola vez mediante el trigger existente, sin nombres ni
CURP. No se copia ni reescribe la inscripción de origen. No hay cambio de
`lineups`: todavía referencia la inscripción original.

Un trigger adicional impide bajar mediante baja y nueva alta de origen dentro
del mismo torneo/familia explícita. Consulta el historial de orígenes, incluidas
bajas, y serializa por Persona. No usa participaciones temporales como si fueran
promociones: volver al origen conservado no equivale a bajar desde la participación
superior. Las reglas previas de transferencias y el índice original se conservan.

Las tablas nuevas revocan PUBLIC y roles API; en una instancia administrada
activan RLS sin políticas públicas. Docker sigue sin RLS salvo fixtures explícitos.
El plan de Preview añade solo las lecturas/inserciones necesarias y lectura
limitada de sanciones, sin UPDATE/DELETE de participaciones ni niveles. No se
aplicó ese plan a Supabase ni se añadió una excepción al bloqueo del CD de tablas
nuevas. Una futura liberación requiere su revisión de seguridad habitual.
