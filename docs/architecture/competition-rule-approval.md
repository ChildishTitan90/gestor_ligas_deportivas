# Aprobación de reglamentos e inicio de competencia

PDGLD-38, revisión del 1 de noviembre de 2026.

Crear un borrador no valida ni aprueba las reglas. Desde la configuración de una
temporada planificada, una persona con `competitions:APPROVE` en esa edición puede
revisar la convocatoria, puntuación, desempates y calendario de una versión y
aprobarla mediante confirmación explícita `APROBAR` y un motivo obligatorio.
No se añade ese permiso a otros roles ni se aprueban reglas al iniciar.

`POST /api/competitions/seasons/{id}/configuration/{ruleId}/approve` recibe
`expectedSeasonVersion`, `confirm` y `reason`. El servidor deriva la identidad de
la sesión, comprueba permiso y ámbito, bloquea temporada/reglamento/parámetros y
rechaza versiones obsoletas, reglas de otra edición, temporadas iniciadas o
cerradas y reglamentos incompletos o fuera del contrato de configuración.

La revisión confirma los cuatro parámetros guardados, registra `validated_by`,
retira `requires_validation`, guarda estado `APPROVED`, responsable y fecha e
incrementa la versión de temporada en una transacción. Los triggers existentes
registran auditoría con actor/motivo y conservan la inmutabilidad de las reglas
aprobadas. Un fallo revierte también parámetros, versión y auditoría. Una
corrección requiere una nueva versión y su propia aprobación. Aprobar una versión
no sustituye automáticamente la vinculada a las categorías.

El inicio requiere inscripciones cerradas, ningún equipo pendiente de grupo y al
menos una categoría. Todas las versiones vinculadas a las categorías deben estar
aprobadas y sin parámetros pendientes de validación. Los errores
`RULES_NOT_APPROVED` y `RULES_PENDING_VALIDATION` devuelven 409 sin iniciar ni
alterar versión o auditoría. Un borrador no vinculado no invalida una versión
aprobada en uso.

La aprobación es una decisión explícita de la persona autorizada. No acredita
por sí sola aceptación de la Liga, documentos externos, decisiones pendientes del
ERS ni el cierre de toda la historia.
