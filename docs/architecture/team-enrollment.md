# Inscripción de equipos — PDGLD-62 / contrato para PDGLD-63

## Alcance confirmado y dependencias

Revisados PDGLD-12, PDGLD-62, PDGLD-64 y PDGLD-11 en Jira el 24/10/2026.
Un delegado inscribe equipos de su club; cada equipo conserva su identidad en
`teams` y cada participación anual tiene su propio `season_teams.id`. Varias
participaciones del club son válidas; dos participaciones del mismo equipo en la
misma temporada no lo son, incluso con categorías o grupos diferentes.

Se implementan inscripción `REGISTERED` (texto de interfaz **INSCRITO**), opciones
y consulta. No se implementan las pantallas de PDGLD-63, ni aprobación de
afiliación, activación de equipos, finanzas, jugadores o franquicias.

En `origin/develop` revisado, PDGLD-60 no expone servicio/endpoint real de
aprobación. La bandeja de PDGLD-61 tiene un adaptador separado; su presencia y el
estado de Jira no demuestran que el backend de aprobación esté integrado.

## Categorías solicitadas y autorizadas

`club_affiliation_categories` conservaba únicamente la solicitud. Se agregan
`authorized_by` y `authorized_at`, ambos opcionales y obligatoriamente juntos.
**No se autoriza ninguna fila por migración ni por aprobar el estado global.**
El servicio exige afiliación `APPROVED` y autorización explícita de la categoría
de esa temporada. `clubs.status=ACTIVE` es una condición operativa de alcance,
no una aprobación.

Este es el contrato de persistencia propuesto para integrar PDGLD-60: su operación
real debe comprobar Secretaría, `clubs:APPROVE`, alcance y categorías elegidas;
registrar responsable/fecha de las autorizadas y auditar el conjunto en su
transacción. Esta entrega solo **consume** esas marcas; no proporciona un camino
para establecerlas. Las solicitudes existentes permanecen sin autorización hasta
su revisión explícita. La compatibilidad debe validarse con la implementación de
PDGLD-60 antes de dar el flujo por integrado.

## HTTP para Nick

Sesión NextAuth 4 operativa, respuesta JSON y `Cache-Control: private, no-store` en
todas las rutas. Nunca conservar resultados privados en caché compartida. Las
escrituras requieren `Origin` igual al origen de `NEXTAUTH_URL`, no cross-site,
`Content-Type: application/json` y cuerpo de hasta 8 KiB.

### Opciones

`GET /api/team-enrollments/options` devuelve:

```json
{ "clubs": [{ "id": "clubs.id", "name": "Club", "leagueId": "leagues.id" }],
  "teams": [], "seasons": [], "categories": [], "groups": [] }
```

Requiere `clubs:CREATE` y `clubs:READ` en la misma asignación vigente
`CLUB_DELEGATE`, con club concreto. No combina rol de un club con permiso de otro.

Agregar `?clubId=<UUID>` carga equipos y temporadas de fútbol de esa liga que no
estén cerradas. Agregar también `&seasonId=<UUID>` carga categorías autorizadas y
sus grupos. Sin afiliación aprobada, con categoría solo solicitada o con temporada
cerrada, esas opciones están vacías. Una temporada de otra liga es error.

Las estructuras de las listas son:

- `teams`: `{ id: teams.id, clubId, name, referenceNumber, enrolledSeasonIds: UUID[] }`.
- `seasons`: `{ id: seasons.id, name, status }`.
- `categories`: `{ id: categories.id, seasonCategoryId: season_categories.id, seasonId, name }`.
- `groups`: `{ id: groups.id, name, categoryId: categories.id, seasonId }`.

La UI excluye equipos con la temporada seleccionada en `enrolledSeasonIds`. El
servidor vuelve a comprobar todos los vínculos al enviar. Las opciones de un club
ajeno son 403. Cambiar club/temporada exige recargar las opciones dependientes.

### Inscribir

`POST /api/team-enrollments`:

```json
{
  "enrollmentKey": "UUID estable generado para este envío",
  "clubId": "clubs.id",
  "seasonId": "seasons.id",
  "categoryId": "categories.id; no season_categories.id",
  "groupId": "groups.id",
  "team": { "mode": "existing", "teamId": "teams.id; no season_teams.id" }
}
```

Para equipo nuevo, sustituir **todo** `team` por
`{ "mode": "new", "name": "Nombre del equipo" }`. Nombre de 1–200 caracteres
tras recortar espacios; límite técnico, no reglamentario. No se admiten campos de
ambas modalidades juntos. El servidor genera `teams.id` y su folio `TEAM-<UUID>`;
no deduplica equipos por nombre. Para otra temporada se reutiliza el `teamId`
devuelto, eligiendo `existing`; no reenviar `new` para representar el mismo equipo.

201 al crear; 200 al recuperar un envío idéntico:

```json
{ "id": "season_teams.id", "teamId": "teams.id", "clubId": "clubs.id",
  "seasonId": "seasons.id", "categoryId": "categories.id", "groupId": "groups.id",
  "status": "REGISTERED", "replayed": false }
```

`replayed` es `true` en 200. El estado devuelto es el vigente del registro; no es
una orden de cambiarlo. Nunca enviar estado, actor, aprobador, folio ni liga como
campos de autoridad: el contrato estricto los rechaza. `clubId` es una selección
que se comprueba contra la asignación del servidor, no autoridad del cliente.

Conservar clave y captura normalizada ante red incierta/503 hasta recuperar el
resultado. Una misma clave con otros datos da 409. Una nueva intención usa otra
clave; dos claves distintas con `new` representan equipos distintos aunque el
nombre sea igual. La UI debe mantener el mismo envío para todos sus reintentos.
La protección persiste en PostgreSQL y funciona entre procesos/reinicios.

### Consultar

`GET /api/team-enrollments?clubId=<UUID>` exige `clubs:READ` vigente para ese club;
permite roles administrativos cuyo permiso cubra el contexto. Filtros opcionales:
`seasonId`, `limit` (1–100, predeterminado 50) y `after` (último id de la página).
Orden por UUID ascendente, paginación estable sin contar datos de otros clubes.
Incluye historial de temporadas cerradas; no depende de afiliación aprobada actual.

Respuesta `{ items, nextAfter }`; `nextAfter` es `null` al terminar. Cada elemento:
`{ id, teamId, teamName, teamReferenceNumber, clubId, seasonId, categoryId,
categoryName, groupId, groupName, status }`. Solo DTOs mínimos; no huellas,
claves de reintento, actores, firmas, sesiones ni datos de personas.

### Errores

Siempre `{ "code": "CODIGO" }`, sin SQL, conexiones ni contenido de la captura.
Parámetros desconocidos o repetidos en GET se rechazan.

| HTTP | code | Tratamiento de UI |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Solicitar acceso |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Completar cambio de contraseña |
| 403 | `FORBIDDEN` | Sin permiso o club fuera del alcance |
| 403 | `INVALID_ORIGIN` | Revisar origen del envío |
| 400 | `INVALID_PAYLOAD`, `VALIDATION_ERROR` | Corregir captura/formato |
| 400 | `INVALID_CONTEXT` | Recargar equipos, temporada, categorías y grupos |
| 409 | `AFFILIATION_NOT_APPROVED` | Esperar revisión real de afiliación |
| 409 | `CATEGORY_NOT_AUTHORIZED` | Categoría sin autorización explícita |
| 409 | `SEASON_CLOSED` | No permite inscripción nueva |
| 409 | `TEAM_ALREADY_ENROLLED` | Mostrar inscripción existente; no cambiar grupo |
| 409 | `IDEMPOTENCY_CONFLICT` | No reutilizar clave para otra intención |
| 413 | `PAYLOAD_TOO_LARGE` | Reducir cuerpo al contrato |
| 503 | `SERVICE_UNAVAILABLE` | Conservar captura y clave para reintentar |

## Transacción, concurrencia, auditoría y migración

La autenticación consulta la sesión real. En cada transacción se reutiliza el
bloqueo compartido del motor de permisos; se exige `clubs:CREATE` de la propia
asignación de delegado. Temporada, club, categoría, afiliación, autorización y
grupo se comprueban en servidor con bloqueos de fila. El equipo debe ser del club.

Bloqueos advisory transaccionales serializan clave por actor y equipo/temporada.
Las restricciones existentes `UNIQUE(team_id,season_id)` y FK compuestas siguen
siendo la garantía final de pertenencia y duplicados. Se agrega unicidad de
`(enrolled_by,enrollment_key)` y una huella SHA-256 de la captura canónica en
`season_teams`; las filas históricas conservan esos campos nulos. No se utiliza
estado en memoria. Crear equipo, inscripción y auditoría es una sola transacción.

El baseline no tenía auditoría en `season_teams`. Un trigger nuevo registra un
evento mínimo por INSERT/UPDATE/DELETE, con actor, fecha, motivo y vínculos/estado,
sin nombre, clave ni huella. La función tiene `search_path` fijo y ejecución
pública revocada. Se conserva la inmutabilidad de `audit_logs`. No se agrega otro
evento manual ni se sobrescribe historial anual.

La migración nueva `20261025010000_pdgld62_team_enrollment` es aditiva, no crea
tablas ni modifica baseline/RLS. Para recibirla, seguir `docs/migraciones.md` con
`migrate deploy` y `generate` en Docker local. No se ha aplicado a desarrollo ni
a Supabase por esta entrega; las verificaciones usan bases desechables.

En Supabase conserva las políticas/ACL existentes de `season_teams` y
`club_affiliation_categories` (esta última sin acceso a roles API). No concede
privilegios ni cambia RLS en Docker. Deben conservarse los controles actuales del
despliegue manual y revisarse los cambios junto con PDGLD-60 antes de producción.

## Activación propuesta, sin implementar

**INSCRITO** registra la participación; **ACTIVO** habilita para competir.
La propuesta es una operación explícita por equipo de Secretaría con su permiso,
responsable, fecha y motivo. Aprobar la afiliación no activa equipos. Se proponen
afiliación aprobada en esa temporada, categoría habilitada y grupo válido como
verificaciones. Falta validar con profesor/Liga autoridad y reglas definitivas,
si pago y mínimo de jugadores son condiciones, y el alcance de las transiciones.
No hay endpoint a ACTIVE, rechazos, bajas, suspensiones ni reversibilidad nuevos.

La convocatoria local `convocatoria-liga-municipal-2024-2025-1.pdf` se consultó en
Downloads. Define fechas/cuotas/restricciones de ingreso y obligaciones de esa
temporada, incluyendo mínimo de jugadores, pero no define la transición del
sistema a ACTIVO. No se convierten esos valores en reglas universales ni se
implementan módulos adicionales. La autorización expresa de categorías permite
que la revisión de cada temporada determine qué participación está habilitada.
