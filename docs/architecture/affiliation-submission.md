# Solicitud de afiliación — PDGLD-57

## Alcance y contrato

RF01.1–RF01.5 y HU01-01 (PDGLD-10): servicio de alta y POST
`/api/affiliations`. PDGLD-59 conecta el formulario PDGLD-58 con firmas privadas,
selección de contexto y envío desde `/affiliations/new`; ver affiliation-signatures.md.
PDGLD-60 integra aprobación/correcciones; ver affiliation-review.md. No se crea una cuenta ni un club,
no se modifica el estado operativo del club y no se inscriben equipos.

El cuerpo JSON es `affiliationSubmissionSchema`, en
`src/features/clubs/affiliation-submission.ts`:

```json
{
  "submissionKey": "UUID estable para este envío",
  "clubId": "clubs.id autorizado",
  "seasonId": "seasons.id de la misma liga",
  "clubName": "Nombre capturado en el tarjetón de esta temporada",
  "uniformColors": "Colores capturados",
  "categoryIds": ["categories.id habilitado en season_categories"],
  "officers": {
    "PRESIDENT": { "firstName": "Nombre", "paternalSurname": "Apellido", "maternalSurname": "", "signatureFileId": "files.id" },
    "SECRETARY": { "firstName": "Nombre", "paternalSurname": "Apellido", "maternalSurname": "", "signatureFileId": "files.id" },
    "TREASURER": { "firstName": "Nombre", "paternalSurname": "Apellido", "maternalSurname": "", "signatureFileId": "files.id" }
  }
}
```

Los marcadores anteriores describen el contrato: las referencias deben ser UUID
reales. Los UUID se normalizan a minúsculas antes de detectar duplicados.
Se admiten 1–100 categorías distintas, nombre/colores hasta 200 caracteres y
nombres de directivos hasta 120 por campo. Esos son límites técnicos del endpoint,
no nuevos requisitos reglamentarios. JSON máximo: 64 KiB.

201: `{ id, referenceNumber, status: "PENDING", replayed: false }`.
Un reintento idéntico devuelve 200, mismo id/folio y `replayed: true`.
El estado del resultado es el vigente si la solicitud ya fue revisada.
Respuesta privada, `no-store`, sin nombres de personas, URLs o metadatos de firmas.
Errores: 401 `UNAUTHENTICATED`; 403 `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN` o
`INVALID_ORIGIN`; 400 `INVALID_PAYLOAD`, `VALIDATION_ERROR`, `INVALID_CONTEXT` o
`INVALID_SIGNATURE`; 409 `SEASON_CLOSED`, `AFFILIATION_EXISTS` o
`IDEMPOTENCY_CONFLICT`; 413 `PAYLOAD_TOO_LARGE`; 503 `SERVICE_UNAVAILABLE`.
Un error inesperado no devuelve ni registra SQL, contenido del cuerpo o secretos.

## Autorización y firmas

La identidad procede de `requireOperationalUser`, nunca del JSON. El servicio
exige `clubs:CREATE` vigente en la asignación `CLUB_DELEGATE` del club indicado.
No une el permiso de un rol con el alcance de otro. Consulta las concesiones en
base y usa el bloqueo compartido de autorización de PDGLD-54, por lo que una
revocación se aplica también a un reenvío con la misma sesión.

El club es un registro inicial previamente vinculado al delegado mediante
HU22-01. Liga, club activo, temporada de esa liga y categorías del mismo deporte
se verifican en servidor y dentro de la transacción. La autorización inicial se
solicita por club, sin `seasonId`: el contexto club+temporada del motor común
presupone una afiliación existente y no sirve para su primer registro. No se
modifica esa regla compartida. Una temporada cerrada impide escrituras nuevas;
recuperar un resultado ya confirmado no altera la temporada.

Cada cargo exige `signatureFileId`. Se comprueba la existencia del archivo,
`uploaded_by` igual al actor, tamaño de 1 byte a 10 MiB, SHA-256 registrado y MIME
PNG/JPEG/PDF. No se aceptan URLs, contenido binario ni archivos de otro usuario.
Estos controles validan referencias y metadatos; no inspeccionan el contenido ni
prueban por sí mismos que el objeto esté en un bucket privado.

PDGLD-59 debe registrar esos metadatos después de validar contenido/tamaño/tipo
real y completar la carga en almacenamiento privado. Debe autorizar cargas y
descargas, comprobar el ámbito del documento, no exponer claves/URLs permanentes
y gestionar archivos huérfanos si falla el envío. No habilitar envío real con
firmas ficticias o ausentes. Las pruebas PDGLD-57 usan exclusivamente registros
sintéticos en una base desechable, sin subir archivos a Supabase.

## Atomicidad, historial e idempotencia

Una transacción crea afiliación, categorías solicitadas, tres registros de
personas/directivos y un evento de auditoría. Si cualquier escritura falla se
revierte todo; las cargas de objetos, externas a PostgreSQL, no se incluyen en
esa garantía. Se usa `AFL-` más UUID aleatorio para el folio; su restricción UNIQUE
es la garantía final, sin contadores en memoria ni `max()+1`.

La clave de reintento es única por solicitante. Una huella SHA-256 canónica
compara la captura normalizada; el orden de categorías no cambia el envío.
No se devuelve ni copia la huella a auditoría. Misma clave con otros datos es
409; claves distintas para el mismo club/temporada también son 409. Se serializan
ambos casos con bloqueos transaccionales advisory y se conservan las restricciones
UNIQUE del folio y `(club_id, season_id)`. Un reenvío no crea otra persona ni otro
evento. La UI debe mantener la clave y los datos ante un fallo de red/503 y no
crear una clave nueva automáticamente; una corrección posterior tendrá su propio
contrato en PDGLD-60.

`club_name` conserva el nombre capturado en esa temporada; no sobrescribe
`clubs.name` ni datos de temporadas anteriores. Las personas de los directivos
se capturan para esta solicitud: no se deduplican por nombre ni se vinculan a
identidades reales por suposición. `club_officers.starts_at` usa el inicio de la
temporada como vigencia inicial del registro anual, no como prueba de fecha real
de nombramiento. Cambios de directiva posteriores pertenecen a RF21.

El baseline no tiene trigger de auditoría en `club_affiliations` ni `club_officers`.
Se registra un evento del agregado en `audit_logs`, con actor, estado y vínculos
técnicos, sin nombres, firmas o credenciales. Su trigger de inmutabilidad se
conserva. No se cambia ni duplica la auditoría de otros módulos.

## Migración y entrega

`20261021170000_pdgld57_affiliation_submission` agrega columnas opcionales de
captura/reintento para conservar filas antiguas. Agrega
`club_affiliation_categories`, con dos claves foráneas compuestas que exigen la
misma temporada de la afiliación y de la categoría configurada. Son intenciones
de participación, no `season_teams`; aprobación e inscripción son procesos aparte.
Incluye protección de temporada cerrada y revocación de acceso directo a PUBLIC,
anon/authenticated si existen. No modifica `0_init` ni activa RLS en Docker.

Antes de distribuir: aplicar las migraciones revisadas con `prisma migrate deploy`
y regenerar cliente; nunca `db push` o reset. Los datos demo existentes ya tienen
afiliaciones para ambos clubes: no borrarlas para probar el alta; utilizar los
fixtures aislados o una temporada de pruebas nueva.

Producción requiere la revisión de seguridad descrita en
`docs/architecture/affiliation-submission-security.md`. El guard de despliegue
existente detiene CREATE TABLE: se conserva y no se marca el riesgo aceptado.
No ejecutar esta migración en Supabase por instalar el backend local.

## Comprobaciones

- `npm run test:affiliation-input`: contrato de envío y captura PDGLD-58.
- `npm run test:affiliations`: migra una base temporal local, compara esquema,
  inicia Next y prueba el endpoint real, autorización, firmas, folio, concurrencia,
  reenvíos, rollback y FK. El runner elimina su base temporal al finalizar.
- `npm run test:auth`: incluye la nueva suite tras las existentes; CI la ejecuta
  en PostgreSQL 15/17. Las pruebas puras también se incorporan al job de aplicación.
- Lint, typecheck, build, guard de migraciones y comprobación final contra develop.

La implementación de servidor queda para revisión independiente; no equivale a
dar por terminada HU01-01. Faltan PDGLD-59, aceptación del flujo completo y entorno
de pruebas con las migraciones revisadas.
