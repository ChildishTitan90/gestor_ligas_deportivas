# Acreditación de candidatos a árbitro — PDGLD-86 / PDGLD-141

14/11/2026. La cédula aquí acredita al candidato; no es la cédula de un partido
de PDGLD-18/19. No se verifica con CURP, INE ni un proveedor de licencias. La
validación de su contenido corresponde a Comisión.

## Presentación y revisión

Las presentaciones nuevas requieren un PDF, JPG o PNG de hasta 10 MB. El servidor
reutiliza `validatePrivateFileContent`: comprueba contenido real, tamaño, hash y
límites de procesamiento. El navegador envía JSON acotado y archivo mediante
multipart; el handler limita el cuerpo antes de parsearlo y verifica sesión,
actor esperado y origen. Ni la extensión ni el selector autorizan una carga.

Comisión consulta la vista previa y confirma la revisión antes de incorporar.
El servicio exige la cédula y su SHA-256 vigente, además de todos los permisos
RF22 y controles de identidad existentes. El hash revisado queda en la captura
inmutable `approved_identity.credentialSha256`. Un trigger impide incorporar
pendientes sin esa evidencia también mediante SQL.

Las incorporaciones anteriores conservan su estado y sus referencias. Si no
tienen evidencia adjunta se muestran como antecedente sin cédula. Un pendiente
antiguo admite **Adjuntar cédula arbitral** por su club autorizado: no cambia los
datos originales ni permite sustituir un documento existente. Una corrección
requiere no incorporar y presentar una nueva solicitud, conservando la anterior.
No se exige otro documento a una designación ni se retiran protecciones históricas.

## Storage y transacciones

Se reutilizó el transporte de expedientes como utilidad de servidor compartida,
conservando el adaptador y contratos públicos de jugadores. El bucket exclusivo
es **acreditaciones-arbitros**, privado, con límite exacto 10485760 y solo
`application/pdf`, `image/jpeg`, `image/png`. El adaptador rechaza configuración
divergente y no permite `upsert` ni rutas proporcionadas por el cliente.

Prefijo generado después de autorizar:

`referee-credentials/v1/<league>/<season>/<club>/<actor>/<operationKey>`

Las claves no incluyen nombres ni otros datos personales. La preparación deja un
acuse privado `REFEREE_CREDENTIAL_PREPARED` con hash del comando y metadatos.
Storage se escribe y relee fuera de transacciones PostgreSQL. Después de verificar
su contenido se vuelve a autorizar y se guardan juntos presentación, referencia
`files` y vínculo documental. No se mantiene una transacción durante la red.

Una respuesta perdida conserva la operación y permite consultar sin reenviar.
Reintentar usa la misma clave, contenido y versión: una colisión en Storage solo
se recupera si los bytes son idénticos. En sessionStorage se guardan metadatos,
no el archivo, su nombre original ni URLs firmadas. Tras recargar se pide volver
a seleccionar el mismo documento si el acuse todavía no existe. No hay reenvío
automático. Si Storage confirma pero falla la vinculación, se conserva el objeto
y su intención para recuperar la operación; no se elimina durante la incertidumbre.

La limpieza de objetos no vinculados requiere un plazo de retención acordado y
revisar los acuses antes de borrar. No se implementa un borrado automático ni se
declara resuelta esa política de producción en esta entrega.

## Lectura y vista previa

`POST /api/referee-presentations/[presentationId]/credential` autoriza el
club/temporada por concesiones actuales de presentación o revisión. Conocer un
UUID no concede acceso. Se verifica el objeto contra el hash guardado y se
revalida autorización después de la red antes de devolver el acceso temporal.

El visor compartido usa una URL firmada de 60 segundos, descarga temporal a Blob,
no inicia una descarga a disco y retira su copia al cerrar o vencer. No guarda
contenido en caché compartida ni IndexedDB. Una URL ya emitida puede permanecer
vigente hasta esos 60 segundos; una consulta nueva siempre vuelve a autorizar.
Se conservan foco, teclado, imagen/PDF, móvil y ambos temas de los expedientes.

## Plan de seguridad y estado de entornos

La migración aditiva `20261114060000_pdgld141_referee_credentials` crea únicamente
`referee_presentation_credentials`, con FK a presentación, archivo y actor,
unicidad de archivo y operación por actor. Documento y metadatos referenciados
son inmutables. Se audita el vínculo, sin duplicar bytes en auditoría.

La tabla revoca PUBLIC y los roles API. Habilita RLS si existe el esquema `auth`
de Supabase; Docker conserva la decisión vigente de no habilitarlo. El plan de
producción incluye el checksum exacto y exige verificar RLS/ACL antes de liberar.
Preview incorpora SELECT e INSERT explícito en esa tabla, sin UPDATE, DELETE ni
TRUNCATE; usa las concesiones mínimas existentes de `files`. La autorización RF22
permanece en servidor incluso cuando la conexión es propietaria.

Por autorización explícita del usuario se crearon y verificaron los buckets de
**pruebas y producción**, sin cambiar RLS ni políticas ni subir documentos a
producción. Solo se aplicó la migración de negocio en Docker. No se ejecutaron
migraciones compartidas, despliegues ni concesiones remotas de Preview. Antes de
liberar deberán aplicarse por el flujo de CI/CD y comprobar también que ninguna
política amplia preexistente de `storage.objects` exponga el bucket. La creación
del bucket privado por la API no constituye una auditoría SQL de esas políticas.

La aplicación local usa exclusivamente Storage de pruebas. Variables del servidor:
`SUPABASE_URL`, `SUPABASE_STORAGE_SERVER_KEY` y
`SUPABASE_REFEREE_CREDENTIALS_BUCKET=acreditaciones-arbitros`. En un despliegue de
producción deben pertenecer al proyecto de producción; nunca usar NEXT_PUBLIC_.
El comando explícito de infraestructura verifica el proyecto contra el entorno:

`node scripts/configure-referee-storage.mjs --environment pruebas|produccion --config <archivo-privado>`

El comando solo crea/configura ese bucket; no publica código ni migra tablas.

Referencias: [buckets privados](https://supabase.com/docs/guides/storage/buckets/fundamentals)
y [creación y límites de bucket](https://supabase.com/docs/reference/javascript/storage-createbucket).
