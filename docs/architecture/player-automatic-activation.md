# Habilitación automática por CURP — adultos fuera de Veteranos

La decisión de Víctor del 1/11/2026 permite pedir la constancia CURP para completar
el expediente sin bloquear la habilitación de ciertos adultos con CURP verificada.
La sesión del 04/11 exige que esta excepción quede explícita en la política de la
categoría; la ausencia de configuración ya no habilita automáticamente.

## Política vigente

`player_policy.documents` admite una política documental versionada con estado
APPROVED, sin decisiones pendientes, requisitos por población y dos condiciones
independientes: `requiredForDossier` y `requiredForEligibility`. La configuración
histórica en forma de lista conserva las cargas, pero requiere revisión y no
se convierte automáticamente en una política aprobada.

VERIFIED_ADULT_CURP_V2 solo pasa INELIGIBLE → ACTIVE. Requiere actor operativo con
UPDATE/READ o APPROVE/READ del contexto, afiliación y categoría autorizadas,
equipo sin baja y temporada no cerrada. La mayoría de edad se evalúa el día del
registro. Se conservan los límites de edad deportiva configurados en OPEN/YOUTH;
YOUTH sin máximo y excepciones de edad no habilitan automáticamente.

La política debe autorizar VERIFIED_ADULT_CURP y todos los grupos que bloquean
habilitación deben estar aprobados. Solo la regla CURP para ADULTS puede exigir
su archivo para el expediente y permitir entregarlo después de habilitarse.
Una identificación obligatoria no se omite: INE, licencia o pasaporte son
alternativas únicamente si la política lo expresa. Recibido no equivale a
aprobado. La foto para la credencial es un tipo distinto, opcional.

VETERANS y menores no se habilitan por este mecanismo. INE + selfie permanece
como integración disponible, sin convertirse en un requisito documental universal.
No se reactivan SUSPENDED/WITHDRAWN. La habilitación no sustituye los controles de
participación, sanciones, convocatoria o partido.

Se exige la última comprobación persistida de la Persona en VERIFIED, con
identity_version y huella idénticas a los datos actuales. Se conserva la CURP
única, inscripción de origen única y resolución administrativa vigente de las
posibles coincidencias por nombres/nacimiento, sin fusionar identidades.

## Escrituras y recuperación

`automatic-activation.ts` centraliza la reevaluación local desde POST de CURP,
resolución de coincidencias, aprobación documental o reevaluación explícita. No
se ejecuta desde GET ni consulta proveedores. Estado, historial y acuse
PLAYER_AUTO_ACTIVATED son atómicos. El acuse V2 incluye huella de política,
checkId e identityVersion; no CURP ni nombres.

La comprobación externa y la revisión documental guardan primero sus propios
acuses. Si falla la reevaluación posterior, la misma operación o POST
`/api/player-registrations/{id}/activation` permite recuperarla localmente, sin
otra consulta de CURP. Una aprobación del tutor sigue exigiendo acreditación
manual; recibir un archivo GUARDIAN_CONSENT nunca la acredita.

## Expediente después de habilitar

Un ACTIVE con acuse de esta política y versión vigente puede completar el
expediente mientras queden grupos documentales obligatorios por aprobar. Se
mantienen permisos y ventana pendiente, incluso si la política admite entregar
algún archivo después de habilitarse. Un ACTIVE histórico/manual sin acuse no
recibe permisos nuevos. Las cargas no cambian ACTIVE.

Los IDs y cargas históricos de CURP/foto se conservan; su compatibilidad no
aprueba una política. No se borran objetos o versiones anteriores ni se marca
como auténtico un archivo porque la comprobación RENAPO haya resultado válida.

## Entornos

La segunda entrega incorpora un catálogo aditivo de licencia, pasaporte y acta.
La existencia de un tipo no decide qué comprobantes acepta la liga ni lo hace
obligatorio. Las decisiones reales de nacimiento, edad de Veteranos y alcance
de firma adulta siguen pendientes. No se modificó Supabase ni se ejecutaron
consultas externas de identidad. Las pruebas usan PostgreSQL temporal y
transportes sintéticos; véase la validación de la segunda entrega.
