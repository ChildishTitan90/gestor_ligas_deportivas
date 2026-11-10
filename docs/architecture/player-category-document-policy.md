# Política documental por categoría — sesión 04/11/2026, entrega 2

## Autoridad y compatibilidad

`player_policy.documents` admite la lista histórica o un objeto versionado. La
lista histórica y los `document_requirements` conservan la recepción de archivos
y sus identificadores, pero no acreditan una política nueva ni habilitan nuevas
activaciones automáticas. No se hizo backfill de políticas aprobadas en las
categorías existentes.

La política explícita tiene versión 1, estado DRAFT/APPROVED, decisiones
pendientes, perfil documental explícito, modo de activación y grupos documentales. Un grupo indica población
(ALL/MINORS/ADULTS), tipos alternativos `anyOf`, cantidad, obligación para
completar expediente y obligación para habilitación. No se deduce una política
del nombre de la categoría ni de que un archivo ya esté recibido.

Para aprobar se requieren UPDATE y APPROVE de competencias en la temporada.
Se conserva la edición planificada, versión esperada, auditoría y bloqueo
contra carreras. Con inscripciones pendientes, solo se permite cambiar el
componente documental manteniendo idénticas edades, ventana y cupos. No se
admite ese cambio si ya hay jugadores habilitados/suspendidos afectados; no se
invalida su situación silenciosamente. La detección incluye equipos asociados
por grupo y participaciones superiores, además de la FK directa de categoría.

La UI anterior conserva el objeto al editar otros campos, sin degradarlo a una
lista. El editor completo y el recorrido de participaciones corresponden a la
entrega 3; el contrato existente PATCH de player-policy permite validar el
backend. Los campos de formulario nunca sustituyen permisos del servidor.

## Reglas y estados distintos

- CURP: constancia solicitada para el expediente. Únicamente la población adulta
  con activación VERIFIED_ADULT_CURP puede entregarla después de habilitarse,
  si el grupo lo permite explícitamente. La comprobación RENAPO debe ser VERIFIED
  y corresponder a la identidad vigente; no valida el archivo adjunto.
- Menor al día de registro: credencial escolar O constancia de estudios, y
  autorización del tutor obligatorias. Una alternativa escolar aprobada cumple
  el grupo sin exigir ambas. La autorización requiere documento vigente aprobado
  y acuse de acreditación administrativa para esa identidad y documento.
- Foto para credencial: PHOTO opcional, PNG/JPEG. No satisface identificación
  oficial ni reemplaza una selfie de verificación.
- Identificación oficial: grupo configurable, puede ser opcional. Sus tipos
  autorizables son INE, licencia o pasaporte. Un grupo obligatorio debe estar
  aprobado antes de habilitar. No se exige consultar INE + selfie al registrar.
- Los perfiles CHILDREN/VETERANS requieren configurar evidencia de nacimiento y CURP. La administración distingue CHILDREN de otras categorías YOUTH; no se deduce del nombre ni de una edad inventada. Sin tipos
  aceptados confirmados se conserva un borrador con BIRTH_EVIDENCE_TYPES. No se
  añaden acta y constancia como dos exigencias automáticas. Un mismo tipo puede
  satisfacer dos grupos únicamente si la política aprobada lo autoriza.

Se distinguen archivo recibido, documento aprobado, consentimiento acreditado,
expediente completo, condiciones documentales para habilitación e inscripción
ACTIVE. El expediente devuelve grupos/condiciones por separado. `approvalAllowed`
permanece falso: esta entrega no agrega una aprobación deportiva universal de
menores/Veteranos ni habilita participaciones superiores.

## Resolución única, huellas y concurrencia

`category-document-requirements.ts` resuelve la política y sus requisitos; se
reutiliza desde consulta, autorización de carga y activación. No hay servicios
paralelos de preparación/confirmación. Los requisitos nuevos usan IDs
deterministas o conservan el ID configurado; CURP, foto y documentos de menores
mantienen sus IDs previos para que la sustitución no pierda su versión base.

La intención conserva SHA-256, tamaño, MIME, identidad, requisito, política de
ventana y, para políticas explícitas, huella documental. Un cambio concurrente
de política invalida una confirmación obsoleta, incluso si ocurrió durante la
lectura de Storage. Se conservan reautorización, versiones inmutables, no-upsert,
recuperación de acuse e idempotencia. Los archivos históricos nunca se borran
automáticamente. No se aplicó la migración al Docker habitual ni a Supabase.

La revisión de un documento puede reevaluar localmente la habilitación adulta
tras guardar su acuse, sin otra consulta a proveedores. Si esa fase falla, el
acuse documental persiste y el mismo envío recupera la reevaluación. GET no
escribe ni consulta APIs de identidad.

## Decisiones que siguen pendientes

Se conservan las edades ya configuradas: 35 frente a 37 para Veteranos sigue sin
resolverse. Los comprobantes de nacimiento aceptados y el alcance de «firma para
todas» en adultos tampoco están aprobados. El estado DRAFT y pendingDecisions
mantienen bloqueada la aprobación correspondiente; las políticas APPROVED de
los fixtures son decisiones explícitas de pruebas, no configuración de la liga.
El catálogo de tipos disponibles no decide su obligatoriedad.

No cambia la ventana de altas de lunes a miércoles ni la carga documental
cualquier día mientras el expediente esté pendiente. Se conservan privacidad,
permisos por inscripción/club y enlaces temporales. Consulta para responsables
del club y reglas arbitrales siguen como dependencias del backlog general.
