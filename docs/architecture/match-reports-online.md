# PDGLD-147 · Captura online de cédula

## Estado de esta entrega

Hay consulta y guardado real de borrador, proyección relacional, firmas privadas,
control de versión y recuperación de acuses. **La confirmación oficial sigue
bloqueada**: no se presenta como terminada PDGLD-147 ni PDGLD-18.

La revisión inicial obtuvo `origin/develop` `3b2e99e`: PDGLD-16 (PR #53),
PDGLD-86 (PR #58) y PDGLD-26 (PR #59) están integrados. Se incorporó esa referencia
localmente, resolviendo package.json y navegación con los cambios de ambas ramas.
No se importaron ramas pendientes. No hay servicio de PDGLD-85, clasificación de
PDGLD-29 ni receptor de expedientes en esa referencia. PDGLD-26 es catálogo.
La navegación de cédulas y las tarjetas aprobadas muestran ahora partidos reales autorizados; sin designaciones se ofrece un estado vacío. Las rutas antiguas de demo redirigen a `/matches` y no aparecen en el menú.

El fetch final conservó `3b2e99e`; se revisaron los cambios locales y preparados contra esa referencia, sin conflictos pendientes ni pérdida de funcionalidades integradas. Se conservaron los ajustes locales aparecidos en el visor privado, ajenos a este ticket.

El árbol inicial estaba limpio sobre `96512ba`; se conservaron las vistas y sus
componentes. La incorporación local queda sin commit a la espera de revisión.

## Inventario y persistencia

| Modelo existente | Uso |
| --- | --- |
| `match_reports` | Una cédula por partido, versión, autor, estado y referencias de firmas. |
| `lineups` | Inscripción de origen, equipo del partido, capitán y dorsal independiente. |
| `player_period_participations` | Periodo, entrada y salida; minutos ausentes siguen ausentes. |
| `event_types` / `match_events` | Catálogo vigente del deporte y eventos del borrador. |
| `files` / `audit_logs` | Archivo privado verificado e intención durable de subida. |
| `match_report_syncs` | Clave única de operación, actor, versión base, contenido y acuse APPLIED. No es una cola offline. |
| `match_results` / `match_status_history` | Receptores oficiales: no se escriben mientras el cierre esté bloqueado. |
| `disciplinary_cases` | Existe estructura, pero falta el servicio receptor autorizado de incidentes. |

La primera migración de cédulas es `20261115010000_pdgld147_report_draft`: añade
`match_reports.draft_data` (JSON privado versionado con DTO/referencias, nunca
imágenes base64) e `lineups.is_starter`. El marcador provisional y las incidencias
viven en esa proyección; no son un resultado oficial en `match_results`.
No se modificaron migraciones aplicadas ni se crearon tablas paralelas.

En cada guardado se reemplazan las alineaciones, periodos y eventos del borrador
en una misma transacción, junto con la proyección, incremento de versión y acuse.
Las referencias oficiales impiden por FK borrar antecedentes relacionados; no
se fuerza su eliminación. El dorsal del partido no escribe el habitual. El
baseline vigente solo permite asignar el habitual cuando estaba vacío: no se
relajó su inmutabilidad ni se asumió un contrato futuro de cambio de dorsal.

## Autorización y reglas

- Páginas y handlers obtienen al actor con `requireOperationalUser` (NextAuth 4).
  Las entradas HTTP de escritura verifican origen y `X-Expected-Actor-Id` contra
  esa sesión, además de limitar el tamaño antes de interpretar JSON.
- `reportAccess` vuelve a verificar permiso CREATE/UPDATE, liga, temporada y
  partido. Un grant efectivo de DATA_ENTRY con ese ámbito no requiere designación
  arbitral. Para REFEREE se exige `assertOwnRefereeAssignment`, incluida la función
  `referee_assignment_effective` integrada por PDGLD-86. No se suplanta otra cuenta.
- Se conserva RF22. No hay concesión APPROVE de cédulas ni cambios a esa matriz.
  Los lectores con READ solo reciben evidencia de la captura, sin reconstruir
  elegibilidad histórica o una cédula inexistente.
- Se separó `evaluateAuthorizedMatchInTransaction` del control de designación de
  la entrada original de PDGLD-16. Ambos consumidores comparten evaluación de
  identidad, documentos, sanciones, destino y motivos. Las entradas previas siguen
  exigiendo la designación propia. Bloqueos globales: autorización, historia y
  partido; no se toma un actor del payload.
- La preparación de alineaciones permite **CONFIRMED**, con temporada abierta.
  En ese estado se rechazan eventos, tiempos, marcador y firmas. La captura del
  encuentro exige **IN_PROGRESS**. DRAFT, FINISHED y los otros estados no admiten
  escritura. Esta política de PDGLD-18 no agrega transiciones de partido.
- Se comprueban elegibilidad por destino, capitanes dentro de la alineación,
  dorsales no repetidos por equipo, periodos y orden de entrada/salida. No se
  autorizan coincidencias pendientes, reingresos ni duraciones inferidas.
- Los eventos deben estar en el catálogo del deporte. GOAL/CAUTION/SENDING_OFF/
  SUBSTITUTION/INJURY requieren equipo y jugador; el cambio requiere dos jugadores
  distintos alineados para ese equipo. Un incidente disciplinario requiere
  descripción. Minuto y periodo son opcionales. El marcador, si se indica, debe
  coincidir con los eventos GOAL de cada equipo. La UI recalcula el marcador al
  agregar, editar o quitar un gol; el servidor verifica la coincidencia. No se
  inventan reglas de autogol/default. Los nuevos códigos que necesiten semántica
  de marcador requieren acordar ese contrato, no deducirlo del nombre visible.

## Contrato y concurrencia

`features/match-reports/contract.ts` define el borrador serializable y el comando:
`formatVersion: 1`, `operationId`, `matchId`, `kind: save|confirm`,
`expectedMatchVersion`, `expectedReportVersion` y `draft`. Una cédula inexistente
usa versión base 0. El navegador nunca certifica elegibilidad ni permisos.

El acuse incluye operación, partido, ID y versión de cédula, versión de partido y
estado. Se registra en la misma transacción del guardado. Repetir la misma clave,
actor y contenido devuelve el mismo acuse; cambiar el contenido con esa clave
devuelve `OPERATION_KEY_REUSED`. Cada operación vuelve a autorizar al actor.

Una excepción revierte toda la escritura y el acuse. La versión del partido se
lee bajo bloqueo; una reprogramación concurrente no pasa como una captura vigente.
No se reintentan automáticamente transacciones fallidas con versiones inventadas.

`report-client.ts` conserva en memoria la intención, sus versiones, las claves de
subida y las referencias acusadas. Ante error de transporte mantiene el contenido
inmutable. Se consulta el acuse; UNKNOWN significa que aún no hay evidencia de
aplicación, no que se haya cancelado un envío. Un reenvío manual utiliza la misma
clave y contenido. Una captura distinta crea otra intención después de resolver
la anterior. No hay recuperación tras cerrar/recargar ni almacenamiento offline.

## Firmas y frontera con Storage

Endpoints propios de cédula, sin reutilizar URLs ni permisos de afiliaciones:

- `POST /api/match-reports/{matchId}/signatures`: PNG del dispositivo, borrador,
  capitán, equipo, versiones y clave estable de subida.
- `GET /api/match-reports/{matchId}/signatures/{fileId}`: solo un archivo vinculado
  a ese partido, con reautorización y comprobación SHA; respuesta privada no-store.

Se reutilizan la validación binaria genérica y el transporte privado. La firma
se vincula a equipo, capitán, contenido sin firmas y versiones de identidad de los
participantes. Cambiar contenido o identidad exige recapturar; otro partido no
puede apropiarse del archivo. Las versiones se comprueban de nuevo al vincular.

1. Una transacción autoriza y conserva intención inmutable en audit_logs con hash,
   ruta y metadatos, sin bytes de imagen ni credenciales.
2. Fuera de SQL, PUT sin sobrescritura y lectura para verificar tamaño/SHA/MIME.
3. Otra transacción reautoriza y registra `files`. Guardar cédula valida todas sus
   referencias antes de vincularlas a `match_reports`.

**ROLLBACK SQL no elimina un objeto externo.** Si cae el enlace, la intención y el
objeto quedan sin vincular. Reintentar la misma subida reutiliza su ruta y verifica
bytes. Una pérdida de permiso o versión conserva ese antecedente y bloquea el
enlace. No se ejecuta un borrado externo dentro de una transacción ni se elimina
automáticamente un objeto cuyo resultado sea incierto. La conciliación operativa
de objetos sin vincular debe contrastar intención, `files` y ambas referencias de
cédula antes de cualquier retirada; no hay un sweeper destructivo en esta entrega.

En el entorno normal se requiere `SUPABASE_REPORT_SIGNATURES_BUCKET=cedulas-firmas`
y el entorno de Storage ya documentado. El transporte verifica bucket privado,
límite de 10 MiB y allowlist PNG/JPEG/PDF existente; esta entrada admite solo PNG y
limita el JSON a 1.8 MB. No se creó ni configuró un bucket remoto ni se llamó a
Supabase compartido. El aprovisionamiento real del bucket queda a cargo del dueño
del entorno antes de probar allí la subida.

Para la revisión persistente en Docker habitual también puede fijarse
`REPORT_SIGNATURE_LOCAL_DIRECTORY` a un directorio privado fuera de `public`.
Solo se habilita en development y comprobando el destino PostgreSQL loopback,
puerto 5433 y base `gestor_ligas_dev`, sin parámetros que sustituyan el host.
No requiere activar globalmente AUTH_TEST_RUN. Se prueba con
`npm run test:match-report-storage`; en producción este ajuste no habilita el
adaptador local. La configuración local actual utiliza el directorio ignorado
`.codex-attachments/local-report-signatures`, no una URL pública.

## Contrato de confirmación — bloqueo explícito

`confirmation-effects.ts` propone tres receptores sobre **la misma TransactionClient**:

- `finishMatch`: validar transición y autoridad PDGLD-85; actualizar estado y
  versión, registrar actor/fecha/motivo en historial y devolver versión final.
- `updateStandings`: PDGLD-29, resultado oficial con reglas y desempates
  versionados; deduplicar por cédula/operación.
- `openIncidentCases`: abrir los expedientes necesarios desde los eventos, sin
  imponer sanciones ni elevar a DATA_ENTRY a autoridad disciplinaria.

Reciben actor real, partido, cédula, operación, versión esperada, marcador y IDs
de evento. Deben lanzar ante fallo y no hacer I/O externo. Es una **propuesta de
integración**, no un acuerdo ni un receptor ya implementado por otro ticket.

El único camino de confirmación es el comando `confirm` del servicio de cédulas:
reautoriza, comprueba versiones/elegibilidad/referencias, exige marcador y ambas
firmas, obtiene receptores y coordina resultado, transición, clasificación,
expedientes, cédula y acuse. `getConfirmationEffects()` devuelve actualmente
`CONFIRMATION_DEPENDENCIES_PENDING` (409) antes de escribir. Añadir una fila de
matriz no lo activa. No hay actualización aislada de matches como finalización.
Los permisos SQL de Preview tampoco permiten esos efectos aún no integrados.

La consulta autorizada publica `confirmation.available=false` y un mensaje para
la interfaz. El resumen deshabilita Confirmar y conserva Guardar borrador; no
abre una confirmación que el servidor ya sabe que no puede aplicar. Una respuesta
conocida de dependencias pendientes cierra el diálogo, libera el envío y oculta
el reintento de confirmación, conservando el contenido. Los fallos de transporte
sin respuesta siguen tratándose como inciertos con operación estable. La
disponibilidad no sustituye permisos y no habilita efectos por una bandera del
cliente. Se vuelve a calcular incluso al consultar una presentación histórica.

## Seguridad SQL y producción

El plan existente `scripts/preview/runtime-plan.mjs` añade SELECT de catálogo,
alineaciones, periodos y acuses; INSERT de captura; UPDATE solo de la proyección,
referencias y versión de cédula; DELETE solo de filas reemplazables del borrador.
Amplía las lecturas de nombre de estado y número de jornada. Conserva las políticas
del backend privado y la denegación al rol sobre resultados, clasificación,
transiciones e historial. No añade permisos de usuarios RF22 ni acceso al ledger
de Prisma. La suite ejecuta esas operaciones con el rol limitado, no como dueño.

La migración aditiva no crea tablas, modifica ACL ni cambia RLS. En producción se
conservan RLS/ACL de las tablas existentes y las columnas nuevas se incorporan al
plan privado de Preview solamente cuando el dueño ejecute mantenimiento. No se
desactivaron controles ni se añadió una excepción al guard de producción.

## Validación y prueba manual

Ver [casos y comandos de revisión](../validation/PDGLD-147-online.md).
No hay llamadas reales a CURP/INE, migraciones sobre Supabase compartido, commits,
push, publicación, merge de PR ni cambios de Jira en esta entrega.


## Ampliación del 15 de noviembre: campo, uniformes y acciones

Se leyó el avance del [PR #56](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/56)
en `d72de8a`, sin integrarlo. Su servicio pendiente no finaliza partidos y reserva
esa operación al coordinador transaccional de cédula. El contrato que ofrece
PDGLD-18 admite preparación en CONFIRMED y eventos en IN_PROGRESS. No escribe
`matches.status_id`, no inicia partidos ni agrega permisos a RF22. PDGLD-85 podrá
componer esta política al integrarse; los receptores de cierre siguen pendientes.

La segunda migración aditiva, `20261115020000_pdgld18_tactics_and_kits`, incorpora
`club_affiliations.uniform_kits` JSONB nullable y el evento INJURY de fútbol.
Conserva `uniform_colors` y todos los registros anteriores. No se editaron
migraciones aplicadas ni se crearon tablas o excepciones nuevas de elegibilidad.

El contrato de borrador v1 admite el campo opcional `tactics`, indexado por el UUID
del equipo inscrito. Cada entrada conserva `formation` (nullable si se desconoce),
once posiciones `{x,y,playerId|null}`, `kitSource` y los RGB del uniforme elegido.
Se valida forma, coordenadas y ausencia de duplicados; el servicio comprueba equipo,
convocatoria, titulares y secuencia. La omisión de `tactics` mantiene compatible el
contrato anterior; una distribución provisional no afirma una formación elegida.
Cambiar posiciones, uniforme o eventos invalida las firmas como cualquier captura.

Las quince opciones se tomaron de los nombres de [PFSA](https://thepfsa.co.uk/es/football-formations/),
consultada el 15 de noviembre de 2026: 4-4-2, 4-5-1, 4-3-3, 4-3-2-1, 4-1-3-2,
5-4-1, 4-1-2-1-2, 3-5-2, 5-3-2, 4-2-3-1, 3-4-3, 3-2-4-1, WM, 2-3-2-3 y 4-2-4.
WM se dibuja con líneas 3-2-2-3. Los diagramas y playeras son SVG propios. La opción
personalizada permite cambiar coordenadas con controles táctiles y de teclado,
sin depender de arrastrar. Este tablero está diseñado para fútbol once; no impone
un mínimo de titulares para guardar un borrador incompleto.

Se separan el once inicial y la proyección de jugadores actuales. Cambios y rojas
recalculan el campo conservando las asignaciones iniciales. Una roja deja vacante;
una lesión solo documenta el evento. No se infiere segunda amarilla, recuperación,
reingreso ni sanción. Con tiempos completos, los cambios se ordenan por periodo y
minuto; si faltan, se utiliza su orden de captura y se informa en pantalla. Los
conflictos de secuencia se rechazan incluso si un cliente omite `tactics`. Las
flechas del listado permiten corregir el orden cuando faltan tiempos. Los tiempos relacionales se proyectan desde
los tiempos manuales y eventos explícitos; el borrador conserva los manuales para
que quitar o editar eventos revierta su proyección sin residuos. Minutos ausentes
no se convierten en cero y nunca se inventa la duración de un periodo.

Los colores de local/visitante se capturan con `input type=color`, se validan como
RGB enteros 0..255 y se conservan en la afiliación de la temporada, compartida por
sus equipos. No se interpretan textos históricos. El uniforme del partido puede
usar uno de esos juegos o colores propios; se guarda una copia en `tactics`, por
lo que cambiar la afiliación no recolorea una cédula guardada. No se incorporan
paquetes de UI ni se modifica el dorsal habitual.

Las fotos se sirven por un handler nuevo, privado y autorizado por partido:
`GET /api/match-reports/{matchId}/players/{registrationId}/photo`. Reutiliza la
pertenencia al plantel de PDGLD-16, incluidas participaciones superiores autorizadas,
y solo usa documentos PHOTO VALIDATED, no reemplazados, con acuse de Storage de
la identidad vigente. Se validan pertenencia, clave, tamaño, hash y contenido;
se vuelve a autorizar después de la lectura externa. Nunca se entregan claves de
Storage, expedientes ni URLs públicas. No se necesita conceder players:READ al
árbitro. En consulta histórica se evita reconstruir una foto con evidencia actual;
si no está disponible se representa la playera. El adaptador de producción sigue
siendo el Storage privado existente de jugadores. La prueba positiva de bytes usa
un transporte inyectado y PNG sintético, no una llamada a Supabase.

Preview solo necesita añadir INSERT/UPDATE de `uniform_kits` a las columnas de
`club_affiliations` ya permitidas. Las lecturas de fotos usan tablas que el rol
limitado ya consulta. No se agregan escrituras de catálogo al rol, privilegios de
finalización, nuevas tablas, políticas permisivas ni cambios RLS. La migración de
producción conserva la seguridad vigente; su aplicación sigue el CD controlado.


## Contrato ampliado: sello de alineaciones y reloj

La revisión humana pidió guardar y bloquear el once inicial con Continuar y
capturar eventos desde el campo en vivo. `kind: lock-lineups` confirma esa intención
con la misma identidad, ámbito, estado, versión e idempotencia de las otras
operaciones. Su acuse APPLIED en `match_report_syncs` es la autoridad del bloqueo;
no se acepta una bandera del navegador ni se puede retirarlo cambiando draft_data.
El rol limitado solo inserta/lee esos acuses, sin UPDATE/DELETE. El sello compara
una representación canónica (incluido el reordenamiento JSONB) de convocados,
titulares, capitanes, dorsales y tácticas. Excluye tiempos, eventos y firmas.
Las cédulas anteriores no se bloquean automáticamente ni se sustituyen sus datos.

`tactics` admite `customFormation` y `keeperKit`. El RGB del portero pertenece al
partido, no a la afiliación. No se necesitan columnas o tablas nuevas para ellos.
`kind: clock` exige sello y `clockAction`: start, add-time, end-half, set-break o
start-second. El reloj se guarda como metadato autorizado por el servidor en el
JSON existente; no forma parte del draft editable enviado por el cliente. El
acuse devuelve clock y lineupsLock. Un reintento conserva todos los identificadores,
versiones, intención y valores: nunca reinicia el reloj para recuperar una respuesta.

La función interna `matches/server/report-start.ts` ofrece a PDGLD-85 el inicio
CONFIRMED → IN_PROGRESS. Revalida match-reports:UPDATE, el actor real y su ámbito,
DATA_ENTRY autorizado o árbitro con designación propia efectiva. El llamador
bloquea autorización/temporada/partido. Inicio, incremento de versión, historial
(con operationId), reloj, cédula y acuse se escriben en una sola transacción.
En IN_PROGRESS solo inicia el reloj sin duplicar transición ni historial. No se
incorpora el PR #56 ni se agregan concesiones APPROVE o filas de transición.
Su futura integración debe conservar esta composición y evitar dos servicios
independientes que escriban el mismo inicio. El cierre oficial sigue bloqueado.

Preview recibe únicamente UPDATE(status_id, version) de matches e INSERT de las
columnas usadas del historial, además de SELECT del historial. No recibe escritura
sobre reservas ni sobre resultados/clasificación. La prueba mostró un fallo del
trigger con el rol limitado: la migración aditiva
`20261115030000_pdgld18_reservation_trigger` fija sync_match_reservations como
SECURITY DEFINER del propietario con search_path cerrado y sin ejecución PUBLIC.
El cuerpo y sus comprobaciones permanecen intactos; la aplicación no puede invocar
el trigger como una API de escritura. Es el mismo contrato de reservas derivadas
que deberá respetar PDGLD-85. Docker conserva su decisión de RLS; la prueba
desechable se ejecuta con RLS y el rol Preview. No se aplican cambios remotos.

El reloj es operacional: base por tiempo y descanso en minutos, compensación
explícita, ancla de fase y fin guardados. Las decisiones de terminar/iniciar fase
requieren confirmación del operador; los avisos se presentan mientras la página
está abierta. No se afirma ejecución de notificaciones en segundo plano. No se
finaliza matches al terminar el segundo periodo. La confirmación oficial, cuando
se conecten sus receptores, deberá exigir reloj terminado si se utilizó.


### Segunda amarilla y relevo de capitán

Por indicación del usuario, la segunda CAUTION del mismo jugador/equipo implica
expulsión por segunda amarilla: se conserva cada tarjeta original, se deriva una
sola expulsión (sin fabricar otra operación o roja directa), se retira al jugador,
se deja vacante su posición y se cierra la participación en el minuto conocido.
No permite sustitución ni reingreso. La marca roja y el motivo quedan en historial
y consulta del jugador. El contrato del receptor de disciplina recibe también
`dismissals` con evento causante y razón SECOND_CAUTION/DIRECT_RED; sigue sin
implementarse el cierre oficial ni imponerse sanciones automáticamente.

Cuando el capitán sale por cambio o expulsión, el evento exige
`replacementCaptainId`, elegido entre quienes quedan en cancha (puede ser el
entrante). El servidor valida pertenencia y la secuencia completa. El capitán
inicial no cambia ni se desbloquea la alineación: el relevo queda en el JSON
serializable del evento, y se deriva el capitán vigente para la marca C y la firma
final. Cambiar el evento invalida las firmas anteriores por su vinculación al
contenido. Los eventos y firmas existentes no se modifican silenciosamente.
Si la salida del capitán se capturó antes de esta revisión sin indicar relevo,
se debe editar ese cambio/expulsión para elegirlo antes de continuar guardando.

Prueba manual: sustituir al capitán, elegir entrante y comprobar que no se puede
aplicar sin nuevo capitán; elegir a un jugador que permanezca y verificar C y firma.
Registrar dos amarillas a otro jugador: tras la primera permanece, tras la segunda
sale, deja vacante y no aparece en el selector de entrantes. Reintentar la misma
operación conserva sus eventos originales y no duplica una roja derivada.


### Precisión y marcas acumuladas

Los eventos admiten `second` opcional 0..59, solo con minuto indicado. La migración
aditiva `20261115040000_pdgld18_event_seconds` añade match_events.second nullable;
no completa los históricos con 00. Preview solo incorpora esa columna a INSERT.
En vivo se propone minuto/segundo del mismo instante del reloj, conservado en la
operación para reintentos. La captura posterior permite ambos valores y la consulta
muestra MM:SS; los segundos históricos ausentes se indican como desconocidos.
La proyección SQL es parametrizada y guarda la precisión junto con el evento.
La participación por periodos conserva su contrato de minutos, sin inventar tiempos
más precisos ni totales jugados. Con precisión completa, los eventos se ordenan
por periodo, minuto y segundo; si faltan segundos, se conserva el orden dentro del
minuto en vez de asumir 00.

Se muestra un balón por cada GOAL y una tarjeta por cada CAUTION, con roja tras la
segunda amarilla. Los iconos se apilan verticalmente con desplazamiento del 50%:
cada uno cubre la mitad del anterior. Se conservan nombres accesibles por icono y
las marcas aparecen en campo, modal e historial del retirado. La segunda amarilla
sigue retirando al jugador; la pila no lo mantiene indebidamente en cancha.

Prueba: registrar dos goles del mismo jugador, uno en 22:34; comprobar dos balones
solapados y la hora del evento al consultar/recargar. Registrar dos amarillas a otro
jugador: en el historial deben verse dos amarillas y una roja apiladas; el jugador
ya no debe estar en cancha ni disponible para entrar de cambio.

### Referencia temporal y descanso

Los eventos nuevos capturados con reloj conservan `minute`/`second` como tiempo
del partido y añaden `periodMinute` opcional, relativo al periodo. Este último
vive en el borrador serializable existente, se usa para ordenar y proyectar
participación, y no necesita otra columna SQL. La proyección de match_events
conserva el minuto del partido; player_period_participations conserva el minuto
relativo. Los eventos previos sin `periodMinute` mantienen su interpretación
anterior. No se modifica ningún histórico al abrir o reanudar la cédula.

El servicio usa la fase persistida y compara los eventos contra el borrador
vigente. En BREAK rechaza altas o modificaciones de eventos distintos de
SUBSTITUTION y exige P2, minuto `halfMinutes`, segundo 0 y `periodMinute` 0 para
los cambios. Los antecedentes sin modificar y los reintentos con el mismo
identificador conservan su contenido y su acuse. La compensación y la duración
del descanso no desplazan el inicio nominal del segundo tiempo.
