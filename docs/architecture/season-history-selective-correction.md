# PDGLD-117 — corrección selectiva e historial de cierres

Incremento local sobre `7ba6b35` del mismo PR #45. Implementa el criterio
humano de persona con temporada abierta y cerrada. No cambia reglas de edad,
excepciones ni eliminación; no habilita despliegue productivo.

## Contrato de lectura antes de sustituir la barrera global

Se utilizó el inventario local previamente revisado con Vic, conservado fuera
de esta entrega. La tabla siguiente documenta el delta por consumidor sin
duplicar ese diagnóstico interno.

| Consumidor | Protección implementada |
| --- | --- |
| Lista de jugadores, etiquetas y directorio de participaciones | Nombres por snapshot de cierre; ausencia explícita, sin people como fallback (protección ya existente conservada) |
| Expediente cerrado | No resuelve documentos/edad con people actual. Muestra nombre histórico y nacimiento/año/estado capturados cuando existen; informa qué falta. No interpreta ACTIVE como nueva habilitación |
| GET CURP e INE, revisión y colas operativas | CURP/INE rechazan CLOSED con HISTORICAL_VERIFICATION_UNAVAILABLE antes de cotejar identidad vigente. Cola INE omite cierres, incluida carrera durante lectura. Las revisiones documentales/edad/identidad conservan sus bloqueos de cierre |
| Participaciones cerradas | Conserva estado/versión/acuse; assessment ausente y sportsEligible=null, historical=true. UI diferencia habilitación histórica no acreditada de rechazo o vigencia actuales |
| Contexto interno de inscripción | En CLOSED devuelve lo registrado; no vuelve a buscar coincidencias con nacimiento vigente |
| Directivos de afiliación | Snapshot de nombres o indisponibilidad, sin director vigente como sustituto (protección existente) |
| Descarga de documentos y firmas | Evidencia privada original por referencia, con autorización; no crea una nueva acreditación. Evidencia INE queda bloqueada en cierre mientras dependa del snapshot operativo |
| Catálogos/clubes/equipos/panel/configuración | No consumen identidad de Persona como dato histórico. Estados y referencias conservados; nombres de catálogo actuales no acreditan denominación al cierre |
| Reportes/exportaciones deportivas | No hay endpoints CSV/XLSX/PDF ni módulos de resultados/sanciones implementados en el árbol inventariado. No se crean aquí; un futuro consumidor debe usar el lector histórico y declarar ausencias. No se aprueban lectores SQL externos no inventariados |
| Referencias arbitrales cerradas | HISTORICAL_REFEREE_UNPROTECTED: APPLY sigue bloqueado por ese consumidor sin recorrido histórico validado |

El trámite de corrección muestra deliberadamente la identidad VIGENTE y la
propuesta, con texto explícito; no se presentan como identidad de la temporada.
La capa SQL/servicio exige la protección v2 instalada y activa. Si falta, se
mantiene HISTORY_PROTECTION_UNAVAILABLE. No se sustituye un vacío histórico con
previous_identity del trámite ni con una consulta al proveedor.

## Escrituras de APPLY

Mantiene people.id, normalización y restricción única PostgreSQL de CURP; el
trigger incrementa identity_version. Unicidad concurrente, permisos sobre TODAS
las referencias (incluidas cerradas/retiradas), autoridad global donde corresponde
y prohibición de autoaprobación se conservan.

El bucle filtra inscripciones por temporada no CLOSED. Solo esas inscripciones
invalidan comprobaciones/habilitación, conservan acreditaciones previas de tutor,
registran estados/auditoría y se reevalúan. Participaciones autorizadas solo se
retiran si origen/destino son abiertos. La FK compuesta ya exige la misma temporada.
No escribe estados, versiones, documentos o acuses de inscripciones cerradas;
no modifica partidos, resultados, alineaciones, casos disciplinarios ni sanciones.

Una corrección de persona con historia requiere un trámite privado pendiente
que coincida exactamente con la propuesta y versión, y otro actor. El GUC por
sí solo no autoriza cambios: un trigger diferido exige APPLIED y evento de
aplicación del mismo actor en la misma transacción. SQL directo sin trámite o
una operación incompleta falla y revierte. La autorización de ámbito permanece
en servidor; esto no convierte una conexión propietaria en una cuenta sin riesgo.

## Cierres futuros, procedencia y privacidad

Migración aditiva `20261109010000_pdgld117_selective_history`; no modifica las
anteriores. Conserva snapshots de nombres y acuse de cierre, y añade una fila
privada e inmutable por inscripción: persona/temporada/versión, nacimiento,
año de referencia, huella de política, regla/versión, estado registrado,
referencias de documentos (IDs, hash, estado), comprobación CURP/acuse de INE y
participaciones (estado, versión, huella y evento). No duplica PDFs, fotos,
firmas, motivos privados ni CURP completa. Las referencias no sustituyen la
validación ni la retención del original; un acuse pendiente no se vuelve favorable.

La captura solo ocurre al cerrar después de la migración; incluso datos ausentes
permanecen ausentes. No hay backfill. El lector devuelve únicamente nacimiento,
año, versión/estado/fecha para UI autorizada; las referencias privadas se quedan
en servidor. Las tablas nuevas niegan PUBLIC/API y usan RLS en destinos Supabase;
Docker sigue con la decisión vigente de RLS local sin cambios.

Cierre y corrección conservan el orden RF22 → llave 117 → filas. Triggers de
sentencia también coordinan SQL directo. Si gana cierre captura los hechos
anteriores y APPLY excluye esa temporada; si gana corrección el cierre captura
la nueva versión y sus estados resultantes, sin mezclar identidades. Estado,
captura, trámite e historial/auditoría son transaccionales: cualquier fallo revierte.

## Aceptación y límites

La prueba integrada añade una persona con temporada abierta, otra cerrada con
captura y otra legada sin datos; resultados y sanciones NO vacíos, participaciones
abierta/cerrada, permisos ajenos, CURP duplicada, rollback y carreras con espera
real en ambos órdenes. PG15 y PG17 aprobaron las 35 comprobaciones integradas
por versión; evidencia y límites en `../validation/pdgld117-selective-history-results.md`.
Los escenarios de CURP concurrente de dos personas y autoaprobación se conservan.

Antes de producción: revisar ACL/RLS del runtime limitado, retención/respaldo y
protección en reposo de nacimiento/evidencia/referencias. Validación sintética
no acredita Supabase real ni aprobación humana del despliegue. No se cambian
estados Jira, ni se reenvían correos o consultan APIs reales CURP/INE.
