# PDGLD-59: firmas privadas de afiliación

Integración con PDGLD-60, 24/10/2026: el PR #26 se incorporó desde develop.
La evidencia y los pendientes de esta integración se mantienen en
[PDGLD-60](../validation/PDGLD-60-integracion-afiliaciones.md); los resultados
de entrega de PDGLD-59 que figuran abajo corresponden a su revisión original.

## Flujo implementado

La página `/affiliations/new` obtiene desde el servidor los clubes,
temporadas y categorías disponibles para el delegado autenticado.

Cada firma sigue tres pasos:

1. Preparar la carga comprobando sesión NextAuth, permiso clubs:CREATE,
   asignación de delegado, club y temporada.
2. Subir el archivo al bucket privado mediante una URL firmada.
3. Confirmar sus bytes y registrar los metadatos en files.

La confirmación devuelve signatureFileId únicamente después de validar
el archivo y comprobar nuevamente la autorización.

Para una corrección, el servidor deriva el modo de club_affiliations. Una solicitud
PENDING con observaciones exige clubs:UPDATE, la asignación de delegado del club y
el solicitante original. Un contexto nuevo sigue exigiendo CREATE. La preparación
y las dos comprobaciones de confirmación usan esa misma regla y detectan revocaciones.
El cliente no elige la acción de permiso. El reenvío vuelve a validar la vinculación
de cada firma con propietario, club, temporada y cargo.

El formulario requiere las firmas de PRESIDENT, SECRETARY y TREASURER.
Al enviar, el servidor comprueba propietario, club, temporada y cargo
de cada archivo.

## Endpoints

- POST /api/affiliations/signatures/prepare
- POST /api/affiliations/signatures/confirm
- POST /api/affiliations/signatures/download

La consulta de descarga exige sesión operativa y clubs:READ en el
contexto real del archivo. Conocer su identificador no concede acceso.

## Archivos y almacenamiento

- Bucket privado: firmas-afiliacion.
- Tipos admitidos: image/png, image/jpeg y application/pdf.
- Tamaño máximo: 10485760 bytes, equivalentes a 10 MiB.
- Se comprueba el contenido real, no únicamente la extensión.
- Se registra tamaño, MIME, SHA-256, propietario y clave de almacenamiento.
- Los nombres almacenados se generan en el servidor.
- Las cargas no sobrescriben objetos existentes.

Un objeto recién subido todavía no es un archivo confirmado.
La aplicación no permite consultarlo por identificador hasta que
exista su registro autorizado en PostgreSQL.

## Configuración del servidor

Variables necesarias:

- SUPABASE_URL
- SUPABASE_STORAGE_SERVER_KEY
- SUPABASE_SIGNATURES_BUCKET

La credencial permanece exclusivamente en el servidor.
No debe utilizar el prefijo NEXT_PUBLIC_ ni incluirse en Git.
Las variables se documentan como marcadores en `.env.example`. El valor de la
clave debe copiarse completo, en una sola línea y sin espacios internos.

NextAuth continúa autenticando a los usuarios. Supabase Storage
no sustituye las comprobaciones de permisos de la aplicación.

## Vigencias y reintentos

El comprobante de confirmación dura 15 minutos.
La URL de carga de Supabase tiene su propia vigencia de dos horas.

Los enlaces de descarga duran 60 segundos. Una revocación impide
generar nuevos enlaces; un enlace ya emitido puede funcionar hasta
su vencimiento.

El cliente conserva la tarea de carga para reintentar una confirmación
sin repetir una subida ya completada.

El formulario conserva submissionKey y los mismos datos ante un
resultado de envío no confirmado. Los datos se mantienen en memoria
mientras la pantalla permanezca abierta.

## Validación ejecutada localmente

- Typecheck: aprobado.
- ESLint: aprobado.
- Build de producción: aprobado.
- Pruebas específicas de firmas y envío: 39 aprobadas.
- Suite de afiliación: 15 aprobadas.
- Runner de autorización: bloques de 39 y 49 pruebas aprobados.

Las pruebas específicas incluyen validación real de PNG, JPEG y PDF,
comprobantes, asociación de contexto y comportamiento del cliente.
Las pruebas del transporte cliente utilizan respuestas simuladas.

Las pruebas HTTP de afiliación utilizan PostgreSQL local temporal
y comprueban rechazo de firmas de otro cargo, temporada o club.

También se comprobó manualmente:

- Carga y confirmación contra Supabase de pruebas.
- Generación de enlace con el delegado A.
- Rechazo 403 al consultar el mismo archivo con el delegado B.
- Envío desde el formulario con tres firmas y obtención de folio.

Estos resultados no equivalen a una validación en producción.

## Preparación de datos sintéticos

scripts/prepare-signature-demo.ts crea una temporada y una categoría
nuevas para pruebas locales. Rechaza destinos remotos y conserva los
permisos existentes. Cada ejecución crea un contexto diferente.

## Pendientes de entrega

- Limpieza realizada: se eliminó el objeto sintético sin confirmar
  cfe57d2a-74d5-467f-8b40-1bed7df586b2, después de comprobar
  que no tenía registro en PostgreSQL. Se conservaron los archivos registrados.
- Las 39 pruebas específicas quedan conectadas al trabajo app del CI
  mediante npm run test:signatures. Su ejecución en GitHub está
  pendiente de publicar y validar el PR.
- Revisión del PR por otro integrante del equipo.

PostgreSQL y Storage no comparten una transacción. No se ha
implementado un proceso automático de limpieza de cargas abandonadas.
