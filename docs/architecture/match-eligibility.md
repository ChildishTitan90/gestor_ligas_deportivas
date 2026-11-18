# PDGLD-16 · Elegibilidad y participación por mitades

Seguimiento del PR #53 sobre `develop` 129d1f8, 18/11/2026. No cambia permisos
RF22, inscripciones, migraciones, proveedores, `compose.yml` ni estados de Jira.

## Requisitos contrastados

- Jira PDGLD-16 y subtareas 144/145/146: origen o superior inmediata autorizada,
  plantilla inscrita, pertenencia inmutable, sanciones y periodos por partido.
- PDGLD-68, comentario de Sergio del 30/10: participación por mitades aceptada
  en principio; no es una autorización para saltar categorías ni cambiar de club.
- ERS completo, `ERS PROYECTO LIGAS DEPORTIVAS.docx`, pp. 23–24: RF02.2
  inscripción única; RF02.6 superior inmediata del mismo club; RF02.7 permite
  partidos de categorías diferentes del mismo club y, cuando coinciden horarios,
  pasar de uno al otro en el medio tiempo, registrando periodos. RF02.10 y
  RF03.2/03.3 exigen comprobación y evidencia en la cédula.
- El ERS no fija 45 minutos, descanso diario, distancias ni tolerancias de traslado.
  Esta implementación no añade esas restricciones. No interpreta la regla como
  permiso para jugar simultáneamente dos primeras o dos segundas mitades.

## Decisión operativa de RF02.7

1. La cédula puede reservar al convocado para primera o segunda mitad; esa reserva
   se sella con la alineación. No acredita minutos ni autoriza al jugador por sí sola.
2. En partidos con horarios coincidentes, solo se admite combinación primera /
   segunda mitad, en categorías distintas del mismo club y temporada. La
   autorización deportiva del destino sigue siendo obligatoria. No se crea otra
   inscripción ni se cambia el equipo de origen.
3. El segundo tiempo debe comenzar después o exactamente al terminar el primero
   del otro partido. Se usan marcas ISO del reloj de servidor guardadas por las
   acciones de la cédula; no se suman 45/90 minutos al horario programado. Retrasos
   y compensación quedan reflejados en las marcas reales.
4. Antes de existir esas marcas puede guardarse la reserva. Al registrar juego se
   reevalúa con el reloj resultante de la operación. Sin marcas suficientes se
   rechaza la captura; no se reconstruye retrospectivamente un descanso histórico.
5. Un reservado para segunda mitad no puede ser titular. Su entrada se registra
   al descanso, segundo periodo, minuto relativo y segundo cero. Un reservado
   para primera debe salir antes de iniciar la segunda. Los eventos y periodos
   fuera de la mitad reservada se rechazan. Se conserva el mecanismo existente de
   sustituciones y reemplazo de capitán.
6. Programaciones separadas no crean un descanso mínimo adicional. Las marcas
   reales también detectan superposición causada por un retraso. Partidos
   cancelados o eliminados se excluyen. Ante horarios incompletos no se certifica
   juego sin comprobar las marcas necesarias.

No se habilitan prórroga, reingreso, un límite diario nuevo ni confirmación oficial
bloqueada por otras historias. La revisión humana debe contrastar esta
operacionalización de «medio tiempo»; el código no constituye su aceptación.

## Autorización y privacidad

La consulta arbitral exige cuenta operativa, árbitro activo y designación efectiva
aprobada, además de `match-reports:CREATE` en ese encuentro. La captura de cédula
conserva las alternativas REFEREE efectivo / DATA_ENTRY de PDGLD-18. No se concede
lectura general de jugadores ni se sustituye el actor por un administrador.

Solo aparecen inscripciones de las dos plantillas y participaciones `AUTHORIZED`
para ese equipo/categoría de destino. Compartir club/temporada no incorpora al
jugador al DTO. Se reevalúan identidad, documentos, edad, afiliación, familia y
nivel consecutivo. Las sanciones se comprueban a la fecha del partido, con inicio
inclusivo y fin exclusivo. Elegir una mitad no elimina otro motivo de bloqueo.
Los mensajes de cruce no revelan nombres, dorsales ni detalles de otra cédula.

## Integración y transacción

`match-reports/server/service.ts` consume el evaluador común con el borrador y
reloj de la operación antes de escribir. El cliente no concede elegibilidad.
El `FOR UPDATE` del partido y versiones esperadas protegen su programación y
cédula. Un advisory lock transaccional por Persona serializa capturas de esa
persona en distintos partidos; se exige READ COMMITTED para releer tras esperar.
Se bloquean en modo compartido los otros partidos de la persona durante la
comprobación del cruce. Los locks se mantienen hasta commit/rollback. Un
interbloqueo o conflicto serializable aborta toda la captura; se pide reintentar.

Se guardan juntos borrador, reserva por mitad, marcas del reloj, alineaciones,
periodos relativos, versión y acuse idempotente, con auditoría existente. Una
versión obsoleta o bloqueo conserva la captura anterior. Reabrir la cédula usa el
mismo almacenamiento persistido. La proyección desde sustituciones mantiene los
minutos existentes; cerrar primera mitad solo completa una salida todavía vacía.

`recordParticipationInTransaction` sigue disponible para consumidores antiguos:
exige permisos, `FOR SHARE`, versiones y evaluación actual. Si la alineación tiene
reserva por mitad, rechaza `PARTICIPATION_USE_REPORT`: ese caso debe pasar por la
cédula y su reloj, sin una escritura paralela que eluda el contrato.

CLOSED no recalcula elegibilidad con nombres o reglas vigentes. La evidencia
histórica la presenta la cédula; no se rellenan marcas ausentes. Ni merge ni CI
sustituyen aceptación funcional de PDGLD-16.
