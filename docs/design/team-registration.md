# Inscripción y consulta de equipos — PDGLD-63

## Fuente del contrato y dependencia de integración

Revisado el 26/10/2026: `origin/develop` sigue en `b99730c`. El contrato confirmado
está publicado en [PR #31](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/31),
rama `fix/PDGLD-62-PDGLD-64-integracion-inscripcion`, revisión `9eb5373`.
La interfaz de esta entrega lo consume sin copiar ni modificar su backend.
El backend local de esta rama todavía usa el contrato anterior: **el recorrido
real requiere integrar primero PR #31**. No se acredita integración por pasar
pruebas con respuestas simuladas. Se mantiene el PR de interfaz como Draft.

Fuentes leídas en esa revisión: `docs/architecture/team-enrollment.md`,
`team-enrollment.ts`, `server/team-enrollment-queries.ts`,
`server/team-enrollment-operations.ts`, `server/team-enrollment-access.ts` y los
handlers de alta, consulta de operación y cancelación. Ante discrepancia entre
prosa histórica y código, los DTO y handlers de esa revisión son la referencia.

## Presentación y navegación

`/access` enlaza `/teams/registrations` con el `ActionLink` existente. La página
exige sesión operativa y cambio de contraseña completado. La UI no autoriza por
nombre de rol: cada endpoint mantiene identidad y permisos del servidor.

`TeamRegistrationForm` y su controlador usan opciones de presentación separadas
del DTO HTTP. Cambiar club/temporada limpia dependientes; cambiar equipo/modo
limpia categoría/grupo, y cambiar categoría limpia el grupo. Validan presencia y
pertenencia a las opciones recibidas, nombre nuevo recortado de 1–200 caracteres
y bloquean doble envío. No duplican reglas de elegibilidad del servidor.

El listado conserva `teams.id` y `season_teams.id`, varios equipos en una temporada
y varias temporadas del mismo equipo. Presenta `REGISTERED` como Inscrito,
`ACTIVE` como Activo y `WITHDRAWN` como Retirado; no cambia estados. El alta solo
se confirma inicialmente en REGISTERED. Una recuperación presenta el estado
vigente del servidor. No se implementa la transición a ACTIVE.

## Opciones y capacidades

`GET /api/team-enrollments/options[?clubId=…&seasonId=…]` devuelve:

- `clubs`: `{id,name,leagueId}`.
- `capabilities`: `{clubId: UUID|null, canEnroll: boolean, canCreateTeam: boolean}`.
- `teams`: `{id,clubId,name,referenceNumber,enrolledSeasonIds}`.
- `seasons`: `{id,name,status}`; en opciones de inscripción excluye CLOSED.
- `categories`: `{id,seasonCategoryId,seasonId,name}`.
- `groups`: `{id,name,categoryId,seasonId}`.
- `nextClubAfter`, `nextSeasonAfter`, `nextTeamAfter`: UUID o null.

El adaptador solo habilita inscripción si `capabilities.clubId` coincide con el
club seleccionado y `canEnroll=true`; crear requiere además `canCreateTeam=true`.
Capacidad ausente, de otro club o false no habilita escritura. Durante la carga se
bloquean los controles. Respuestas anteriores no reemplazan el nuevo contexto.
No se infiere autorización de rol ni de CREATE. Con READ sin CREATE se permite
consultar/cancelar un pendiente propio; no reintentar el alta.

Se excluyen equipos con la temporada elegida en `enrolledSeasonIds`. El grupo
pertenece a la categoría/temporada recibida. El servidor vuelve a comprobar todo.
Las capacidades indican permiso; no sustituyen afiliación aprobada, categoría
autorizada ni temporada abierta. Se muestran vacíos de equipos/categorías/grupos.

## Consulta y catálogos

Los filtros usan `GET /api/team-enrollments/catalogs[?clubId=…&seasonId=…]`, que
exige READ e incluye temporadas cerradas o sin afiliación. Devuelve la misma forma
que opciones, con teams/categories/groups vacíos. La UI usa selectores de nombres,
sin campos manuales de UUID ni administración de catálogos.

Opciones y catálogos admiten `clubAfter`, `seasonAfter`, `teamAfter` y `limit`.
El adaptador recorre cada cursor de su colección y conserva IDs únicos. Cursores
repetidos o cambios de capacidades entre páginas invalidan la lectura. Todas las
páginas comparten la cancelación y la comprobación de identidad; no se publica un
catálogo parcial como definitivo.

`GET /api/team-enrollments?clubId=…[&seasonId=…&after=…]` devuelve `{items,nextAfter}`.
Cada registro contiene id de inscripción, teamId, teamName, teamReferenceNumber,
clubId, seasonId, **seasonName**, categoryId/categoryName, groupId/groupName y status.
El nombre histórico viene directamente del listado, no de opciones vigentes ni de
un UUID inventado como etiqueta. Un DTO sin seasonName es inválido. «Todas las
temporadas» conserva historial. La lista pagina con «Cargar más inscripciones».
Un listado vacío nunca resuelve una operación incierta.

## Envío, consulta de resultado y cancelación

El JSON de `POST /api/team-enrollments` contiene exactamente enrollmentKey,
clubId, seasonId, categoryId (no seasonCategoryId), groupId y una modalidad:
`team:{mode:"existing",teamId}` o `team:{mode:"new",name}`. No envía estado,
actor en el cuerpo, aprobador ni folio. Usa el esquema compartido ya existente.

Antes de enviar, se conserva el cuerpo normalizado y una única clave UUID en
`sessionStorage`, por usuario y pestaña. Esta pantalla mantiene una sola intención
pendiente a la vez por identidad/pestaña; no sobrescribe otra intención incierta.
Cerrar o descartar la vista solo la oculta. Retomar y recargar comprueban identidad,
opciones y listado autorizados antes de restaurarla bloqueada. No hacen POST ni
cancelación automática. Cerrar la pestaña o borrar almacenamiento puede perder su
copia local; nunca equivale a cancelar en servidor. No contiene credenciales,
firmas, documentos ni datos de personas y no se imprime en logs.

201 con recibo válido, replayed=false y REGISTERED confirma alta; 200 con
replayed=true confirma recuperación. Se validan todos los vínculos contra el cuerpo
y el teamId si es existente. Red incierta, respuesta ilegible o rechazo HTTP
mantienen cuerpo/clave y bloqueo: solo un resultado definitivo los resuelve.
Incluso 400/409/413 del POST real conservan el pendiente para consulta/cancelación;
el callback corregible queda para presentación/preview, no elimina incertidumbre
real. «Recuperar resultado con el mismo envío» es un POST explícito y no genera
otra clave; requiere capacidad vigente de inscripción.

`GET /api/team-enrollments/operations/{key}?clubId=…` **no escribe**. Devuelve
`{enrollmentKey,clubId,outcome,enrollment}`:

- `UNRESOLVED` exige enrollment=null: conserva cuerpo, clave y bloqueo.
- `CONFIRMED` contiene el recibo con replayed=true: muestra la inscripción vigente.
- `CANCELLED` exige enrollment=null: confirma que la clave quedó cancelada.

`POST /api/team-enrollments/operations/{key}/cancel` recibe **el cuerpo original
completo**, incluida la misma clave. Aunque el servidor también admite una
referencia mínima, la UI conserva y usa la captura íntegra. Devuelve 200 con el
mismo DTO: CANCELLED si la cancelación ganó o CONFIRMED si ya ganó la inscripción.
Nunca elimina ni retira una inscripción confirmada. La cancelación requiere
confirmación explícita en diálogo y queda separada de «Cerrar formulario».

Solo CONFIRMED/CANCELLED válidos permiten limpiar el pendiente. Un 404, un listado
vacío, código OPERATION_CANCELLED sin acuse, resultado desconocido, club/clave
incoherentes o fallo de red no lo resuelven. Si la limpieza local falla, se muestra
el resultado definitivo con aviso y se bloquea otra inscripción; una nueva consulta
permite repetir la limpieza. No se cambia la clave para sortear el bloqueo.

Las marcas `:discarded` de versiones anteriores sin cuerpo se conservan bloqueadas;
no se reconstruye una captura perdida ni se inventa el club al que pertenece.

## Identidad, header y respuestas tardías

En PR #31, POST de alta, GET de operación y POST de cancelación leen
`x-expected-actor-id` y llaman a `assertEnrollmentActor`. El header es **opcional en
el servidor**, pero si está presente debe coincidir con la sesión; una diferencia
da 403 FORBIDDEN. No sustituye autenticación ni permite elegir actor. Opciones,
catálogos y listado no leen esa precondición en los handlers revisados.

La interfaz envía `X-Expected-Actor-Id` con el ID de sesión recibido por la página en
las tres operaciones, y también en lecturas de equipo como contexto conservador
(no se atribuye una garantía atómica nueva a esos GET). Antes de cada solicitud
comprueba `/api/auth/session` y que la identidad siga siendo la propietaria.

El límite React `key={userId}` desmonta el controlador anterior al cambiar usuario.
Cancelar lecturas, invalidar versiones y comprobar actividad tras cada await evita
mostrar respuestas viejas o eliminar el pendiente de la identidad anterior.
401/403 ocultan captura/opciones/listado y bloquean hasta comprobar de nuevo
identidad y acceso. Las operaciones usan el alcance READ del servidor para permitir
resolver después de retirar CREATE. Un POST que ya llegó puede finalizar: desmontar
la vista no supone rollback ni cancelación persistente.

## Errores y accesibilidad

Se usan mensajes locales seguros para `{code}`: UNAUTHENTICATED,
PASSWORD_CHANGE_REQUIRED, FORBIDDEN, INVALID_ORIGIN, INVALID_PAYLOAD,
VALIDATION_ERROR, INVALID_CONTEXT, AFFILIATION_NOT_APPROVED,
CATEGORY_NOT_AUTHORIZED, SEASON_CLOSED, TEAM_ALREADY_ENROLLED,
IDEMPOTENCY_CONFLICT, PAYLOAD_TOO_LARGE y OPERATION_CANCELLED. Los demás y 503 se
presentan como falta de confirmación. No se muestran mensajes arbitrarios de red.

Errores por campo se asocian con aria-describedby y reciben foco tras renderizar.
Avisos de resultado son enfocables; la consulta explícita enfoca su resumen/error.
Carga y operación pendiente usan role=status, aria-busy y controles deshabilitados.
Ambos diálogos son modales nativos con nombre/descripción, fondo inerte, foco
inicial en continuar y retorno al disparador al cancelar/Escape. Tras la operación
se enfoca el resultado y no se comunica estado solo por color.

## Preview y pruebas

`/dev/team-registration` solo existe en development, con notFound antes de cargar
la vista fuera de ese entorno. Los datos sintéticos viven en preview/pruebas;
la página real no los importa. La preview nunca confirma persistencia ni llama
al backend. El monitor SessionActivity omite solo esa ruta exacta en desarrollo;
la lectura CSRF comparte la cancelación del efecto. Se conserva su prueba simulada.

- `npm run test:team-registration`: formulario, lista, adaptador/controladores y
  monitor, con red/almacenamiento simulados o renderizado estático, sin base.
- `npm run test:team-registration-browser`: React DOM y Chrome reales con negocio
  simulado; foco, modal, consulta UNRESOLVED, cancelación CANCELLED, cierre,
  aislamiento y respuestas tardías. No arranca Next ni login/base reales. El evento
  cancel se despacha en DOM; no acredita lector de pantalla o pulsación física.
- `npm run typecheck` y `npm run lint`.

El workflow contiene las suites de interfaz en el job Aplicación; no equivale a
CI remoto aprobado. La suite HTTP de backend no valida esta página por navegador.
Ver [procedimiento integrado](../validation/PDGLD-63-recorrido-integrado.md), preparado
sin ejecutar escrituras. Revisión de otra persona y evidencia integrada siguen
pendientes; cerrar subtarea o hacer merge no cierra automáticamente PDGLD-12.

Validación local de esta adaptación (26/10/2026): 72 pruebas sin base aprobadas
(19 formulario, 5 lista, 43 adaptador/controlador, 5 monitor), 1 recorrido Chrome
con negocio simulado aprobado, typecheck y lint sin advertencias. No se ejecutó
el procedimiento integrado ni se modificó backend, dependencias, base o .env.
CI remoto e integración con PR #31 siguen pendientes.
