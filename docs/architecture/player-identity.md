# PDGLD-13 / PDGLD-97 — Identidad e inscripción local, entrega 1

Fecha: 31 de octubre de 2026. Contrato propuesto para integrar PDGLD-14/15; requiere revisión del equipo. No declara terminadas la historia ni sus subtareas.

La [entrega 2 de Verificamex CURP](player-curp-verification.md) añade la comprobación externa separada y su registro de intentos. El alta local sigue sin hacer consultas ni aprobar deportivamente. Las vistas de PDGLD-98 continúan pendientes.

## Alcance implementado

`features/players/server/service.ts` expone `registerPlayer(input)`: obtiene la sesión operativa de NextAuth 4. El núcleo `registerPlayerForActor` es exclusivo de servidor y recibe un actor obtenido por un llamador confiable; vuelve a comprobar cuenta, permiso y ámbito en PostgreSQL dentro de la transacción. No es una Server Action ni un endpoint público. Todavía no hay pantallas ni rutas nuevas; corresponden a PDGLD-98.

Entrada estricta: `{ seasonTeamId, identity: { curp, firstName, paternalSurname, maternalSurname?, birthDate } }`. La fecha es `AAAA-MM-DD`. No admite usuario, club, liga, categoría, temporada, estado, excepción de edad ni bandera de verificación enviados por el navegador. Los permisos se comprueban sobre el equipo inscrito y sus relaciones reales. Se comprueban club/liga activos, afiliación aprobada, categoría autorizada y temporada/equipo disponibles.

Cada alta nueva guarda Persona e inscripción como una sola operación ACID, con estado deportivo `INELIGIBLE`. Este estado significa que la captura aún no está habilitada para jugar; no se ha aprobado expediente, edad ni verificación externa. `authorized_by` permanece vacío. PDGLD-14/15 deben definir las condiciones de aprobación sin reinterpretar la captura como elegibilidad. No se ofrece aprobación en esta entrega.

## Contrato para expediente y elegibilidad

`getPlayerRegistrationContext(registrationId)` autentica y autoriza antes de devolver los datos mínimos:

| Campo | Relación real |
| --- | --- |
| `personId` | `people.id`, identidad reutilizable |
| `registrationId` | `player_registrations.id`, expediente por inscripción |
| `seasonTeamId` | `season_teams.id`, equipo inscrito |
| `teamId`, `clubId` | Equipo y club del equipo inscrito |
| `seasonId`, `leagueId` | Temporada y liga del contexto |
| `seasonCategoryId`, `categoryId`, `groupId` | Categoría de temporada, categoría y grupo del equipo |
| `status` | Estado deportivo persistido |
| `identityReviewStatus` | `NOT_REQUIRED`, `REQUIRED` o `null` histórico sin evaluación |

El alta añade `localValidation: VALID`, `externalVerification: NOT_PERFORMED` y `replayed`. No devuelve CURP, nacimiento, nombres, expedientes candidatos ni datos de otros clubes. La lectura vuelve a evaluar coincidencias para evitar presentar como despejada una captura antigua. Un permiso `PLAYER:READ` exige además propiedad de la inscripción. Los consumidores deben reautorizar sus escrituras dentro de su propia transacción; conservar este DTO no concede permisos ni constituye un dictamen de elegibilidad.

## CURP y normalización

- Recortar extremos y convertir a mayúsculas. No retirar espacios internos ni convertir caracteres parecidos para fabricar una clave válida.
- Comprobar 18 posiciones, vocal o X en posición 2, entidad del catálogo incluido, consonantes internas, sexo H/M conforme al esquema vigente, diferenciador y dígito verificador. La tabla del algoritmo incluye Ñ en su orden, aunque la clave utiliza X en sus sustituciones.
- Comprobar fecha real, años bisiestos, fecha no futura en `America/Mexico_City` y coincidencia de `YYMMDD`. Comprobar diferenciador numérico antes de 2000 y alfabético desde 2000. No inferir siempre 19xx desde YY ni imponer una edad mínima/máxima de deporte. La validación no genera CURP a partir del nombre ni intenta resolver excepciones de nombres compuestos.
- Los nombres guardados conservan acentos; se normalizan Unicode y espacios. Para comparar coincidencias se ignoran mayúsculas, acentos y separadores. No se cambian los nombres de una identidad existente.

Referencias de conformación: [instructivo SEGOB](https://sidof.segob.gob.mx/notas/docFuente/5526717), [manual histórico de construcción](https://www.ordenjuridico.gob.mx/Federal/PE/APF/APC/SEGOB/Instructivos/InstructivoNormativo.pdf) y [catálogo de entidades de Registro Civil](https://epazoyucan.hidalgo.gob.mx/descargables/transparencia/Fracciones/2021/1er%20TRIMESTRE/19/REGISTRO/CARACTERES%20DE%20LA%20CURP.pdf). La comprobación local no acredita existencia en RENAPO ni que quien aporta los datos sea su titular. No se han enviado consultas externas.

## Reutilización y concurrencia

El índice único de CURP en Persona y `unique_player_per_season` ya existían: se conservan. La pertenencia se mantiene mientras `withdrawn_at IS NULL`, también para `INELIGIBLE` y `SUSPENDED`. No se eliminan restricciones para permitir otra alta. La unicidad existente `(person_id, season_team_id)` tampoco permite recrear una inscripción dada de baja en el mismo equipo; la reactivación es otra operación pendiente.

El servicio toma locks transaccionales de CURP y fechas vecinas en orden estable. Esto serializa altas concurrentes del servicio y la detección de coincidencias. Las restricciones PostgreSQL siguen protegiendo las escrituras de otros procesos. No hay reintentos automáticos. Un reenvío idéntico autorizado al mismo equipo devuelve la inscripción ya confirmada, con `replayed: true`; otro equipo de la misma temporada produce conflicto. La recuperación de un resultado anterior exige permisos vigentes y no vuelve a escribir ni habilita una temporada cerrada.

Para reutilizar Persona se exige identidad coincidente y acceso: identidad propia de la cuenta; historial en el mismo club con permiso de lectura; o lectura operativa global/de liga aplicable a esa identidad, además de CREATE autorizado en el destino. Un delegado de otro club no obtiene datos ni transfiere pertenencia por conocer la CURP. La respuesta `IDENTITY_UNAVAILABLE` es genérica, sin identificar persona/club/temporada ajenos. No hay buscador global por CURP.

## Posibles coincidencias y revisión pendiente

Señal inicial conservadora: nacimiento igual con hasta una inserción/eliminación/sustitución en cada nombre/apellido comparado; o diferencia de un día con nombres normalizados iguales. Si falta apellido materno se comparan los otros dos componentes. Se incluyen personas sin CURP. Una diferencia mayor o una transposición compleja puede no detectarse: esta heurística no sustituye la revisión documental. El umbral debe revisarse con Secretaría antes de ampliar producción.

Las identidades distintas se conservan separadas. La nueva inscripción recibe `identity_review_status = REQUIRED` y permanece `INELIGIBLE`. Las capturas pendientes comparables, incluso la primera de dos concurrentes y las de otros clubes, reciben solo esta señal interna de revisión; no se modifican sus identidades, estados deportivos oficiales ni temporadas cerradas. Ningún identificador de candidato llega al delegado. El CHECK de PostgreSQL impide poner una inscripción `REQUIRED` en `ACTIVE`.

Esta entrega no tiene operación para despejar una coincidencia, fusionar personas ni aprobar. PDGLD-98 debe implementar la revisión de Secretaría con `players:APPROVE`, alcance comprobado, decisión motivada y vínculo a la versión de identidad revisada. No aceptar un cambio de esta bandera desde el cliente. Los cambios futuros de identidad deben reevaluar coincidencias e invalidar comprobaciones; este servicio no edita personas existentes. Los casos históricos `null` siguen sin evaluación y no deben tratarse como identidad verificada.

La búsqueda interna consulta un intervalo de tres fechas con índice por nacimiento. Si supera 1000 candidatos devuelve `REVIEW_CAPACITY_EXCEEDED` y revierte la operación completa; nunca interpreta una colección truncada como ausencia de coincidencias. Es un límite operativo revisable, no una regla deportiva.

## Auditoría y migración

La migración `20261031010000_pdgld97_player_identity` añade una columna nullable, dos CHECK, un índice y auditoría a `player_registrations`. No crea tablas, toca RLS ni cambia migraciones compartidas. Los valores históricos permanecen `null`. El baseline no tenía `record_audit` en esa tabla: se añade una sola vez. Persona no tiene ese trigger; su alta registra un evento propio con identificador y motivo sin PII. Inscripción e historial/auditoría se revierten junto con Persona ante un fallo. No se guardan nombres/CURP en motivos o evidencias.

La ventana lunes–miércoles y la restricción de cambio de equipo tras inicio de competencia siguen siendo los triggers del baseline. Se traducen a errores comprensibles; no se añaden horarios, excepciones, reglas de edad ni políticas históricas de otra convocatoria. PDGLD-15 coordina cualquier evolución de esas reglas. La migración se prueba únicamente en bases desechables del runner; no se aplica automáticamente a la base habitual ni Supabase.

## Ampliación solicitada: foto de jugador e INE

El usuario definió el 31/10/2026 **verificación con INE y selfie mediante comparación automática de proveedor para las categorías de veteranos**. Si la imagen sale borrosa o el rostro no coincide, el caso pasa a **revisión administrativa, sin rechazar automáticamente al jugador**. Tampoco se aprueba automáticamente. La revisión exige personal autorizado y ámbito comprobado. Esta decisión sustituye la propuesta general para todos los mayores de edad: se aplica a categorías de veteranos identificadas por configuración, sin inferirlas por nombre libre o por mayoría de edad.

Queda como entrega futura vinculada a la misma Persona; la primera entrega CURP no exige fotos, INE, selfie ni biometría, ni aprovisiona Storage. La foto de registro y la selfie usada para verificación tendrán su propósito y versión explícitos; no asumir que una foto previamente subida cumple los requisitos de captura de la selfie.

Propuesta: bucket privado `player-photos`, separado de firmas, con objetos identificados por UUID sin CURP/nombres. Expediente INE en almacenamiento documental privado con permiso y retención propios. Reutilizar los patrones existentes de autorización de archivos y acceso temporal desde servidor. NextAuth no emite automáticamente un JWT de Supabase: el backend debe seguir autorizando cada acceso cuando use una clave privilegiada. [Supabase documenta buckets privados y acceso temporal](https://supabase.com/docs/guides/storage/buckets/fundamentals).

[Verificamex documenta comparar INE frontal y selfie](https://identity.docs.verificamex.com/ine-validation/compare-face/), mediante `ine_front`/`selfie` y respuesta `data.isMatch`. No se ha comprobado el contrato de cuenta, calidad mínima ni aceptación de una foto de registro frente a una selfie. Comparación facial, autenticidad/vigencia de INE y prueba de vida son resultados distintos; no presentar un match como comprobación de todos ellos. Antes de implementar, definir con el equipo las categorías configuradas de veteranos, consentimiento y tratamiento de datos, retención, acceso y condiciones de cobro de cada operación. La política humana para baja calidad o falta de coincidencia ya está definida: revisión administrativa sin rechazo automático. Los fallos técnicos no son un dictamen negativo de identidad ni aprobación deportiva; falta acordar su recuperación sin consultas automáticas que gasten créditos.

Primero se valida esta entrega; luego Verificamex CURP, después captura/revisión según las confirmaciones solicitadas. La ampliación INE tendrá alcance y pruebas propios. Por instrucción del usuario, las consultas reales a las API de CURP e INE las ejecutan exclusivamente Víctor o sus compañeros humanos; los agentes solo usan transporte simulado y respuestas sintéticas. Disponer de credenciales no autoriza a un agente a consumir consultas. Presupuesto informado por el usuario: 100 tokens gratuitos, 3 tokens por consulta. No se han enviado imágenes ni consumido consultas reales.
