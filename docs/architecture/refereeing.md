# PDGLD-141 — registro y designaciones reales

Entrega de backend de PDGLD-86 sobre las vistas aprobadas de PDGLD-142. Misma
rama `feat/PDGLD-86-arbitros-designaciones`. No implementa PDGLD-18/19 ni la PWA.

Las presentaciones nuevas incluyen acreditación privada y revisión explícita
de Comisión. Véase [cédula del candidato y Storage](referee-credentials.md),
con recuperación, conservación de antecedentes y plan de seguridad de producción.

## Inventario comprobado antes de implementar

- `people`: Persona única, identidad/versionado y trámite privado de PDGLD-117.
  Registrar árbitro nunca crea Persona, cuenta, rol ni permiso.
- `referees`: UNIQUE(person_id), is_active global. Se añade versión del agregado.
- `club_season_referees`: UNIQUE(referee_id,season_id), FK a afiliación
  club/temporada. Se conserva una presentación por temporada.
- `referee_availability`: timestamptz, is_available y CHECK fin posterior.
  Es disponibilidad global del árbitro, no disponibilidad aislada de una liga.
- `referee_assignments`: PROPOSED / APPROVED / REVOKED; índice parcial único
  árbitro/partido no revocado; APPROVED exige actor y fecha. Se añaden versión,
  versión de identidad aprobada y captura de identidad al cierre del partido.
- RF22: módulo **refereeing**. Comisión tiene CREATE/READ/UPDATE/APPROVE;
  Programación READ/UPDATE; SUPERADMIN solo READ según catálogo instalado.
  Las concesiones efectivas se consultan en base; no se usan nombres de cargos
  ni códigos de roles como autorización. No hay bypass para SUPERADMIN.
- PDGLD-16: `assertOwnRefereeAssignment`, `getAssignedMatches` y `/matches`
  ya existen. Conservados; la comprobación propia ahora exige efectividad SQL.
- Programación: reservas, coherencia grupo/equipos y disponibilidad/duración
  de cancha ya están en PostgreSQL, incluida PDGLD-22. No se duplican.
- PDGLD-85: PR #56 comprobado mediante GitHub, abierto/sin integrar. No se
  importan sus servicios pendientes ni se cambia el estado del PR.
- PDGLD-18/19: no hay cédula, reportes/exportaciones arbitrales ni PWA
  implementados en este árbol. No se crean dentro de esta historia.

## Permisos y operaciones

`/referees` usa el mismo shell y componentes visuales. Se retiró la demo del
menú; `/referees/demo` redirige al flujo real para conservar enlaces anteriores.
Los fixtures permanecen solo como soporte de pruebas de componentes.
El padrón completo requiere READ no contextual del
módulo en esa liga. READ contextual de árbitro no abre el padrón; su recorrido
continúa en Mis partidos, con permiso de cédula y designación propia efectiva.

`POST /api/referees` autentica desde sesión, comprueba origen, JSON acotado y
contrato Zod. El servicio vuelve a autorizar liga/temporada/club/partido:

| kind | Acción RF22 | Condiciones adicionales |
| --- | --- | --- |
| register nuevo | CREATE + READ | Persona existente visible en liga, club activo y afiliación aprobada; versión 0 solo si no existe árbitro |
| register existente | UPDATE + READ | Misma persona; versión del agregado y autorización de todas sus referencias |
| availability | UPDATE + READ | Intervalo válido, pertenencia a temporada y alcance de todas sus referencias, también en otras ligas |
| propose | UPDATE + READ | Programación puede proponer con su permiso UPDATE; no se crea aprobación ni publicación |
| assign | UPDATE + APPROVE + READ | Asigna y aprueba en una transacción; exige permisos efectivos de ambas operaciones, sin resolver por nombre de rol |
| approve / revoke | APPROVE + READ | Versión de designación y partido, contexto abierto, permiso de Comisión vigente por RF22 |

Por acuerdo del usuario, quien dispone de UPDATE y APPROVE ve **Asignar árbitro**
y confirma **Asignar y aprobar**. Programación mantiene **Proponer designación**.
Las propuestas existentes siguen necesitando aprobación; no se aprueban en lote
ni por cambiar los permisos. No se añade aceptación/rechazo del árbitro en esta
entrega y se conservan PROPOSED / APPROVED / REVOKED.

`assign` reutiliza propuesta y aprobación dentro de la misma transacción, con
claves derivadas estables y un acuse raíz. Historial muestra los dos eventos de
negocio; el acuse raíz no añade un tercer evento visual. Si falla cualquier paso,
se revierte todo. La recuperación conserva clave, motivo y versión del partido.

Actualizar desde una ficha REVOKED reutiliza `assign` o `propose` con el partido
preseleccionado. No manda `approve` sobre el antecedente ni intenta cambiar su
estado: la nueva designación tiene otra identidad y conserva el historial previo.
El selector usa las evaluaciones autorizadas para omitir aprobaciones sin
bloqueos; las que requieren revisión ofrecen acceso a su ficha y requieren una
revocación explícita antes de reasignar, conforme al bloqueo de plaza existente.
Las propuestas pendientes siguen identificadas como propuestas sin acceso efectivo.
`openForAssignments` es una proyección de presentación del contexto actual;
los servicios y restricciones SQL siguen validando cada escritura y versión.

La actividad y disponibilidad son globales: no se permite a un administrador de
una sola liga alterar silenciosamente un árbitro compartido con ligas ajenas.
Los catálogos de Persona solo contienen referencias de la liga; READ simple no
recibe un directorio de otras personas. La consulta de acuse es privada al actor
original y vuelve a comprobar READ sobre el contexto de la operación.

Recorrido acordado y conectado en `/referees/presentations`: el delegado presenta
candidatos de su club por temporada, Comisión valida su incorporación y puede
provisionar después el acceso sobre la misma Persona. El delegado
usa READ + CREATE contextuales de **clubs**, con un club concreto en la concesión;
no recibe permisos de refereeing. Comisión usa READ + APPROVE de **refereeing** y
CREATE/UPDATE según corresponda al registro. Se conserva la autorización RF22
vigente y no se deduce autoridad de nombres de cargos o roles.

La migración aditiva `20261114020000_pdgld141_referee_presentations` añade un
trámite privado PENDING/APPROVED/REJECTED, separado de las designaciones. Cada
captura conserva club, temporada, solicitante, nombres presentados y motivo.
La clave de envío es única por solicitante; la decisión conserva revisor, clave,
hash, versión y motivo. Campos originales y decisiones finales son inmutables.
El servicio coordina idempotencia y revisión dentro del mismo bloqueo/transacción
de arbitraje. El cliente comparte el controlador de incertidumbre del padrón,
separando el payload mínimo por cuenta y endpoint en sessionStorage. La captura
puede contener los nombres aportados; se elimina al recibir acuse o cerrar la
pestaña, no contiene CURP, documentos ni credenciales y no se reenvía sola.

El delegado puede reutilizar una Persona vinculada a su club o capturar un
candidato para revisión. Un candidato nuevo todavía **no crea Persona, árbitro,
cuenta ni permisos**. Comisión selecciona una Persona existente autorizada de la
liga, o confirma expresamente que es nueva. Las coincidencias de nombre/primer
apellido bloquean el alta para revisión; no se fusionan identidades por nombre
ni se consultan proveedores. Los nombres solos no acreditan identidad: esta
verificación sigue siendo humana. No se revelan coincidencias de otras ligas.

Aceptar crea o reutiliza Persona/árbitro y registra atómicamente su relación con
el club original. No cambia actividad global de un árbitro existente ni crea
cuenta, rol o designación. La ficha aceptada preserva el nombre/versionado usado
al incorporar. Para corregir una captura se rechaza y se presenta otra; no se
reescribe la original. La cuenta usa `users.person_id`, el mismo UUID de
`referees.person_id`; se muestra la referencia en la ficha incorporada y padrón.

### Acceso del árbitro después de la incorporación

«Acceso de árbitro» abre `/referees/access?referee=…&season=…` desde el padrón
o una presentación incorporada. `POST /api/referee-access` exige la nueva
capacidad RF22 **referee-accounts:CREATE**, además de READ/APPROVE de refereeing
en la liga/temporada verificada. Es un contrato acotado: el navegador no elige
rol ni Persona. Solo se concede **REFEREE** en la liga de la incorporación activa,
con afiliación aprobada y temporada abierta. Se rechazan campos de roles,
Personas ajenas, versiones anteriores, árbitro inactivo y cuentas inactivas o
asignaciones cuya vigencia necesita revisión. El acceso a partidos sigue
dependiendo de la designación efectiva; no se amplía por tener cuenta.

Si no existe cuenta, reutiliza la validación de credenciales y la persistencia
del módulo accounts, exige cambio de contraseña al primer ingreso y no envía
correos. Si ya existe, preserva usuario, correo, contraseña y otros roles: la
acción explícita solo añade REFEREE en esa liga si falta. No reactiva cuentas,
no restablece contraseñas y no renueva asignaciones vencidas silenciosamente.

El alta general `/accounts/new` incluye ahora REFEREE para actores que pueden
delegarlo y reutilizar Personas. Exige la Persona ya incorporada en una liga
vigente; no admite crear otra Persona al seleccionar ese rol. La autoridad
general de users sigue siendo obligatoria para ese contrato. Comisión conserva
su ruta acotada, sin users:CREATE/UPDATE ni acceso general a la administración.

Las migraciones aditivas `20261114030000_pdgld141_referee_access` y
`20261114040000_pdgld141_referee_access_delegation` instalan una capacidad
explícita para Comisión y para que Administración conserve la delegación del
rol Comisión. No agregan APPROVE de refereeing a SUPERADMIN. La capacidad es
autoridad de cuentas en RF22; users:APPROVE no permite concederla por atajo.
Las funciones privadas de instalación se ejecutan tras la matriz inicial,
también desde seed, registran su actor/motivo y nunca restauran permisos
retirados después del marcador. No se modifica la matriz inicial ni se crean
tablas, se desactiva RLS o se concede EXECUTE a Preview/roles API.

La operación usa RF22 → identidad 117 → arbitraje 86/141, bloqueo de la cuenta,
unicidad de users.person_id y acuse inmutable en referee_operations. Repetir la
misma clave/versionado devuelve el acuse; cambiar contenido con la misma clave
se rechaza. El fingerprint incluye las credenciales mediante HMAC con el secreto
del servidor; no almacena la contraseña en historial. Tras rotación del secreto
se recupera el acuse por GET en vez de reenviar. El navegador conserva por actor
solo los metadatos de la operación incierta; la contraseña permanece en memoria.
Tras recargar se consulta el acuse; si falta y se necesita reintentar, se vuelve
a escribir la contraseña original y se conserva la misma clave y versión.

La lectura del menú/contextos usa un snapshot de concesiones válido únicamente
dentro de su transacción y contextos provenientes de afiliaciones verificadas.
Evita consultar identidad/permisos por cada club y reutiliza el catálogo de
personas por liga; las escrituras siguen revalidando todas las condiciones.

La presentación se renueva **cada temporada**. Se reutilizan Persona, árbitro y
cuenta; se crea una relación independiente para la nueva temporada tras revisar.
El directorio del delegado incluye sus árbitros de temporadas anteriores para
esta renovación. El vínculo de club/temporada incorporado no se puede trasladar
ni borrar, incluso desde la edición general del padrón. Temporadas anteriores
y sus antecedentes permanecen intactos. La restricción del grupo completo sigue
usando esa relación, sin excepción de grupo único.

La cuota se calcula mediante `readRefereeClubQuotas`, compartido por el padrón y
este recorrido. Pendientes y rechazados no cubren cuota; solo incorporados.
Requeridos sigue siendo `ceil(equipos registrados válidos / 4)`: cinco requieren
dos. No se agrega multa, sanción ni límite que impida presentar más candidatos.

La tabla nueva niega PUBLIC y roles API y activa RLS solo en Supabase. Su plan
privado de producción usa checksum exacto y el rol Preview recibe únicamente
SELECT, INSERT de captura y UPDATE de decisión/bloqueo. No hay DELETE/TRUNCATE.
Docker conserva la decisión de RLS vigente. El plan se prepara, no se despliega.

## Reglas e integridad

`referee_assignment_blockers` es la única evaluación de negocio. La consumen
lecturas, propuesta/aprobación y triggers de integridad. Verifica:

- Liga activa, temporada no cerrada, categoría/grupo/equipos consistentes,
  partido programado, no retirado ni cancelado; horario completo dentro de las
  fechas de temporada en la zona de la liga.
- Árbitro activo, presentación válida y afiliación aprobada de club activo.
- Todos los equipos vinculados al grupo: el club que presenta no puede tener
  equipo allí, aunque no dispute el encuentro. **Sin excepción de grupo único**.
  Se conserva el bloqueo de membresías de equipos retirados que siguen
  vinculados al grupo; su tratamiento requiere decisión externa explícita.
- Unión de intervalos disponibles, incluidos contiguos, cubriendo el encuentro;
  cualquier indisponibilidad que cruce el horario prevalece. Extremos adyacentes
  no se traslapan. No se inventan tiempos de traslado o descansos.
- Otra aprobación del mismo árbitro en horario coincidente, designación no
  revocada duplicada y puesto principal ya aprobado.

Se soporta el puesto MAIN del contrato actual. Propuestas pendientes no ocupan
horarios ni conceden acceso; aprobar reserva el puesto. Nuevos puestos y políticas
de relevo durante un partido requieren su contrato explícito.

Las escrituras de servicio toman RF22 exclusivo → llave histórica 117 → llave
86/141. Triggers de sentencia sobre dependencias toman RF22 compartido → 117 →
86/141 antes de modificar filas, compatibles con el orden del cierre existente.
Esto coordina también cambios SQL de horario/grupo/disponibilidad. La evaluación
PL/pgSQL es VOLATILE y consulta después de obtener el bloqueo; no depende de una
lectura previa hecha fuera de la transacción. Un índice parcial impide dos
aprobados MAIN en el mismo encuentro. No se ocultan ni corrigen duplicados legados
durante la migración: si existen, la creación del índice falla para revisión.

Cambios que invaliden una aprobación vigente se rechazan transaccionalmente;
primero debe revocarse. Cancelar/retirar un partido conserva su antecedente y deja
de darle acceso efectivo; PDGLD-85 debe consumir este contrato. Una corrección de
identidad conserva el registro y cambia su versión: la aprobación abierta anterior
queda sin efectividad hasta revocar/proponer/aprobar nuevamente. No se modifica
su estado silenciosamente ni se reescriben partidos/resultados cerrados.

## Historial, versiones y respuesta incierta

Migración aditiva `20261114010000_pdgld141_refereeing`. Agrega
`referee_operations`, privada e inmutable: actor, clave única por actor, hash del
contenido, contexto, entidad, acción, motivo, resultado/versionado y fecha.
Cada operación y su acuse se confirman en una transacción. Repetir la misma clave
y contenido devuelve el acuse; cambiar contenido con esa clave falla. Los triggers
de auditoría registran los cambios de filas; el servicio no duplica esos eventos
con INSERT manuales de la misma modificación.

El cliente impide doble envío y conserva el contrato original ante timeout,
5xx o pérdida de autenticación. GET por operationKey consulta sin reenviar;
un reintento manual conserva clave, contenido y versión. El contrato mínimo
(IDs, motivo, versión y clave; sin CURP/documentos/tokens) se conserva en
sessionStorage separado por actor, hasta recibir resultado o cerrar la pestaña.
Al recargar puede recuperarse el acuse; cambiar de cuenta no abre solicitudes de
la anterior. Si el almacenamiento está bloqueado, solo vive en memoria durante la
vista. No existe cola automática ni promesa de borrador persistente.

## Cuota

Equipos válidos para el conteo actual: `season_teams` REGISTERED o ACTIVE,
equipo ACTIVE, club ACTIVE y afiliación APPROVED en la misma temporada. La
unicidad equipo/temporada existente evita doble conteo. Requeridos =
`ceil(equipos/4)`; faltantes = máximo(0, requeridos - presentados). Presentados
cuenta relaciones únicas del club/temporada, mostrando activos e inactivos
separados. Falta confirmar si los inactivos deben descontarse del cómputo oficial.
Los clubes no vigentes se identifican en el contexto y no aportan equipos válidos.
No hay multas, sanciones ni consecuencias deportivas inventadas. En temporada
cerrada no se reconstruye cuota histórica con estados actuales.

## Inventario de lectores históricos de PDGLD-117

| Consumidor | Tratamiento |
| --- | --- |
| Padrón de temporada cerrada | `readSeasonIdentityHistory`; sin people como sustituto. Actividad se etiqueta como vigente, no como actividad al cierre |
| Designación y revisión de partido finalizado | `identity_snapshot` MATCH_CLOSURE_V1; sin etiqueta vigente del padrón como respaldo |
| Historial por árbitro/partido | Captura de cierre de temporada o partido; si falta evidencia, identidad no disponible |
| Actor/motivo de operaciones | Referencias y nombre de usuario del actor; no reconstruye la identidad arbitral del pasado |
| Mis partidos / evaluación de alineación PDGLD-16 | Comprueba propiedad, permiso y `referee_assignment_effective`; no exporta nombre arbitral vigente como identidad histórica |
| Corrección PDGLD-117 | Mantiene lector selectivo y barrera; agrega reevaluación/auditoría de referencias abiertas sin modificar estados de designación ni contextos cerrados |
| Reportes/exportaciones arbitrales, cédula/PWA | No existen consumidores implementados adicionales en el inventario. Sus futuros lectores deben usar estos contratos; no se certifican SQL externo ni consumidores del PR pendiente |

Los cierres futuros de temporada ya capturan nombres de árbitros mediante 117.
La captura propia del partido tiene prioridad sobre un cierre posterior de
temporada: una corrección entre ambos cierres no cambia el nombre del partido.
Un final legado sin captura propia permanece desprotegido aunque exista una
captura posterior de temporada; no se usa esa captura para reconstruir el partido.
Para finales de partido futuros, el trigger captura solo durante una transición
real a FINISHED/NO_SHOW/ADMINISTRATIVELY_RESOLVED. Una aprobación con versión de
identidad obsoleta no recibe un nombre actual como si hubiera sido su identidad
aprobada. No hay backfill de cierres anteriores. La captura no pretende ser la
cédula ni acreditar sus hechos deportivos.

`HISTORICAL_REFEREE_UNPROTECTED` permanece para cada referencia cerrada sin
captura fiable. Los snapshots no habilitan por sí solos una edición de Persona:
se exige el trámite privado pendiente de otro solicitante y su evento APPLIED en
la misma transacción, además de las autorizaciones originales de 117. El guardia
diferido revierte una corrección incompleta. El nuevo contrato de reevaluación
solo audita las referencias abiertas y reconsulta su efectividad por versión.

## Disponibilidad declarada por el árbitro

Ampliación autorizada el 14/11/2026: `/referees/my-availability` ofrece **Mi
disponibilidad** antes de tener partidos asignados. Exige READ contextual de
refereeing y, para captura, UPDATE contextual. La migración aditiva
`20261114050000_pdgld141_own_referee_availability` instala UPDATE* en REFEREE una
sola vez. El seed lo recibe después de la matriz inicial y no restaura permisos
retirados tras el marcador. No concede UPDATE no contextual, APPROVE, cuentas
ni acceso al padrón.

El contrato compartido `readOwnReferee` vincula sesión → users.person_id →
referees.person_id. Conocer un UUID no permite leer o modificar otro árbitro.
La lectura entrega solo intervalos propios y contextos autorizados con
incorporación aprobada, club/liga activos y temporada abierta. Sin incorporación
se muestra un vacío; un árbitro inactivo mantiene consulta sin captura.

La disponibilidad es global. Elegir liga/temporada autoriza y determina la zona
de las fechas; no crea otro calendario. Modificarla exige permisos propios en
todos sus vínculos vigentes afectados. Si faltan, se bloquea con
`SHARED_AVAILABILITY_SCOPE`, sin revelar contextos ajenos ni ampliar privilegios.

`POST /api/referee-availability` acepta únicamente availability, comprueba sesión,
origen/actor esperado y Zod, y revalida propiedad/alcance. Reutiliza
`saveRefereeAvailability`, versión, bloqueo RF22 → 117 → 86/141, guards SQL y
auditoría de Comisión. Impide intervalos ajenos y cambios que invaliden
designaciones aprobadas; no las revoca ni reescribe antecedentes cerrados.
Comisión mantiene consulta/corrección con su UPDATE no contextual.

El acuse inmutable referee_operations conserva actor, motivo, clave y versión.
La recuperación GET revalida la identidad y lectura propias; el reintento
conserva el contenido original. La UI reutiliza AvailabilityDialog, FormDialog,
SelectField y temas/tokens. El motivo tiene ejemplos distintos para disponible
e indisponible, sin prellenado. Mis partidos conserva su recorrido.

No crea tablas ni cambia RLS. Utiliza las ACL existentes de lectura,
INSERT/UPDATE y bloqueo de disponibilidad/operaciones. El instalador privado
niega EXECUTE a PUBLIC, roles API y Preview. La prueba local usa las ACL
limitadas para el árbitro; solo el propietario prepara el partido sintético,
sin conceder programación al árbitro. Todos los fixtures terminan en rollback.

## Seguridad SQL / producción

La tabla nueva niega PUBLIC y todos los roles API existentes, incluido
service_role; habilita RLS solo en destino Supabase, sin políticas API. Docker
normal conserva su decisión de RLS. El plan de producción registra checksum
exacto en `PRIVATE_TABLE_PLANS` y verifica RLS/ausencia de ACL expuestas antes y
después del despliegue. Esto es preparación del plan, no despliegue autorizado.

Preview recibe explícitamente lecturas de relaciones/disponibilidad/operaciones
y columnas mínimas de snapshots, INSERT/UPDATE de las columnas necesarias y
permisos de bloqueo. `identity_snapshot` no admite UPDATE desde el rol limitado:
solo el trigger de cierre puede capturarlo. No se conceden UPDATE/DELETE del
ledger. Las funciones SECURITY DEFINER fijan search_path, no son públicas y su
EXECUTE se concede únicamente al backend donde se necesita. El rol de backend
no sustituye las comprobaciones RF22 por actor.
El plan completa asimismo los accesos acotados que exige el trámite ya existente
de 117: solicitudes/evidencias privadas, decisión/versionado y columnas de
identidad de Persona. No concede borrado de evidencias ni acceso API público;
los guards transaccionales del trámite y su autorización siguen siendo obligatorios.

## Validación de esta entrega

Base local PostgreSQL 15 desechable, sin volúmenes y con credenciales sintéticas.
Se aplicó todo el historial con migrate deploy. Se activó RLS exclusivamente en
esa base de validación y se aplicó el mismo plan del rol Preview. Se comprobó
registro/disponibilidad, idempotencia, permiso y alcance, propuesta sin acceso,
carrera de dos aprobaciones (una confirmada), revocación con pérdida de acceso,
bloqueo por tercer equipo del grupo, captura de final de partido y rechazo de
edición directa de identidad histórica. HTTP real: login y vista/API 200,
anónimo 307 a login, otra liga 403 y origen ajeno 403.

No se probó Supabase, producción, proveedores CURP/INE ni el PR #56. La
aplicación completa de una corrección privada de identidad con documentación y
contextos abiertos/cerrados, PG17, concurrencia masiva y recorridos ampliados
quedan para la siguiente etapa de pruebas, después de la revisión humana del
backend. No se modifican Jira ni se publica o integra trabajo.
