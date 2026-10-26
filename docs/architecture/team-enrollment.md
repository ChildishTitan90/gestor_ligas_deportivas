# Inscripción de equipos — contrato PDGLD-62/63/64

Actualizado el 26/10/2026. Base de integración: `origin/develop` en `b99730c`
(PR #27 y #29 integrados). El trabajo visual de Nick permanece en su computadora;
no está disponible en las referencias remotas revisadas. Esta entrega prepara
backend, recuperación reutilizable y pruebas; **no acredita la página de PDGLD-63**.

## Permisos y reglas

La sesión NextAuth debe estar operativa. Las escrituras vuelven a exigir
`clubs:CREATE` en una asignación vigente `CLUB_DELEGATE` del club seleccionado.
Se conservan los permisos existentes: no hay permiso nuevo ni autorización por
nombre del rol solamente. No se mezcla CREATE de un rol con el alcance de otro.
Equipo nuevo y equipo existente usan esta misma política actual.

Consultar exige `clubs:READ` en el contexto vigente; no requiere CREATE ni una
afiliación actualmente aprobada. La política compartida conserva clubes activos,
ligas activas y vigencia de asignaciones. No se amplía esa política incidentalmente.

Crear exige además temporada de fútbol abierta de la liga, afiliación APPROVED,
categoría con `authorized_by` y `authorized_at`, grupo de esa categoría/temporada
y equipo del propio club. La capacidad de escribir no sustituye estos requisitos.
El primer estado es REGISTERED/INSCRITO. No se implementa ACTIVE, bajas,
finanzas, jugadores ni cambios de delegado/subdelegado.

Cada identidad `teams.id` puede participar una sola vez por temporada, incluso
con grupo/categoría distintos. Otra temporada conserva el equipo y crea otra
participación `season_teams.id`. No se deduplica por nombre.

## Rutas para Nick

Todas devuelven JSON privado y `Cache-Control: private, no-store`. GET rechaza
parámetros desconocidos o repetidos. POST exige Origin del mismo origen de
NEXTAUTH_URL, no cross-site, JSON y hasta 8 KiB. El actor siempre viene de la sesión.

### Opciones de inscripción

`GET /api/team-enrollments/options[?clubId=UUID&seasonId=UUID]`

```json
{
  "clubs": [{ "id": "11111111-1111-4111-8111-111111111111", "name": "Club Morelia", "leagueId": "22222222-2222-4222-8222-222222222222" }],
  "capabilities": {
    "clubId": "11111111-1111-4111-8111-111111111111",
    "canEnroll": true,
    "canCreateTeam": true
  },
  "teams": [], "seasons": [], "categories": [], "groups": [],
  "nextClubAfter": null, "nextSeasonAfter": null, "nextTeamAfter": null
}
```

Sin club seleccionado, capabilities tiene clubId=null y ambos booleanos false.
Con club, los booleanos se calculan por el autorizador real dentro de la
transacción. READ sin CREATE devuelve 200 y false; no bloquea los filtros.
La UI solo habilita equipo nuevo con ambos booleanos true y el mismo club actual.
Ausencia, carga pendiente, denegación y respuesta atrasada de otro club mantienen
la acción deshabilitada. `enrollmentCreationAllowed` ofrece esta comprobación.
Los booleanos describen permiso, incluso si todavía falta aprobación/categoría.

- clubs: `{ id, name, leagueId }`, autorizados por READ. Seleccionar un club no
  convierte la lista en un catálogo de clubes ajenos ni pierde el resto de opciones.
- teams: `{ id, clubId, name, referenceNumber, enrolledSeasonIds }` del club.
- seasons: `{ id, name, status }`, fútbol y liga del club; excluye CLOSED.
- categories: `{ id, seasonCategoryId, seasonId, name }`, solo autorizadas
  explícitamente en la afiliación aprobada de la temporada seleccionada.
- groups: `{ id, name, categoryId, seasonId }`, de las categorías anteriores.

clubId carga equipos/temporadas; seasonId requiere clubId y carga categorías/grupos.
Sin aprobación o con temporada cerrada las categorías quedan vacías.
Cambiar contexto invalida las opciones dependientes en la UI. Excluir equipos cuya
lista enrolledSeasonIds contenga la temporada actual; POST vuelve a comprobarlo.

Paginación: `limit` 1–100 (predeterminado 100), `clubAfter`, `seasonAfter`, `teamAfter`.
UUID ascendente en los tres catálogos; cada cursor avanza solo su colección.
Con seasonId se consulta esa temporada concreta y se ignora seasonAfter.
Categorías/grupos se acotan a la selección aprobada de esa afiliación (máximo
100 categorías por el contrato de solicitud); los grupos conservan nombre/id.

### Catálogos de consulta e historial

`GET /api/team-enrollments/catalogs[?clubId=UUID&seasonId=UUID]`

Misma forma de respuesta y paginación de clubes/temporadas. Incluye temporadas
CLOSED y temporadas sin afiliación del club. No exige aprobación ni CREATE.
No devuelve opciones de inscripción: teams/categories/groups quedan vacíos;
nextTeamAfter es null. Los nombres de equipo/categoría/grupo del historial vienen
en cada registro del listado, no se buscan en catálogos de inscripción vigentes.

`GET /api/team-enrollments?clubId=UUID[&seasonId=UUID&limit=50&after=UUID]`

READ por club, límite 1–100 (predeterminado 50), UUID ascendente, respuesta
`{ items, nextAfter }`. nextAfter=null al terminar. Cada registro incluye:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "teamId": "44444444-4444-4444-8444-444444444444",
  "teamName": "Morelia Juvenil", "teamReferenceNumber": "TEAM-folio",
  "clubId": "11111111-1111-4111-8111-111111111111",
  "seasonId": "55555555-5555-4555-8555-555555555555", "seasonName": "Temporada 2026",
  "categoryId": "66666666-6666-4666-8666-666666666666", "categoryName": "Juvenil",
  "groupId": "77777777-7777-4777-8777-777777777777", "groupName": "Grupo A",
  "status": "REGISTERED"
}
```

Los UUID son identificadores, no etiquetas habituales de presentación.
No se devuelven claves de reintento, huellas, actores, sesiones, firmas ni personas.

### Inscribir o reintentar explícitamente

`POST /api/team-enrollments`

```json
{
  "enrollmentKey": "88888888-8888-4888-8888-888888888888",
  "clubId": "11111111-1111-4111-8111-111111111111",
  "seasonId": "55555555-5555-4555-8555-555555555555",
  "categoryId": "66666666-6666-4666-8666-666666666666",
  "groupId": "77777777-7777-4777-8777-777777777777",
  "team": { "mode": "new", "name": "Morelia Juvenil" }
}
```

Para reutilizar, sustituir todo team por `{ "mode": "existing", "teamId": "teams.id" }`.
No mezclar modalidades; categoryId es categories.id, no season_categories.id.
Nombre nuevo: 1–200 caracteres tras trim; el servidor genera el folio TEAM-UUID.

201 al crear; 200 al recuperar idéntica intención. La respuesta conserva
`{ id, teamId, clubId, seasonId, categoryId, groupId, status, replayed }`.
replayed=true en recuperación. El estado es el vigente, no una orden de activación.
La misma clave y contenido distinto produce 409 IDEMPOTENCY_CONFLICT.
Una clave cancelada produce 409 OPERATION_CANCELLED. No cambiar la clave para
sortear una respuesta incierta: dos claves new representan dos equipos distintos.

### Consultar resultado sin escribir

`GET /api/team-enrollments/operations/{enrollmentKey}?clubId=UUID`

READ vigente del club y actor autenticado. La clave es privada por actor: otra
persona del mismo club no obtiene ese resultado. Ejemplo:

```json
{
  "enrollmentKey": "88888888-8888-4888-8888-888888888888",
  "clubId": "11111111-1111-4111-8111-111111111111",
  "outcome": "UNRESOLVED",
  "enrollment": null
}
```

- CONFIRMED: enrollment contiene el resultado con replayed=true.
- CANCELLED: enrollment=null; la cancelación persistida impide un POST tardío.
- UNRESOLVED: enrollment=null; no consta aún un resultado definitivo. **No prueba
  que una petición en vuelo o tardía no pueda aplicarse.**

La consulta solo lee y toma el bloqueo transaccional de la clave. No crea una
operación ni una inscripción. Un listado vacío, 404 o recarga no son cancelación.

### Cancelar la intención

`POST /api/team-enrollments/operations/{enrollmentKey}/cancel`

Recibe el mismo cuerpo normalizado del POST, incluida la misma clave (debe coincidir
con la ruta). Usa READ del club para permitir recuperar/detener la intención propia
si se retiró CREATE. No concede permiso para inscribir ni modifica equipos.

Devuelve 200 con la forma de consulta anterior:

- CANCELLED: marca definitiva creada o recuperada. Cualquier POST posterior con
  esa clave se rechaza, aunque la petición se hubiera enviado antes y llegue tarde.
- CONFIRMED: la inscripción ganó; se devuelve y se conserva. Cancelar la captura
  no la elimina, no la da de baja ni agrega otro evento de inscripción.

Se serializa por `(actor, enrollmentKey)` con el mismo advisory lock que POST.
Si la inscripción falla y revierte, cancelar puede ganar después. Si cancelar
falla o su acuse se pierde, conservar el pendiente y volver a consultar/cancelar.
Cambiar el contenido de una clave persistida mantiene el conflicto.

## Procedimiento del cliente, pendiente de conectar a las vistas de Nick

`createEnrollmentRecovery(actorId, localStorage)` en
`src/features/clubs/team-enrollment-recovery.client.ts` es un adaptador reutilizable,
no una pantalla nueva. Al recibir PDGLD-63 se debe integrar con su controlador:

1. Normalizar captura y generar una única enrollmentKey para la intención.
2. `remember(input)` antes de enviar. Si falla el almacenamiento, no enviar.
3. `retry(input)` solo ante envío/reintento explícito; siempre mismo cuerpo y clave.
4. Red perdida, timeout, 503, 401/403, conflicto o acuse inválido conservan el
   pendiente. Mostrar el motivo seguro, acceso/reconsulta y cancelación explícita;
   no anunciar fracaso definitivo ni crear otra intención para ocultar el problema.
5. Al recargar, crear el adaptador con el ID de la sesión vigente y ejecutar
   `pending(clubId)`. `check(input)` hace únicamente GET. UNRESOLVED conserva el bloqueo.
6. `abandon(input)` abandona edición conservando la recuperación. `cancel(input)`
   pide cancelación persistente. Deshabilitar nuevos envíos mientras el resultado
   siga incierto. No borrar almacenamiento como forma de cancelar.
7. Solo un acuse válido CONFIRMED/CANCELLED limpia el pendiente correspondiente.
   Si pendingCleanup=true, el resultado es definitivo pero falló la limpieza local:
   mostrarlo y volver a consultar para limpiar; no reenviar con otra clave.

Almacena únicamente versión, clave, club/temporada/categoría/grupo y equipo (ID o
nombre necesario para reintentar). Claves de almacenamiento separadas por usuario,
club y operación; conserva varios pendientes sin sobrescribirlos. Sin contraseña,
token, cookie, sesión, firmas ni datos de personas. Al cambiar de usuario, retirar
su presentación y reconstruir el adaptador para la nueva sesión; no borrar una
operación incierta del usuario anterior. No hay caducidad automática del pendiente.

La UI también debe conservar su navegación, foco y accesibilidad existentes y
reemplazar cualquier bloqueo local anterior por este procedimiento. La recepción
y adaptación de las 55 pruebas de Nick siguen pendientes; estas nueve pruebas del
adaptador no se presentan como validación de sus vistas.

## Categorías: contrato real recibido de Checo

GET `/api/affiliations/{id}` devuelve categoryOptions y version. Secretaría envía
PATCH `/api/affiliations/{id}/review` con `{ decision: "APPROVE",
expectedVersion: detalle.version, authorizedCategoryIds: [categoría seleccionada] }`.
El servidor valida selección no vacía de las solicitadas, permiso/ámbito/versión,
registra responsable/fecha y audita junto con la aprobación. Inscripción consume
esas marcas; ninguna migración autoriza categorías ni se aprueban implícitamente
todas las solicitadas. Categoría no elegida mantiene CATEGORY_NOT_AUTHORIZED.
Ver [evidencia de Checo](../validation/PDGLD-60-autorizacion-categorias.md).

## Persistencia, migraciones y producción

La migración compartida `20261025010000_pdgld62_team_enrollment` permanece intacta.
La nueva `20261026010000_pdgld64_enrollment_operations` agrega una tabla de resultados
finales y la unicidad `(actor_id, enrollment_key)`. Guarda huella SHA-256, club,
resultado, vínculo opcional a inscripción y fecha, sin copiar cuerpos completos.
Migra claves previamente confirmadas desde season_teams sin cambiar sus registros,
categorías ni auditoría. Las filas legadas sin metadatos siguen sin clave inventada.

Las operaciones son inmutables; no se actualizan ni eliminan para reutilizar una
clave. No purgar marcas CANCELLED: una petición tardía podría volver a aplicarse.
Crear equipo, inscripción, evento mínimo y resultado CONFIRMED es ACID. Cancelar
crea solo su marca y un evento TEAM_ENROLLMENT_CANCEL sin nombre, clave ni huella;
repetirlo no duplica eventos. UNIQUE y FK de inscripción conservan duplicados/ámbito.

Para recibir en Docker local: verificar primero el destino y ejecutar
`prisma migrate deploy` y `prisma generate`, conforme a [migraciones](../migraciones.md).
Esta validación reconstruye bases desechables; no actualiza gestor_ligas_dev ni Supabase.

La tabla nueva revoca PUBLIC; con los cinco marcadores de Supabase habilita RLS y
revoca anon/authenticated/service_role, sin políticas de clientes. Marcadores
parciales abortan antes de crear objetos; Docker conserva RLS deshabilitado.
Se requiere revisar ACL/políticas para el rol Prisma de servidor con privilegio
mínimo, sin conceder acceso a roles de API ni BYPASSRLS para resolverlo.
**El CD conserva su bloqueo a esta creación de tabla hasta aprobar el plan de
producción**; no se amplió su excepción por checksum. No desplegar esta entrega
mediante un bypass del control. Las pruebas simulan RLS/ACL solo en PostgreSQL local.

## Errores y alcance de aceptación

Errores `{ code }` sin SQL/conexiones/captura. Se conservan 401 UNAUTHENTICATED,
403 PASSWORD_CHANGE_REQUIRED/FORBIDDEN/INVALID_ORIGIN, 400 VALIDATION_ERROR/
INVALID_CONTEXT/INVALID_PAYLOAD, 413 PAYLOAD_TOO_LARGE, 409 AFFILIATION_NOT_APPROVED/
CATEGORY_NOT_AUTHORIZED/SEASON_CLOSED/TEAM_ALREADY_ENROLLED/IDEMPOTENCY_CONFLICT,
503 SERVICE_UNAVAILABLE. Se agrega 409 OPERATION_CANCELLED; consultar el resultado
para obtener el acuse definitivo antes de retirar el pendiente del cliente.

La prueba HTTP real cubre solicitud → aprobación/autorización explícita → inscripción,
recuperación/cancelación, concurrencia e historial. Usa firmas sintéticas preparadas
como fixtures y Storage aislado; no demuestra carga real de firmas ni el recorrido
completo desde la página de inscripción. ACTIVE conserva su definición de negocio
pendiente con profesor/Liga; pago/mínimo de jugadores no se agregan como reglas.
Antecedentes: [entrega original](../validation/PDGLD-62-PDGLD-64-inscripcion.md).
