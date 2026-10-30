# PDGLD-38 — Administración de grupos vacíos

29/10/2026. Incremento de servidor y pruebas, sin nuevas vistas y sin modificar
contratos de afiliación/inscripción ni la estructura compartida del PR #36.

Ruta: `/api/competitions/seasons/{id}/categories/{participationId}/groups`.
participationId es season_categories.id, no categories.id. Se valida la relación
con la temporada y su liga; los UUID enviados no conceden alcance.

| Método | Cuerpo / permiso | Resultado |
| --- | --- | --- |
| GET | competitions:READ sobre temporada | items con id/name de grupos de la participación |
| POST | name, reason, expectedSeasonVersion; competitions:CREATE | 201 id/name/seasonVersion/deleted=false |
| PATCH | groupId, name, reason, expectedSeasonVersion; competitions:UPDATE | 200 id/name/seasonVersion/deleted=false |
| DELETE | groupId, reason, expectedSeasonVersion; competitions:UPDATE | 200 id/name/seasonVersion/deleted=true |

La matriz no define DELETE. La eliminación segura del grupo vacío se trata como
modificación de la configuración, con UPDATE vigente y motivo auditado, sin crear
otra concesión ni bypass. Revisar este mapeo en la revisión independiente.

Nombre recortado, no vacío, máximo 120 caracteres. Solo PLANNED sin inicio de
competencia. Cada escritura bloquea la temporada, verifica la versión esperada y
el alcance, escribe y audita en una transacción, incrementando su versión.
groups no tiene record_audit, por lo que se registra un evento manual; seasons
usa audit_season para su UPDATE. El grupo se bloquea antes de contar referencias.

Renombrado y eliminación se limitan a grupos sin equipos, partidos ni versiones de
clasificación. Las FK RESTRICT existentes son defensa adicional ante referencias
nuevas; no hay CASCADE. La versión o un nombre duplicado producen conflicto, sin
escritura parcial. No se ofrece reasignación masiva ni edición del historial.

Errores de conflicto: GROUP_ALREADY_EXISTS, GROUP_IN_USE, STALE_CONFIGURATION,
SEASON_CLOSED y COMPETITION_ALREADY_STARTED (409). Recursos que no corresponden
al contexto: INVALID_CONTEXT (400); permisos: FORBIDDEN (403). Se conservan las
guardas comunes de sesión, origen, cuerpo JSON limitado y respuestas sin caché.

## Límite de formatos e inscripción

Este CRUD prepara la administración. El contrato posterior de
[tabla general](competition-general-table.md) incorpora General automático y
protege ese grupo frente a modificaciones manuales. El contrato de
[distribución](competition-distribution.md) incorpora fase de grupos en servidor.
No crear grupos General ficticios para ocultar una distribución pendiente.
El contrato de inscripción permite omitir grupo para fase de grupos, conserva
la categoría y devuelve groupId=null hasta asignación autorizada. Los contratos
de recuperación/listado aceptan esa ausencia. La integración visual de esos
formatos permanece pendiente en PDGLD-95.

Pruebas HTTP con PostgreSQL desechable: alta/consulta/renombrado/borrado vacío,
auditoría única, sesión, permisos, origen, pertenencia de categoría, duplicados,
carreras, protección de clasificación existente, rollback y temporadas
iniciadas/cerradas. No se modificó la base local del usuario ni Supabase.
