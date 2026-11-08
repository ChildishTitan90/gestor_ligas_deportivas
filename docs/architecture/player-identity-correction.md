# PDGLD-117 — corrección de la misma identidad deportiva

Entrega local separada del PR #43. Decisiones de Sergio registradas en Jira,
comentario 10088. No implementa fusión, segunda afiliación ni excepciones de edad.

## Solicitud, evidencia y decisión

El operador con players UPDATE/READ en el contexto solicita una corrección con
versión vigente, motivo privado y documentos; el servidor vuelve a comprobar el
ámbito. Es la capacidad que usa el delegado, no un rol declarado por el navegador.
Secretaría usa players APPROVE/READ. No puede resolver solicitudes propias.
Antes de ver evidencia ajena o resolver, se verifica autoridad sobre todas las
referencias de Persona: inscripciones históricas/retiradas, directivos de
clubes, tutor de otros registros, nombramientos y contextos arbitrales.
Una persona compartida con cuenta o árbitro requiere autoridad global porque
el ámbito deportivo no cubre por sí solo esas referencias. Un caso fuera de
alcance se deriva sin divulgar el resto de ligas al solicitante.

CURP exige constancia; una duda de vinculación añade documento de identidad.
Nombre o nacimiento exige acta/documento rectificatorio; también constancia si
cambia CURP o Secretaría indica discrepancia. El operador comprueba suficiencia
y vinculación explícitamente. Adjuntar un archivo no equivale a verificarlo.
Se acepta una solicitud incompleta para poder devolverla con observaciones;
APPLY la rechaza, RETURN registra la devolución sin tocar el expediente.
Para menores no se añaden documentos/excepciones; acreditaciones de tutor
existentes se conservan por referencia, no se acreditan firmas nuevas.

Solicitud PENDING y devolución RETURNED no modifican Persona, documentos o
habilitación. Una devolución es terminal y permite nueva solicitud; no se edita
silenciosamente la propuesta que ya revisó otro operador. Clave de operación y
huella privada permiten consultar/repetir exactamente una intención sin otra
escritura. Revisiones obsoletas y decisiones competidoras dan conflicto.

## Privacidad y persistencia

Dos tablas nuevas privadas separan trámite/evidencia de auditoría general. La
propuesta, motivo, observaciones y estado previo a la corrección permanecen en
la tabla privada; el estado previo acredita lo observado al aplicar, NO la
identidad de una temporada pasada. Auditoría general contiene identificadores,
versión y códigos, sin nombres, CURP, nacimiento, documentos ni observaciones.

La evidencia PDF/PNG/JPEG se valida binariamente con el validador existente,
con máximo de tres archivos de 10 MiB. En esta entrega se conserva en bytea de
la tabla privada (sin replicar a Storage ni crear un proveedor), con hash e
inmutabilidad; no se conserva nombre original. Descarga autenticada, no-store,
sandbox, sin URLs públicas y con autorización reevaluada. Esto requiere revisar
capacidad, retención y respaldos privados antes de despliegue real. No se supone
que el bucket de expedientes ya autoriza estos documentos de rectificación.

La migración nueva no se ejecuta sobre bases habituales. En Supabase habilita
RLS y revoca acceso directo; no agrega políticas públicas ni concesiones a
Preview. El runtime limitado necesita su revisión de ACL y plan de producción
antes de despliegue. No se aflojan controles del pipeline.

## Aplicación e invalidación

Bloqueo RF22 exclusivo, bloqueo de la solicitud, CURP antigua/nueva y fechas
vecinas ordenadas, Persona y revisión vigente. La unicidad PostgreSQL sigue
siendo la última garantía. Se actualiza el mismo people.id; el trigger existente
incrementa identity_version. No se edita una migración previa ni se duplica Persona.

Las comprobaciones CURP/INE, resoluciones de coincidencias y documentos asociados
a la versión anterior dejan de contar mediante los lectores de versión/huella
existentes. No se borran sus filas ni archivos. Se conserva solo la acreditación
previa de tutor y su confirmación de archivo a la versión nueva, con trazabilidad
a la corrección; no se crean acreditaciones cuando no existían.

Toda inscripción ACTIVE afectada pasa a INELIGIBLE con historial. SUSPENDED y
WITHDRAWN no se reactivan. Las participaciones superiores autorizadas se invalidan
mediante la transición WITHDRAWN y el acuse exigido por el trigger actual; no se
introduce un estado PENDING con versión incompatible. Una nueva autorización
requiere origen habilitado, documentos y huella vigentes. Se ejecuta evaluación
local y se registran códigos de bloqueo; no se consulta proveedor ni se conserva
automáticamente una habilitación por CURP/nacimiento anteriores. Los POST de
verificación/revisión existentes permiten completar después la reevaluación.
Partidos, resultados, alineaciones y sanciones no se escriben.

## Historial: captura y lecturas protegidas

La migración nueva `20261108020000_pdgld117_season_identity_snapshots` captura
nombres, versión de identidad, versión de temporada y procedencia al pasar a
CLOSED. El cierre y la captura son atómicos; un fallo revierte ambos. Incluye
jugadores, directivos (también históricos), tutores y referencias arbitrales.
La captura es privada e inmutable, sin CURP, nacimiento ni documentos. No hay
backfill: people vigente no acredita la identidad de un cierre previo.

Lista de jugadores, etiquetas de expediente/participaciones y directivos de
Afiliación leen los nombres capturados. Si el cierre carece de captura, muestran
«Información histórica no disponible», sin usar people como respaldo. El
expediente cerrado no vuelve a calcular minoría, documentos ni verificaciones
sobre la identidad vigente: presenta el nombre histórico si existe y explica la
indisponibilidad del resto. Participaciones conserva estados registrados, pero
no evalúa elegibilidad actual como si fuera histórica ni ofrece autorizar o
solicitar en un cierre. Los casos abiertos mantienen su evaluación habitual.

## Barrera de corrección que sigue activa

APPLY devuelve `HISTORICAL_IDENTITY_UNAVAILABLE` si cualquier referencia con
temporada está CLOSED, **incluso con snapshot de nombres**. La captura no acredita
nacimiento, edad, documentos ni decisiones de habilitación al cierre. Levantar
esta barrera requiere definir esos hechos históricos y revisar todos sus
consumidores con el equipo. Cierres legados requieren fuentes privadas acreditadas
o indisponibilidad explícita; nunca reconstrucción desde people actual.

Solicitar, consultar y devolver siguen disponibles. La pantalla del expediente
cerrado conserva acceso al trámite de corrección; la interfaz deshabilita APPLY
con `applyBlockedCode`, y el servicio/HTTP impone la misma regla. Un trigger
`closed_person_identity` también protege UPDATE directo de los cinco campos de
identidad. Si ese trigger no está instalado y activo, el servicio devuelve
`HISTORY_PROTECTION_UNAVAILABLE`. Los casos abiertos independientes continúan.

El flujo de corrección y los cierres usan el bloqueo transaccional compartido
`pg_advisory_xact_lock(117,20261108)`, antes de bloquear filas de temporada/persona.
Los UPDATE directos relevantes adquieren la misma llave mediante triggers por
sentencia. RF22 conserva los controles de permisos. No se modifican partidos,
resultados, alineaciones ni sanciones.

## Integración y límites de producción

Las migraciones locales son complementarias: correcciones/evidencia, snapshots
y acuses mínimos del cierre futuro. No se duplican migraciones ni se modifica el baseline. Se verifican
solo en contenedores desechables. El compose.yml de la rama original
feat/PDGLD-117-correccion-identidad conserva su puerto local 5434 y no se utiliza
en estas pruebas; el compose.yml de este worktree permanece igual que develop.
El esquema de esta entrega independiente añade únicamente las tablas y
relaciones de PDGLD-117, sin incorporar mantenimiento de cuentas ni correo.

Antes de producción siguen pendientes revisión del plan exacto de seguridad/ACL,
retención, respaldos y protección en reposo de evidencia privada. bytea y RBAC no
acreditan por sí solos todo RNF02 del ERS. No se habilita despliegue ni se debilita
el bloqueo de tablas nuevas del pipeline. La base Docker sigue sin RLS; la
prueba de RLS usa un schema auth y roles sintéticos en otra base desechable.

Esta preparación aislada parte de origin/develop `26081d0` (PR #44), e incluye
las entregas de edad/ventana y excepciones de PDGLD-103/104/15 de esa base.
Se reutiliza la resolución de compatibilidad: AgeExceptionPanel permanece en el
expediente abierto, junto con requisitos documentales y huellas de excepción.
No se integra ni modifica la rama original. Los resultados de esta separación
se registran en [preparación sobre develop](../validation/pdgld117-on-develop-preparation.md).


La captura mínima futura se completa con un acuse privado de cierre en una
migración nueva, sin levantar APPLY ni inventar hechos históricos. Véase
[captura y procedencia](season-identity-capture.md). La compatibilidad con edad
y excepciones se valida en este worktree temporal, sin integrar en la rama
original. Las pruebas usan actores y proveedores sintéticos.
