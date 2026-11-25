# PDGLD-132 — Primera transición de partido

Entrega parcial de PDGLD-132 y PDGLD-133, dentro de PDGLD-85. El servicio cubre
**BORRADOR → PROGRAMADO → CONFIRMADO → EN CURSO → SUSPENDIDO** y cancelación desde
los estados indicados en la matriz. La pantalla `/matches/recording` presenta las
acciones disponibles según los permisos del actor y el estado del partido.

## Estados del esquema

| Nombre de la historia | Código existente |
| --- | --- |
| BORRADOR | `DRAFT` |
| PROGRAMADO | `SCHEDULED` |
| CONFIRMADO | `CONFIRMED` |
| ENCURSO | `IN_PROGRESS` |
| FINALIZADO | `FINISHED` |
| ENREVISIÓN | `UNDER_REVIEW` |
| NO_PRESENTADO | `NO_SHOW` |
| SUSPENDIDO | `SUSPENDED` |
| CANCELADO | `CANCELED` |
| REPROGRAMADO | `RESCHEDULED` |
| NO_PROGRAMADO | `UNSCHEDULED` |
| RESUELTO_ADMINISTRATIVAMENTE | `ADMINISTRATIVELY_RESOLVED` |

## Matriz de esta entrega

| Origen | Destino | Autoridad | Condiciones y efectos |
| --- | --- | --- | --- |
| DRAFT | SCHEDULED | SCHEDULER con `scheduling:UPDATE` vigente en la liga del partido y fila en `match_status_transitions` | Partido no eliminado, temporada no cerrada, versión esperada, cancha/horario completos. Incrementa versión, agrega historial y activa reservas mediante triggers. |
| SCHEDULED | CONFIRMED | SCHEDULER con `scheduling:UPDATE` vigente en la liga y fila de transición | Además exige exactamente una designación MAIN aprobada de árbitro activo. Conserva reservas e historial. |
| CONFIRMED | IN_PROGRESS | DATA_ENTRY con `match-reports:UPDATE` vigente en la liga | Registra lo observado en el encuentro o informado por el árbitro. |
| IN_PROGRESS | SUSPENDED | DATA_ENTRY con los mismos controles | Requiere motivo; el catálogo actual libera reservas al suspender. |
| SCHEDULED, CONFIRMED o SUSPENDED | CANCELED | EXECUTIVE_PRESIDENT o SUPERADMIN con `scheduling:APPROVE` y ámbito de liga | Requiere motivo. Se bloquea si existe cédula o resultado, hasta integrar su revisión. |
| SUSPENDED | UNDER_REVIEW | Comisión disciplinaria con `discipline:APPROVE` en la liga | Requiere motivo; conserva liberadas las reservas, sin cambiar el resultado. |
| UNDER_REVIEW | CANCELED | Comisión disciplinaria con `discipline:APPROVE` en la liga | Conserva cédula y evidencias; se rechaza si existe resultado oficial. La decisión con marcador sigue pendiente. |
| SCHEDULED, CONFIRMED o RESCHEDULED | UNSCHEDULED | Programador autorizado de la liga | Sin cédula ni resultado y sin designación arbitral aprobada. Conserva el partido, limpia cancha y horario y libera reservas; después permite reprogramarlo. |
| Otros pares | — | Ninguna en este servicio genérico | Denegados; la presencia de un estado o una fila de matriz no demuestra que sus efectos estén implementados. Los servicios específicos de incomparecencia y reprogramación se describen abajo. |

## Estado de la integración revisado el 20 de noviembre

Esta matriz describe el código de la rama de trabajo, incluidos cambios locales aún sin commit. No acredita despliegue, CI remoto ni aceptación final de PDGLD-85 o PDGLD-132.

| Estado o efecto | Situación actual | Trabajo o dependencia pendiente |
| --- | --- | --- |
| Borrador, programado y confirmado | La programación aprobada crea partidos `SCHEDULED`; la confirmación operativa exige una designación principal aprobada. El borrador no habilita captura de cédula. | Completar la regresión integrada y evidencia del recorrido real. La publicación pública sigue separada. |
| En curso y suspendido | Se puede iniciar y suspender con autorización; suspender libera reservas. | Acordar e implementar qué resolución corresponde a un partido que ya comenzó. El flujo de reprogramación actual no mueve partidos `SUSPENDED` ni cédulas existentes. |
| En revisión | La comisión puede pasar `SUSPENDED` a `UNDER_REVIEW` y resolverlo cancelándolo sin borrar la cédula. Se bloquea la cancelación si existe un resultado. | Falta la resolución con marcador y la corrección de resultados existentes. |
| Reprogramado | Los partidos `SCHEDULED`, `CONFIRMED` o `RESCHEDULED` sin cédula ni resultado pueden reprogramarse; también el caso específico `NO_SHOW` con ambos equipos ausentes. Hay controles de reservas, autorización y versión. | La designación arbitral aprobada debe revocarse antes del movimiento. Quedan fuera incidentes con cédula existente y partidos suspendidos. La validación en la aplicación y CI remoto siguen pendientes. |
| No presentado, un equipo | Se registra la incidencia en cédula y se muestra un 1–0 propuesto; no es resultado oficial. Existe un adaptador interno de confirmación probado con efectos simulados. | Integrar la confirmación real de cédula con clasificación de PDGLD-29 y receptor de expedientes, en una sola transacción; no habilitarla solo por existir el adaptador. |
| No presentado, ambos equipos | Se registra la incidencia sin ganador; la comisión debe liberar la designación arbitral para poder reprogramar. | La corrección autorizada de una incidencia ya registrada aún no está disponible. |
| Finalizado | Existe protección de edición directa y un adaptador interno de cierre de cédula. La confirmación real permanece bloqueada en `getConfirmationEffects()`. | Conectar cierre, resultado, clasificación PDGLD-29 y expedientes en una transacción idempotente. La corrección autorizada posterior corresponde a PDGLD-21. |
| Cancelado | La autoridad puede cancelar desde programado, confirmado o suspendido si no existe cédula ni resultado; se conserva el historial. | La resolución o cancelación de un partido con evidencia requiere un procedimiento específico que no está habilitado. |
| No programado | El programador puede dejar pendiente un partido sin cédula ni resultado desde `SCHEDULED`, `CONFIRMED` o `RESCHEDULED`. Se quitan cancha y horario y se liberan reservas; después se puede reprogramar. Para una propuesta aprobada se registra un nuevo PDF que identifica el horario y la cancha pendientes. | Revocar antes cualquier designación arbitral aprobada. No se usa este flujo para partidos con cédula o ya iniciados. |
| Resuelto administrativamente | El código existe en el catálogo y hay una decisión funcional preliminar para la comisión. | Falta implementar la decisión oficial, su resultado o cancelación, permisos, auditoría y los efectos de clasificación y disciplina. PDGLD-27/28 continúan pendientes. |

### Acuerdos para cédulas y disciplina

- La **secretaría de la liga** autoriza la corrección de una cédula confirmada.
  La corrección deberá conservar el motivo, la autoridad y las versiones anterior
  y nueva, y recalcular en la misma transacción los efectos que correspondan.
  La tabla existente `match_report_corrections` no implementa por sí sola este
  procedimiento: faltan el servicio, los permisos, la pantalla y el adaptador
  de recálculo de clasificación de PDGLD-29. La edición directa continúa bloqueada.
- Las expulsiones directas, las expulsiones por segunda amarilla y los incidentes
  graves registrados como evento por el árbitro originan expediente; una amarilla
  aislada o las observaciones generales no lo originan. El expediente no impone
  sanciones automáticamente. `openIncidentCases` prepara esos expedientes dentro
  de la transacción y utiliza una referencia por evento para reintentos.
- Este receptor aún **no está conectado** a la confirmación oficial. Se probó en
  PostgreSQL 15 con el rol limitado Preview y RLS, reenvío y reversión; el plan
  Preview añade las columnas necesarias para insertar. Antes de habilitarlo faltan
  revisar los permisos y políticas del entorno de producción y probarlo en la
  misma transacción que el cierre y la clasificación de PDGLD-29. Tampoco
  resuelve el tratamiento de expedientes preexistentes al corregir una cédula;
  ese procedimiento debe preservar su historial y sus decisiones.
- **PDGLD-29 (Nick) pendiente:** integrar el recálculo de clasificación tanto
  al cierre como a las correcciones, con reversión completa si algún efecto falla.
  No habilitar ninguno de esos recorridos solo porque exista el receptor de expedientes.

En Jira, al 20 de noviembre PDGLD-18 figura como «Hecho», aunque su criterio de confirmación incluye resultado y clasificación en una sola transacción. El código de esta rama mantiene ese cierre bloqueado: contrastar esa diferencia con Víctor y la versión integrada antes de darlo por cumplido. PDGLD-29 figura «En desarrollo»; PDGLD-21, PDGLD-27 y PDGLD-28 figuran «Por hacer». Los estados de Jira no sustituyen la validación del código integrado.

La migración incorpora estas transiciones. No asigna usuarios, no añade
permisos RBAC, no concede bypass a SUPERADMIN y no restaura concesiones revocadas.
La misma asignación debe cubrir el permiso y el rol de transición. Se excluyen
asignaciones restringidas a un club: programar es una operación de liga.

El 12 de noviembre la persona responsable aceptó como base de trabajo la siguiente
matriz funcional. Esta aceptación no sustituye la coordinación con programación,
arbitraje y cédula prevista en la historia ni acredita una implementación:

| Acción | Autoridad propuesta | Condición |
| --- | --- | --- |
| Programar | Programador de liga | Cancha y horario válidos. |
| Confirmar | Autoridad de programación de liga | Requisitos operativos completos. |
| Iniciar y suspender | Capturista autorizado | Registra lo ocurrido durante el encuentro o con las notas del árbitro; motivo para suspender. |
| Cancelar | Autoridad de liga con permiso | Motivo e historial. |
| Reprogramar | Programador de liga | Motivo, nuevo horario y comprobación de conflictos. |
| Registrar no presentación | Árbitro en cédula; capturista registra | La cédula documenta el incidente y el resultado correspondiente; la autoridad revisa los incidentes disciplinarios. |
| Resolver administrativamente | Autoridad de liga expresamente autorizada | Decisión y motivo; efectos una sola vez. |
| Finalizar | Confirmación autorizada de cédula | Resultados una sola vez; impedir edición directa. |
| Pasar a revisión | Autoridad de liga expresamente autorizada | Motivo; no alterar resultados silenciosamente. |

La asignación técnica de los permisos de autoridad de liga y los contratos de
designación, cédula y efectos deportivos aún requieren integración. El catálogo
actual no concede al árbitro `scheduling:UPDATE`; no se debe interpretar el acuerdo
como una concesión global ni permitir transiciones sin validar la designación.
Quedan por integrar la resolución oficial de no presentación y la resolución
administrativa con marcador; la cancelación sin resultado ya está conectada. La finalización cuenta con
`finishConfirmedReportMatch(tx, context)` como adaptador interno: revalida permiso
y ámbito, exige cédula en borrador, resultado procedente de ella, partido en curso
y versión vigente, e inserta historial con la misma clave de operación. El servicio
genérico sigue denegando `FINISHED`. `getConfirmationEffects()` permanece bloqueado
hasta integrar clasificación y expedientes disciplinarios en la misma transacción.
FINALIZADO no se puede reabrir por esta entrada ni editar directamente en PostgreSQL;
una corrección necesita su autorización y servicio propios.

## Integración pendiente con cédula y programación

### Reprogramación de partidos operativos por imprevistos

La pantalla de registro ofrece reprogramación al programador autorizado de la liga para partidos individuales en `SCHEDULED`, `CONFIRMED` y `RESCHEDULED` que aún no tengan cédula ni resultado. Se puede cambiar cancha, fecha u hora futura dentro de la temporada, con motivo y versión; el mismo partido conserva su número e historial. Una designación arbitral aprobada debe revocarse antes de mover el partido y la nueva confirmación requiere designación vigente. No se modifican partidos en curso o finalizados desde este flujo.

El servidor revalida reglamento, autorización del club local, disponibilidad, descansos, sanciones y reservas de ambos equipos y de la cancha. PostgreSQL reemplaza las reservas dentro de la misma transacción y sus restricciones impiden cruces simultáneos. Cada cambio registra una versión y acuse idempotente. El caso existente de ambos equipos ausentes mantiene sus controles y evidencia propios.

Al aprobar una propuesta generada, la liga revalida el calendario y crea los partidos operativos y sus reservas en la misma transacción. Una propuesta pendiente no reserva recursos ni publica partidos. Las propuestas que ya estaban aprobadas antes de esta integración pueden activarse explícitamente por una autoridad con permiso de aprobación: se revalidan los horarios y se rechaza la activación si ya existen partidos asociados.

Después de cada reprogramación se registra una instantánea inmutable del calendario actualizado. La ventana de reprogramación ofrece su descarga como PDF; la versión 1 sigue siendo la propuesta original aprobada, y los cambios sucesivos producen versiones 2, 3 y posteriores. Las versiones guardan nombres, horario y cancha del momento del cambio. La descarga muestra la versión más reciente; no reemplaza el PDF original. Los permisos de consulta se verifican en el servidor.

### Revisión y resolución administrativa: decisión funcional

El 19 de noviembre se acordó que la comisión disciplinaria resuelve el partido
y puede establecer un marcador oficial o cancelarlo. La decisión debe conservar
autor, fecha y motivo; el servicio comprobará `discipline:APPROVE`, el rol
`DISCIPLINARY_BOARD` y el ámbito de la liga en la misma asignación. La resolución
con marcador debe integrarse con clasificación y cualquier efecto disciplinario
aplicable en la misma transacción, con control de versión y reenvío idempotente.
Una cancelación no debe borrar la cédula, la evidencia ni un resultado existente.

La comisión puede pasar un partido suspendido a revisión y resolverlo mediante cancelación
si todavía no existe un resultado. La operación conserva cédula y evidencias, exige
motivo y registra historial; no crea marcador ni actualiza clasificación. Si existe
resultado, se rechaza hasta contar con un proceso de corrección de sus efectos.
La decisión final con marcador aún no está implementada: el receptor de clasificación
y el flujo de expedientes todavía no están integrados.

### Registro de incomparecencia desde la cédula

En un partido CONFIRMED que aún no tiene alineaciones bloqueadas ni reloj,
el árbitro designado o DATA_ENTRY autorizado puede registrar la ausencia del
local, visitante o ambos, con observaciones. La operación guarda cédula y
transición a NO_SHOW con versión, autor, historial y acuse idempotente en la
misma transacción. El reenvío con la misma clave recupera el acuse. La cédula
queda en consulta; no acepta edición normal ni permite iniciar el reloj.

Si falta un equipo se muestra 1–0 propuesto a favor del presente. Si faltan
ambos se indica reprogramación pendiente y no se asigna ganador. En ambos casos
la incidencia aún no crea `match_results`, no confirma la cédula ni actualiza
clasificación o sanciones. Si faltan ambos, la comisión libera la designación
arbitral y el programador puede elegir fecha y cancha para el mismo partido;
se comprueban restricciones, se actualiza la reserva y se conserva la incidencia
anterior en su acuse inmutable y la modificación en auditoría. Registrar ambas
ausencias no mueve automáticamente el partido. La corrección de una
incidencia ya registrada requiere un procedimiento autorizado aún pendiente.

Para un solo equipo ausente existe un adaptador interno que exige al árbitro
designado y calcula el marcador reglamentario. Todavía no está conectado a la
confirmación de la pantalla: faltan los receptores reales de clasificación y
expedientes. Sus pruebas usan receptores simulados y no habilitan el cierre.

La migración `20261118010000_pdgld132_report_no_show` añade a la matriz el par
CONFIRMED → NO_SHOW para árbitro y capturista, sin conceder roles o permisos.
Se requieren revisión y planes de migración antes de aplicarla fuera de pruebas.

- **PDGLD-18, Víctor:** la entrada de confirmación ya tiene la interfaz de efectos;
  conectar el adaptador interno de cierre cuando también estén listos clasificación
  y expedientes. Integrar la resolución oficial de la no presentación. La confirmación debe
  coordinar todos los efectos en una transacción; `transitionMatch` no finaliza partidos.
- **PDGLD-21, Sergio:** implementar la corrección autorizada por secretaría, con
  versiones y efectos transaccionales, antes de admitir cambios posteriores a `FINISHED`.
- **PDGLD-24/25, Sergio y Karol:** la aprobación crea partidos y reservas; el servicio específico de
  reprogramación mueve sus reservas y registra la versión actualizada del PDF. `transitionMatch`
  no crea partidos ni cambia sus horarios. La publicación pública sigue siendo un proceso separado.
- **PDGLD-29, Nick:** acordar cómo la confirmación de cédula entrega resultados
  oficiales para actualizar la clasificación una sola vez.
- **PDGLD-26/27/28, Sergio:** coordinar el catálogo y la revisión disciplinaria
  de incidentes; el capturista no aplica sanciones automáticamente.

Para cada integración, compartir el identificador del partido, la versión esperada,
la clave de operación y el motivo cuando corresponda. Estos campos describen el
contrato existente de transiciones y son una propuesta para coordinar los nuevos
servicios, no una autorización para cambiar sus efectos sin acordarlos. Después de
integrar cada servicio, probar su transacción, reenvío, concurrencia, permisos y
recorrido en pantalla antes de cerrar PDGLD-85 y sus subtareas.

## Contrato interno

`transitionMatch(input)` obtiene la identidad mediante `requireOperationalUser`.
`transitionMatchInTransaction(tx, actorId, input)` es interno, para composición y
pruebas: no exponer `actorId` en una acción o endpoint. La Server Action
`transitionMatchAction` usa la entrada autenticada y convierte errores a códigos
seguros. El servidor vuelve a validar el ámbito y el permiso en cada envío.

```ts
{
  matchId: "UUID del partido",
  operationId: "UUID generado una sola vez por intención",
  expectedVersion: 1,
  toStatus: "SCHEDULED",
  reason: "Motivo operativo sin datos personales ni secretos"
}
```

El contrato estricto rechaza campos adicionales, actor/rol del cliente, motivos
vacíos o de más de 500 caracteres y versiones inválidas. El horario ya debe estar
guardado en el borrador por programación; esta transición no crea ni mueve partidos.
PostgreSQL verifica cancha activa de la liga, duración, holgura, disponibilidad y
conflictos con reservas de equipos/cancha mediante los controles de PDGLD-22.

El resultado contiene `operationId`, `matchId`, `toStatus`, `appliedVersion`,
`occurredAt` y `replayed`. **Es un acuse histórico, no una lectura del estado actual**.
Ante una respuesta incierta, la pantalla conserva la operación, versión, destino y
motivo mientras permanezca abierta. Permite ocultar y reabrir el diálogo y reintentar
exactamente la misma solicitud. Advierte al salir porque no persiste tras recargar.
El servidor vuelve a autorizar y devuelve el acuse si ya aplicó el cambio.
Para repetir tras una respuesta incierta, conservar exactamente la operación,
versión, destino y motivo. Un acuse anterior solo se devuelve después de comprobar
de nuevo los permisos vigentes. Un UUID reutilizado con otro contenido se rechaza.

## Atomicidad e historial

La transacción bloquea autorización/actor, temporada y partido, en ese orden.
El bloqueo del partido serializa reenvíos: una solicitud aplica y las demás
recuperan su acuse. Dos operaciones distintas sobre la misma versión producen un
éxito y un conflicto `STALE_MATCH`. Una temporada cerrada no admite nuevas escrituras.

Se usa el UUID del historial como clave de operación y se agrega `expected_version`
nullable; las filas antiguas permanecen intactas. Un índice único por partido y
versión protege contra reutilizar una versión. El trigger existente impide modificar
o borrar el historial. La auditoría de `matches` registra actor, motivo y correlación;
no se escribe una segunda auditoría desde TypeScript. Reservas, auditoría, versión e
historial pertenecen a la misma transacción: cualquier fallo revierte todo.

Los campos de número, notas, baja lógica y descansos no se modifican. No se modifica
el baseline ni se aplica la migración a la base habitual o a Supabase en esta entrega.

## Verificación

- `npm run test:match-transitions`: contrato, horarios, versión obsoleta, baja,
  temporada cerrada, denegación del resto de caminos y contenido de reenvío.
- `npm run test:match-transitions-db`: servicio real con Prisma/PostgreSQL, alcance
  de liga, reenvío concurrente, una sola auditoría/historial, reservas, rollback por
  traslape, concurrencia entre operaciones e historial inmutable, revocación.
- Ambos comandos se incorporan al workflow; la suite de base corre en PostgreSQL 15/17.

La suite de base **requiere una base desechable explícita**: localmente acepta solo
`127.0.0.1:55432/pdgld132`, sin parámetros de conexión; en GitHub Actions acepta la
base temporal `gestor_ligas_ci`. No usa `.env`. Aplicar todas las migraciones antes
de ejecutarla. Los fixtures son sintéticos y permanecen en esa base desechable.

Ejemplo PowerShell para una terminal con acceso a Docker (contraseña solo de prueba):

```powershell
docker run --name pdgld132-tests -e POSTGRES_PASSWORD=pdgld132_test_only -e POSTGRES_DB=pdgld132 -p 127.0.0.1:55432:5432 -d postgres:15
# Esperar a que pg_isready informe que acepta conexiones.
docker exec pdgld132-tests pg_isready -U postgres -d pdgld132
$env:DATABASE_URL = 'postgresql://postgres:pdgld132_test_only@127.0.0.1:55432/pdgld132'
$env:DIRECT_URL = $env:DATABASE_URL
$env:PDGLD132_TEST_DATABASE_URL = $env:DATABASE_URL
npx --no-install prisma migrate deploy
npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
npm run test:match-transitions-db
```

Usar una terminal dedicada para no reutilizar sus variables al iniciar la aplicación.
No sustituir el destino por una base compartida. La revisión humana, el resto de
transiciones y la evidencia funcional integral siguen pendientes antes de cerrar 132.
