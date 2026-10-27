# Inscripción y consulta de equipos — PDGLD-63

Lista y formulario con modelos de presentación separados de HTTP. La integración
real se describe al final de este documento. Los datos sintéticos permanecen
exclusivamente en pruebas y en la preview de desarrollo descrita abajo.

## Requisitos confirmados de PDGLD-12

- Un club puede inscribir varios equipos en la misma temporada.
- Cada inscripción debe tener categoría y grupo válidos.
- Un equipo pertenece a un solo grupo por temporada.
- La inscripción comienza como INSCRITO, sin activación automática.
- Se conserva el historial de inscripciones de temporadas anteriores.
- La autorización se comprueba en servidor por permiso y contexto.

Son requisitos de la historia padre aportados por el equipo; no implican que todo
el backend esté implementado. Las reglas de inscripción y sus restricciones
corresponden a PDGLD-62 (Víctor). Las vistas corresponden a PDGLD-63.

## Modelos y restricciones existentes

Fuente: `prisma/schema.prisma` y el SQL de `prisma/migrations/0_init/migration.sql`.
Este análisis no ejecuta migraciones ni comprueba una base en vivo.

| Modelo | Relaciones y garantías existentes |
| --- | --- |
| `teams` | Identidad permanente del equipo: UUID, club, nombre y referencia única. Permite varios equipos por club. `UNIQUE(id, club_id)` respalda la relación compuesta desde la inscripción. |
| `season_teams` | Inscripción con UUID propio, equipo, club, temporada, grupo y estado. `UNIQUE(team_id, season_id)` impide dos inscripciones/grupos del mismo equipo en una temporada. No hay unicidad club/temporada: admite varios equipos. |
| `club_affiliations` | Única por club/temporada; la inscripción referencia esa pareja. La FK exige existencia, no estado de aprobación. |
| `groups` | Pertenece a `season_categories` mediante `(season_category_id, season_id)`. La inscripción referencia `(group_id, season_id)`, evitando grupos de otra temporada. |
| `season_categories` | Relaciona temporada, categoría y reglamento. Única por `(season_id, category_id)`. La categoría de una inscripción se obtiene a través del grupo. |
| `categories` | Catálogo por liga y deporte, con nombre único por liga/deporte. |
| `club_affiliation_categories` | Categorías solicitadas en una afiliación; no son equipos inscritos ni prueba de afiliación aprobada. |

Las claves compuestas también garantizan equipo/club y afiliación club/temporada.
No sustituyen la validación de liga/deporte, elegibilidad ni del estado exigido de
la afiliación. El backend debe verificar las relaciones pertinentes.

El CHECK SQL de `season_teams.status` admite exactamente `REGISTERED`, `ACTIVE` y
`WITHDRAWN`, con default `REGISTERED`. La interfaz traduce esos valores a
«Inscrito», «Activo» y «Retirado». Mostrar estados existentes no autoriza ni añade
transiciones. Inscribir no significa activar.

El mismo `teams.id` puede tener distintos `season_teams.id` en temporadas
diferentes. El modelo preserva esa separación y la lista no agrupa ni descarta
inscripciones por identidad del equipo. El baseline incluye el trigger
`season_read_only` sobre `season_teams`, que protege temporadas cerradas con su
mecanismo específico de correcciones autorizadas; no se modifica en este ticket.

## Responsabilidades

**PDGLD-62 — Víctor:** definir contratos de consultas/inscripción y opciones
filtradas; obtener identidad del servidor; validar permisos, alcance, relaciones y
reglas; garantizar atomicidad y concurrencia; traducir conflictos de restricciones;
conservar historial y estado inicial REGISTERED. Según la propuesta recibida, un
equipo nuevo y su inscripción se crearán en una única transacción de PDGLD-62.
Las respuestas deben exponer solo los datos necesarios.

El catálogo agrupa clubes y equipos en `clubs`: existen las acciones CREATE y READ.
PDGLD-62 ya exige CREATE/READ de la misma asignación de delegado para opciones
y CREATE para el alta, sin crear `teams:REGISTER` ni inferir capacidades en UI. El motor consulta
concesiones y asignaciones vigentes. `teamId` en el motor significa `teams.id`, no
`season_teams.id`; autorizar equipo+temporada presupone una inscripción existente,
por lo que Víctor debe elegir el contexto adecuado para el alta.

**PDGLD-63 — interfaz:** presentar inscripciones y estados, conservar identidades y
temporadas, y capturar con opciones del servidor,
validación de campos, bloqueo de envíos duplicados y tratamiento de errores. No
duplicar reglas de negocio ni decisiones de autorización en el navegador.

Esta entrega implementa `TeamRegistrationList`, `TeamRegistrationForm` y sus
modelos/controlador de presentación. No contiene botones de activación, baja o
edición. El adaptador HTTP se detalla en la actualización de integración.

## Presentación implementada

`team-registration-model.ts` define `TeamRegistrationItem` con `teamId`,
`seasonTeamId`, nombres de equipo/temporada/categoría/grupo y el estado existente.
Los campos sirven a la vista; **no son un DTO ni contrato HTTP confirmado**. El
adaptador mapea la respuesta real y valida su contenido.

La lista recibe una colección de inscripciones ya seleccionadas y autorizadas por
quien la integre. Cada elemento conserva sus identificadores de equipo e
inscripción con etiquetas diferentes. No consulta, filtra, deduplica ni autoriza.
El vacío se refiere a la consulta seleccionada, no a la inexistencia global de
equipos. Usa lista y pares etiqueta/valor; tarjetas en móvil y columnas adaptables
en pantallas mayores, con salto de línea para nombres e identificadores largos.
Reutiliza los tokens existentes `surface`, `border`, `primary`, `muted` y `soft` y
los patrones de tarjetas y espaciado del proyecto. Los estados tienen texto y no
se comunican solo mediante color. No se introduce un control genérico innecesario.

## Contrato recibido de PDGLD-62

Las rutas y cuerpos ya están integrados en develop y se describen en
`docs/architecture/team-enrollment.md`. La actualización de integración al final
especifica su adaptación a presentación y distingue los bloqueos que permanecen.

## Formulario presentacional

`TeamRegistrationForm` recibe `TeamRegistrationFormOptions` y un callback async
`onSubmit`. Las opciones agrupan clubes, sus temporadas, equipos disponibles,
categorías y grupos. `canCreateTeam` es una capacidad de presentación por
club/temporada proporcionada por quien integre la vista con el servidor. No se
infiere del rol ni reemplaza la autorización del backend. Estos modelos anidados
son internos de UI, no el formato supuesto de GET `/options`.

Cambiar club limpia temporada, modo, equipo/nombre, categoría y grupo. Cambiar
temporada limpia todos sus dependientes. Cambiar modo o equipo limpia categoría
y grupo; cambiar categoría limpia el grupo. Actualizar las opciones elimina IDs
que ya no están disponibles y retira el modo nuevo si desaparece su capacidad.
Un grupo ajeno a la categoría/temporada nunca se conserva ni se entrega al callback.
El nombre solo se muestra y se requiere en modo nuevo; se descarta en modo existente.

La validación comprueba pertenencia a las opciones recibidas y nombre no vacío;
no decide reglas de elegibilidad, duplicados ni autorización. Cada error está
asociado a su campo y el envío inválido intenta enfocar el primero. Mientras el
callback está pendiente se bloquean cambios y envíos concurrentes, tanto en los
controles como en el controlador. El callback recibe una captura discriminada:
identificadores de ámbito/categoría/grupo y `team` existente por ID o nuevo por
nombre recortado. **No es el JSON HTTP**: no incluye estado ni activa el equipo.
El adaptador mapea esa captura al contrato confirmado.

El callback devuelve un resultado **tipado interno**, independiente del
DTO HTTP:

- `confirmed`: el integrador confirma persistencia con `teamId`, `seasonTeamId` y
  `status` vigente. El alta exige REGISTERED; recuperar con `replayed: true` puede
  devolver ACTIVE/WITHDRAWN, que solo se presentan. La identidad de equipo existente
  debe coincidir.
- `correctable`: rechazo confirmado **sin creación**, con errores por campo
  opcionales. Conserva la captura y permite corregir y volver a enviar.
- `unconfirmed`: se desconoce el resultado. También se usa ante una excepción,
  respuesta ausente o confirmación incompleta/incompatible del callback.

Un resultado incierto bloquea nuevos envíos **y cambios de captura**; conserva los
valores y pide verificar la inscripción antes de reenviar. Cambiar opciones o el
callback no elimina ese bloqueo. La integración permite recuperar explícitamente
el mismo envío con la clave conservada; no permite desbloquear ni cambiar la
captura por un refresco. PDGLD-62 sigue siendo responsable de la idempotencia. Una confirmación explícita también bloquea repetir esa inscripción en
la instancia actual. No hay activación automática.

El botón se deshabilita cuando faltan opciones indispensables de club/temporada,
equipo existente en ese modo, categorías o grupos. Se muestran avisos específicos
si no hay temporadas, categorías, equipos existentes o grupos. Una categoría sin
grupos no permite enviar aunque otra sí los tenga. «Crear equipo» permanece
seleccionable si la capacidad lo permite, incluso sin equipos existentes; el modo
nuevo no exige un equipo previo, pero sí categoría y grupo disponibles. La validación
del controlador también impide invocar el callback con selecciones incompletas.

El adaptador trata errores HTTP, confirmación de persistencia y actualización de
lista conforme a PDGLD-62. El resultado interno no sustituye los DTO HTTP ni presume
que todo callback resuelto equivale a una escritura confirmada.

## Verificación

`npm run test:team-registration-list` usa `node:test` y
`renderToStaticMarkup`, siguiendo los patrones existentes. Comprueba campos e
identidades, vacío, varias inscripciones del mismo equipo entre temporadas,
varios equipos en una temporada y traducción de los tres estados sin acciones.
`npm run test:team-registration-form` comprueba dependencias de selectores, ambos
modos, capacidad recibida/revocada, validación, falta de opciones, errores
corregibles y bloqueo persistente de resultados inciertos con el mismo
controlador de la vista y renderizado estático. No son clics DOM ni pruebas de
foco real en navegador.

Los fixtures de pruebas se declaran en `team-registration-*.test.tsx`; las opciones
sintéticas de preview viven en su componente exclusivo. Ninguna página de negocio
los importa. No se usa base de datos ni red real. Estas suites son pruebas de controladores, adaptador y renderizado; la suite
separada de Chrome se describe al final. Ninguna comprueba autorización en base real.

`npm run test:team-registration` agrupa formulario, lista, adaptador HTTP simulado
y monitor de sesión. El job Aplicación de CI ejecuta este comando y
`npm run test:team-registration-browser` con Chrome del runner. `test:ci` conserva
sus controles de migraciones; la suite HTTP real de backend sigue en el job de
base. Typecheck y lint se verifican por separado en desarrollo.


## Preview exclusivamente de desarrollo

Con el servidor habitual de desarrollo, abrir `/dev/team-registration`.
Reutiliza `TeamRegistrationForm` y `TeamRegistrationList`, con banner de demostración
y datos sintéticos separados. Permite cambiar club/temporada/categoría/grupo,
equipo existente/nuevo, creación no permitida, equipos/categorías/grupos ausentes
y lista vacía. Cada callback espera dos segundos para inspeccionar el bloqueo y
simula un error corregible o un resultado incierto. **Nunca devuelve confirmed,
registra datos ni añade inscripciones a la lista.** Reiniciar simulación solo monta
una nueva captura sintética y no representa verificación de persistencia real.

No se encontró una guarda de previews reutilizable en el código existente.
Se usa la protección de Next.js `notFound()` antes del import dinámico de la vista
cuando `NODE_ENV` no es `development`; también en producción/Preview responde 404.
La vista cliente tiene una segunda guarda de entorno. No se añade autenticación
ficticia: esta pantalla solo está disponible en el servidor de desarrollo.

El monitor global `SessionActivity` omite únicamente esta ruta exacta en desarrollo
mediante `isTeamRegistrationPreview`. Es necesario para que abrir o interactuar con
la demostración no consulte `/api/auth/session` ni renueve actividad de una sesión
real. En producción y en todas las demás rutas conserva su comportamiento.
La página no importa servicios de autenticación o base, y el callback no usa fetch.
Los recursos y HMR de Next.js no son endpoints de negocio.

Se prueba la guarda para development/production/test y rutas distintas. La preview
facilita revisión manual en navegador; estas pruebas no sustituyen un recorrido
real de autorización ni un recorrido HTTP contra PDGLD-62.


## Integración HTTP con develop — 25/10/2026

Fuente vigente: `docs/architecture/team-enrollment.md`, `team-enrollment.ts`, los
handlers y `team-enrollment-queries.ts` integrados en develop. Los modelos internos
de presentación no sustituyen este contrato implementado. No se modifican servicios, endpoints ni autorización.

La página real `/teams/registrations` exige sesión operativa en servidor y monta
`TeamRegistrationWorkspace`. Cada GET/POST mantiene además la autorización real de
PDGLD-62. No importa fixtures ni la preview. Abrir la página no realiza POST;
solo el envío explícito del formulario o la recuperación explícita lo realizan.
La implementación se verificó con red simulada, sin operaciones contra la base.

### Opciones, capacidad y consulta

GET `/api/team-enrollments/options`, luego `?clubId=...` y finalmente
`?clubId=...&seasonId=...` alimentan el modelo anidado del formulario. Cambiar
club/temporada limpia dependientes y carga opciones nuevas. Durante la lectura
se bloquea el formulario; las respuestas de consultas anteriores se descartan y
se cancelan sus solicitudes. Solo se muestran categorías y grupos recibidos para
el contexto seleccionado. Se excluyen equipos con la temporada seleccionada en
`enrolledSeasonIds`. Estas comprobaciones de interfaz no reemplazan al servidor.

**Bloqueo confirmado:** el DTO de opciones no entrega `canCreateTeam` ni otra
capacidad de creación. El adaptador establece `canCreateTeam: false`; «Crear equipo»
no se habilita en la página real. No se infiere del rol ni de `clubs:CREATE`.
El modo nuevo del formulario presentacional y su conversión HTTP se prueban, pero
requieren acordar una capacidad explícita con Víctor para habilitarse en producto.

GET `/api/team-enrollments?clubId=...&seasonId=...&after=...` consulta inscripciones
con paginación `nextAfter`. La selección del formulario actualiza el listado.
También se permite consultar por identificadores de club/temporada de un ámbito
conocido (temporada opcional), independientemente del permiso de inscripción:
GET options exige CREATE y READ de delegado; GET listado permite READ de otros
roles. El servidor decide si ese club está autorizado. No se inventa un catálogo
para usuarios de solo consulta. Se conserva el acceso al historial cerrado.

El DTO del listado no incluye `seasonName`. Se usa el nombre conocido en opciones
y, si no existe (por ejemplo historial cerrado), «Temporada (ID): <seasonId>».
Queda pendiente un nombre histórico de temporada/catálogo autorizado. Se mantienen
`teams.id` y `season_teams.id` separados y no se deduplica por equipo.

### Envío e idempotencia

`team-registration-adapter.ts` convierte `team.kind` del modelo interno en:

- Existente: `team: { mode: "existing", teamId }`.
- Nuevo (aún bloqueado en producto): `team: { mode: "new", name }`.

El cuerpo contiene exclusivamente `enrollmentKey`, `clubId`, `seasonId`,
`categoryId` (no `seasonCategoryId`), `groupId` y `team`. No envía estado,
actor, liga ni folio. Usa el esquema compartido existente para normalizar UUID y
nombre; la interfaz limita el nombre a 200 caracteres sin decidir reglas de liga.

La clave UUID se genera una vez antes de cada intención nueva. Captura normalizada
y clave se conservan en `sessionStorage`, separadas por identidad de servidor y
pestaña, **antes del POST**. No contienen contraseña, token ni documento. No se
escriben logs ni se envían esos datos a otra API. La captura permanece durante
recargas/navegación de esa pestaña hasta resolver el resultado. Cerrar o descartar
el formulario no borra el pendiente; cerrar la pestaña
o borrar almacenamiento pierde esa recuperación local. Una sesión distinta no
recupera el envío de otro usuario. Si el almacenamiento falla o está corrupto,
se bloquea el envío; no se descarta silenciosamente el pendiente.

HTTP 201 confirma solo una respuesta válida con `replayed: false` y REGISTERED.
HTTP 200 confirma recuperación con `replayed: true`; presenta el estado vigente
REGISTERED/ACTIVE/WITHDRAWN, sin cambiarlo. Se verifican los identificadores contra
la captura antes de anunciar éxito. Solo después se elimina el pendiente y se
actualiza el listado. «Iniciar otra inscripción» requiere confirmación previa.

Red incierta, 503, formato inesperado o éxito incoherente mantienen captura y clave,
bloquean edición y envío normal. «Recuperar resultado con el mismo envío» vuelve a
usar **el mismo cuerpo y clave**, únicamente por acción explícita. No hay reintento
automático ni otra clave ante incertidumbre. Al volver a la página se comprueban sesión y acceso antes de restaurar
la captura bloqueada. Un conflicto IDEMPOTENCY_CONFLICT conserva el bloqueo y exige
verificación; no se permite sustituir los datos de esa clave desde la interfaz.

Los errores controlados 400/409/413 del primer intento se presentan con
mensajes seguros y permiten corregir tras confirmar el rechazo, conservando los
campos válidos. Si ya había un envío incierto, un error posterior (incluido 401/403)
no prueba que el primero falló: conserva captura/clave y bloqueo hasta recuperar
el resultado. Ante 401/403 se oculta la captura y se bloquea recuperación hasta
comprobar nuevamente identidad y acceso; la clave permanece almacenada.
INVALID_CONTEXT pide actualizar opciones; TEAM_ALREADY_ENROLLED pide consultar la
inscripción y vuelve a cargar el listado. 401 solicita acceso; PASSWORD_CHANGE_REQUIRED
solicita cambio de contraseña. No se muestran mensajes arbitrarios del servidor.
Fallos de GET solo indican problemas de consulta; no anuncian incertidumbre de POST.

### Comprobaciones de esta integración y pendientes

`npm run test:team-registration-http`
comprueba cuerpos JSON exactos, filtros y paginación, capacidad ausente, estados,
201/200, errores, persistencia de clave entre adaptadores, recuperación explícita,
bloqueo de otra captura, respuestas tardías y renderizado de carga/acceso denegado.
Se incluye en el comando agregado junto a las pruebas de formulario/lista y monitor.
Typecheck y lint se ejecutan por separado.
Son pruebas de adaptador/controladores y renderizado estático con fixtures solo
en pruebas; no son navegación real ni evidencia de autorización/base en vivo.

Pendientes: capacidad explícita de creación; nombres de temporadas históricas y
selección de clubes para usuarios de solo READ sin catálogo autorizado existente;
recorrido manual en navegador con sesión y base preparadas por el equipo. No se
han probado inscripciones reales ni ejecutado migraciones o seeds en esta tarea.


## Aislamiento de identidad, recuperación y cierre local

`TeamRegistrationWorkspace` mantiene un límite hijo con `key={userId}`. Si cambia
la identidad sin desmontar el padre, React desmonta ese hijo y crea un controlador
vacío para el nuevo usuario. La limpieza cancela lecturas, invalida respuestas
anteriores y retira captura, opciones e inscripciones visibles. También invalida
resultados tardíos de POST: no actualizan la nueva vista ni eliminan el pendiente
del propietario anterior. Un POST ya enviado puede haber terminado en el servidor;
no se supone que desmontar lo cancele.

Cada instancia HTTP está vinculada al `userId` obtenido por la página de servidor.
Antes de cada lectura y POST consulta `/api/auth/session` sin renovar actividad.
Si no coincide la identidad o está restringida por cambio de contraseña, no envía
el pendiente. Esta comprobación cliente no sustituye la autorización de PDGLD-62;
el endpoint usa su sesión y permisos reales en cada operación. El contrato no
incluye una precondición de identidad atómica en POST: una modificación externa de
cookies entre comprobación y envío es un límite del cliente, no una garantía nueva
del servidor.

Para restaurar una captura se requiere: sesión con la identidad propietaria,
opciones autorizadas con ese club, y GET de inscripciones autorizado para el
club/temporada. Solo entonces se muestran los campos. Zod verifica la estructura,
pero no otorga acceso. Durante la comprobación no se publican los IDs del pendiente.
Un 401/403 de sesión, opciones, listado o POST limpia los datos visibles y bloquea
las escrituras y la recuperación. Volver a consultar opciones repite las guardas.
Un usuario con solo READ aún puede hacer una consulta independiente autorizada;
ese éxito no habilita ni revela la captura pendiente de inscripción.

**Conservación al perder sesión:** no se elimina automáticamente
`team-enrollment:pending:<userId>`. Contiene la captura normalizada y la misma
`enrollmentKey`. No contiene credenciales. Queda en la pestaña, sin mostrarse a otra
identidad. Solo el mismo usuario, tras volver a autenticarse y superar las consultas
de contexto, puede recuperarla con el cuerpo y clave originales. No hay transferencia
de pendientes entre usuarios. Si pierde permisos, permanece oculta y bloqueada.
El cuerpo y la clave no se eliminan por cerrar, descartar, navegar, desmontar el
formulario o perder sesión. Una confirmación válida permite retirar el pendiente;
los rechazos controlados del primer intento siguen siendo corregibles. Un rechazo
posterior a incertidumbre no resuelve el resultado del envío anterior.

**Cierre explícito (acuerdo confirmado con Víctor):** «Cerrar formulario…» solo se
ofrece para un envío incierto visible y sin POST pendiente. El diálogo explica que
cerrar o descartar la vista no cancela el servidor ni confirma el resultado.
«Seguir en el formulario» conserva la vista. «Cerrar y conservar pendiente» vuelve
a comprobar identidad y presencia del pendiente, oculta la captura y conserva
**el cuerpo completo y enrollmentKey sin escribir ni eliminar almacenamiento**.
No genera una marca nueva de descarte ni otra clave. Muestra un aviso de bloqueo
con «Retomar envío pendiente». Retomar y recargar repiten las comprobaciones de
identidad, opciones y consulta autorizadas antes de restaurar la misma captura
bloqueada. No envían POST automáticamente ni permiten una nueva inscripción.
La recuperación explícita sigue usando el cuerpo y clave originales.

Un listado vacío solo es una respuesta de consulta: no demuestra rollback ni
resuelve una intención incierta. Mantiene el pendiente, el bloqueo y la clave.
Un error de acceso o almacenamiento mantiene la captura oculta y no permite
iniciar otra intención. `canCreateTeam` permanece en false en la integración real.

**Compatibilidad local:** versiones anteriores podían haber creado
`team-enrollment:pending:<userId>:discarded` sin conservar el cuerpo. Se respeta ese
bloqueo antiguo y no se reconstruye el cuerpo ni se genera otra clave. La versión
actual no crea esas marcas. Resolverlas requiere el contrato pendiente de Víctor.

**Límite del almacenamiento:** se conserva `sessionStorage` por usuario y pestaña.
Cerrar el formulario no cierra la pestaña. Recargar conserva el pendiente, pero
cerrar la pestaña o borrar su almacenamiento puede perder la copia local; no
cancela el servidor. No se cambia el mecanismo de almacenamiento en este acuerdo.

**Verificación y conciliación pendientes:** no existe un GET por `enrollmentKey`
ni un endpoint de cancelación/conciliación en el contrato integrado. El listado no
expone la clave. Se mantiene la recuperación explícita existente por POST
idempotente; no se añaden contratos ni se interpreta un vacío como permiso para
reenviar con otra clave. La operación de verificación/conciliación queda pendiente
del contrato de Víctor, igual que capacidades y catálogos.

Pruebas adicionales: `team-registration-http.test.tsx` comprueba identidad distinta,
restauración diferida hasta autorización, 401/403, respuestas tardías de GET/POST,
cierre conservando cuerpo/clave, bloqueo tras recarga con listado vacío,
recuperación exacta y fallos de acceso/almacenamiento.
`node --test tests/e2e/team-registration-session.test.mjs` ejecuta React DOM real en
Chrome headless con perfil temporal y servidor efímero de archivos de prueba:
cambia usuario manteniendo el padre montado, comprueba aborto de lectura y descarta
su respuesta tardía, sin mostrar datos anteriores ni enviar el pendiente con el
nuevo usuario. Usa Chrome instalado (`CHROME_BIN` opcional), esbuild ya presente y
respuestas HTTP sintéticas; no inicia Next ni contacta servicios/base reales.
La suite de navegador usa el monitor y la preview como alcance separado: no
prueba sus rutas Next. Se incorpora al job Aplicación de CI con Chrome del runner.


## Continuación de PDGLD-63 — navegación, accesibilidad y contratos pendientes

Desde `/access`, el enlace «Inscripción y consulta de equipos» usa `ActionLink`,
igual que el acceso existente al portal. Es navegación para una sesión operativa;
no declara ni infiere autorización de inscripción. La página y cada endpoint
conservan sus comprobaciones. No se añaden pantallas de administración de catálogos.

Los errores locales y los errores por campo del callback enfocan el primer
control después de renderizar el mensaje asociado mediante `aria-describedby`.
Las confirmaciones y resultados inciertos enfocan su aviso; al iniciar otra
inscripción el foco vuelve a Club cuando termina la carga. Los controles conservan
el foco visible global del proyecto. Recuperación queda deshabilitada durante
lecturas que bloquean el formulario.

El cierre usa `<dialog>` modal con nombre, descripción y `role="alertdialog"`.
Al abrirlo se enfoca «Seguir en el formulario»; el navegador retiene el foco dentro
del modal y vuelve inerte el fondo. Escape/cancelar mantiene la vista y devuelve
el foco al disparador. Durante el cierre no se permite cancelar ni confirmar de
nuevo. Si se oculta la captura por cierre o pérdida de acceso, se enfoca el aviso
de bloqueo. El cuerpo y la clave permanecen conservados.

### Apoyo concreto de Víctor (sin contrato nuevo supuesto)

| Caso | Endpoint y respuesta actuales | Dato u operación que falta acordar |
| --- | --- | --- |
| Crear equipo según autorización | `GET /api/team-enrollments/options?clubId=…&seasonId=…` devuelve `clubs`, `seasons`, `teams`, `categories`, `groups`. No expone capacidad para el modo nuevo. `POST /api/team-enrollments` acepta `team.mode` nuevo/existente y autoriza en servidor. | Capacidad explícita del servidor para crear en el club/temporada seleccionado y semántica de revocación. Hasta recibirla, el adaptador mantiene `canCreateTeam=false`; no se deduce de rol ni permiso CREATE. |
| Catálogos de consulta e historial | `GET /api/team-enrollments/options` lista clubes de delegado con CREATE/READ y temporadas no cerradas. `GET /api/team-enrollments?clubId=…&seasonId=…&after=…` admite READ, devuelve `items` y `nextAfter`; cada item contiene `seasonId`, nombres de equipo/categoría/grupo, pero no `seasonName`. | Catálogo autorizado para elegir club y temporadas, incluidas cerradas, con permiso de consulta; nombre histórico de temporada en una fuente autorizada. Definir cómo ampliar/reutilizar contratos existentes, sin crear administración de catálogos. La UI actual permite UUID y muestra nombre conocido o ID explícito. |
| Verificar un envío incierto conservado | `POST /api/team-enrollments` con cuerpo y `enrollmentKey` originales devuelve 201/`replayed:false` para alta o 200/`replayed:true` para recuperación, con inscripción y estado vigente. `GET /api/team-enrollments` no devuelve la clave ni identifica esa intención. | Consulta autorizada del resultado por intención, con semántica para pendiente/no encontrado/confirmado que permita verificar sin suponer rollback. No hay un GET por clave disponible. Mientras tanto solo se ofrece recuperación explícita por el POST idempotente; puede completar el alta si el intento anterior no llegó. |
| Conciliar tras cerrar o descartar el formulario | El cierre solo oculta la vista y conserva cuerpo y clave originales. No hay endpoint de cancelación/conciliación, y el listado no correlaciona por clave. Pueden existir marcas antiguas sin cuerpo. | Contrato autorizado de verificación/conciliación pendiente de Víctor. Hasta recibirlo se conserva el bloqueo; no se inventa cancelación, reconstrucción de cuerpos perdidos ni desbloqueo por listado vacío. |

Estos contratos se deben acordar con Víctor antes de implementar su consumo. No se
cambian backend, permisos ni base en esta continuación. La transición a ACTIVE y
su aceptación siguen siendo responsabilidad de la historia y del acuerdo de Liga;
mostrar el estado no implementa una transición.

### Comandos y evidencia de pruebas

- `npm run test:team-registration-form`: controlador y renderizado estático.
- `npm run test:team-registration-list`: renderizado estático e historial.
- `npm run test:team-registration-http`: fetch y almacenamiento simulados; no HTTP real.
- `npm run test:session-activity`: efecto con hooks, reloj y eventos simulados.
- `npm run test:team-registration`: las cuatro suites anteriores, sin base.
- `npm run test:team-registration-browser`: React DOM en Chrome real con negocio
  sintético; comprueba foco de error local y async, asociación del mensaje,
  bloqueo de envío, modal, foco inicial conservador, fondo inerte, cancelación, retorno de foco y cierre
  conservando el pendiente al retomar/remontar, además del cambio de identidad y
  respuestas tardías. El evento
  cancel se despacha en la prueba; no es una pulsación física de Escape ni una
  validación con lector de pantalla. Requiere Chrome instalado o `CHROME_BIN`.
- `npm run typecheck` y `npm run lint`.

El navegador usa servidor efímero local de archivos, no Next, ni login/base reales.
El recorrido completo de producto con backend y revisión de otra persona sigue
pendiente para aceptación. CI se verificará en remoto cuando exista PR; configurar
el workflow no significa que ya haya pasado.

Validación local previa a este acuerdo (26/10/2026): 19 pruebas de formulario,
5 de lista, 26 de adaptador/workspace y 5 de actividad de sesión aprobadas;
1 recorrido de Chrome sintético aprobado; typecheck y lint aprobados. El primer
intento de navegador quedó impedido por el sandbox al abrir el puerto local; la
repetición autorizada pasó. No se ejecutaron suites de base, migraciones ni seeds.

Validación del acuerdo de cierre conservando pendiente (26/10/2026): 58 pruebas
sin base aprobadas (19 formulario, 5 lista, 29 adaptador/workspace, 5 actividad),
1 recorrido Chrome con negocio sintético aprobado, typecheck y lint aprobados.
Las pruebas verifican cierre sin mutaciones del almacenamiento, recarga de la
vista con listado vacío manteniendo bloqueo, recuperación con JSON/clave idénticos
y ausencia de otra clave, además de aislamiento y comprobaciones de acceso.
No se ejecutaron pruebas con base ni se cambiaron contratos del servidor.
