# Habilitación automática por CURP — adultos fuera de Veteranos

Decisión de Víctor del 1/11/2026: pedir la constancia CURP para completar el expediente, pero su carga no bloquea la habilitación de adultos que ya tienen CURP verificada. Las coincidencias internas requieren resolución administrativa. Una falla técnica o discrepancia del proveedor queda pendiente; no se rechaza automáticamente ni se reintenta consumiendo créditos.

## Condiciones y alcance

La política VERIFIED_ADULT_CURP_V1 solo pasa INELIGIBLE → ACTIVE. Requiere actor operativo con UPDATE/READ del contexto, afiliación aprobada, categoría autorizada, equipo sin baja y temporada no cerrada. Mayoría de edad calculada el día del registro, como en el expediente; nunca al día de la consulta. Admite categorías OPEN/YOUTH con edad por el año de referencia configurado en age_cutoff_date, límites mínimo/máximo respetados; YOUTH sin máximo definido no habilita automáticamente. Excepciones de edad no se aprueban automáticamente.

VETERANS y menores mantienen sus procesos de INE/tutor. Una exigencia documental obligatoria distinta de CURP impide esta habilitación automática; GUARDIAN_CONSENT no aplica a adultos. Foto/credencial opcionales no bloquean. No se modifican reglas de sanciones ni estados SUSPENDED/WITHDRAWN: nunca se reactivan por este mecanismo. No se interpreta tener un archivo como identidad validada.

Se exige la última comprobación local persistida de la Persona en VERIFIED, con identity_version y huella idénticas a los datos actuales. La restricción PostgreSQL conserva CURP única y una inscripción vigente por Persona/temporada. Las posibles coincidencias usan el detector ya existente de nombres/nacimiento y fechas vecinas; no se añade un umbral nuevo de similitud de CURP. CURP idéntica no crea una segunda Persona. La ausencia de candidatos y review_status sin pendiente permiten activar; si hay candidatos, solo una resolución administrativa DISTINCT_IDENTITIES_CONFIRMED vigente para exactamente esas identidades/versiones permite continuar.

## Escrituras y recuperación

El servicio automatic-activation.ts centraliza las reglas para POST de CURP, reenvío de una intención ya verificada, decisión administrativa y reevaluación explícita. No se ejecuta desde GET ni inicia consultas a proveedores. Permiso y contexto se vuelven a comprobar, con locks de fechas en el mismo orden de las altas y bloqueo de inscripción/Persona. La transición, player_status_history y acuse PLAYER_AUTO_ACTIVATED son atómicos. Acuse mínimo: política, checkId e identityVersion; no CURP/nombres. Los triggers de auditoría se conservan y el acuse de dominio identifica la regla aplicada.

El acuse del proveedor se guarda antes y en transacción separada. Si la habilitación falla, la CURP sigue verificada y el jugador pendiente; no se borra la comprobación ni se consulta otra vez. POST `/api/player-registrations/{id}/activation` con cuerpo vacío reevalúa solo reglas locales, autenticación/origen/actor/alcance obligatorios. El panel ofrece Revisar habilitación sin gastar créditos; el listado se actualiza cuando responde ACTIVE. Las lecturas de estado informan registrationStatus e identityReviewStatus, sin habilitar por efectos laterales. Una resolución administrativa confirma primero la decisión y después reevalúa; si el segundo paso falla, puede recuperarse por la misma reevaluación local.

## Expediente después de habilitar

La constancia se sigue solicitando como CURP, separada de la comprobación en RENAPO. Si falta el requisito de categoría, el servidor ofrece una posición requerida para completar expediente, con UUID determinista player-curp-document:v1 y tipo CURP existente, sin insertar configuración. Un requisito explícito prevalece; no se elude usando el UUID sintético. No se convierte configuración ausente en configuración aprobada.

Un ACTIVE con acuse de esta política y versión vigente puede cargar/sustituir exclusivamente CURP y PHOTO mientras su constancia vigente no esté VALIDATED. La recepción usa el transporte documental existente y no cambia ACTIVE. Un ACTIVE histórico/manual sin acuse no recibe permisos nuevos. Se mantiene alcance, afiliación/temporada/equipo vigentes y autorización en cada fase. Al existir una constancia vigente VALIDATED, se cierra esta ventana adicional de carga. VALIDATED requiere la revisión documental pertinente: la verificación RENAPO no marca como auténtico el archivo subido. Esa revisión documental formal continúa pendiente de implementación, igual que acreditación del tutor.

## Entornos y comprobación

Sin migraciones nuevas ni cambios remotos. El plan del backend limitado añade solo UPDATE(status,identity_review_status) en player_registrations y SELECT/INSERT necesarios en player_status_history; no permite cambiar Persona, equipo o temporada. Los locks usan esas concesiones deliberadas; no se amplían políticas de solo bloqueo de otras tablas. Provisión validada en PostgreSQL temporal con RLS. El plan no fue aplicado a Supabase por este trabajo.

Pruebas: PostgreSQL desechable con CURP/INE/Storage simulados, casos concurrentes, revisión, rollback de activación y recuperación sin otra consulta, carga posterior y límites de menores/Veteranos/edad/suspensión. Regresiones de PDGLD-13. Chrome usa datos/cámara simulados. Ningún agente ha consultado CURP/INE reales ni consumido créditos. PDGLD-13 conserva su estado en pruebas; sin commit, push ni cambios de Jira.
