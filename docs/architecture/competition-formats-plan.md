# PDGLD-38 — Diseño de formatos y distribución

30/10/2026. Diseño y seguimiento del cambio completo.
El servidor ya implementa [tabla general](competition-general-table.md) y
[fase de grupos y distribución](competition-distribution.md), incluida la
categoría independiente del grupo. La integración visual permanece pendiente.
La configuración aprobada en Jira es por participación categoría/temporada.
No se modifica ninguna vista durante este bloque.

## Dependencias originales que motivaron el cambio

- season_teams.group_id es obligatorio; la categoría se deriva de groups.
- enrollmentSelect/enrollmentResult y listTeamEnrollments dereferencian groups.
- teamEnrollmentSchema, el resultado, recuperación y contratos del cliente exigen
  groupId UUID. canonicalTeamEnrollment incorpora ese campo a la huella persistida.
- matches valida categoría/grupo de los rivales. standing_entries referencia la
  combinación season_team_id/group_id/season_id. Un grupo nulo debe impedir
  programación y clasificación, nunca saltarse esas validaciones.
- Las inscripciones y operaciones anteriores conservan sus huellas, UUID y estado.

## Cambio coherente requerido

1. Agregar formato a season_categories, conservando las filas anteriores en una
   modalidad explícita de compatibilidad; no reclasificarlas por el nombre del grupo.
2. Guardar la participación de categoría directamente en season_teams. Rellenar
   solo desde su grupo existente, verificar liga/deporte/temporada y conservar las
   FK previas. Toda inscripción, asignada o no, debe tener categoría verificable.
3. Permitir group_id nulo únicamente para fase de grupos pendiente. Tabla general
   exige exactamente un General real y asignación automática. Sin grupo ficticio.
4. Incorporar protecciones SQL de correspondencia categoría/grupo, transición y
   barreras de programación/clasificación. Conservar auditoría y cierre.
5. Adaptar creación, recuperación, cancelación y listado en la misma entrega.
   No alterar la serialización de cuerpos legados: sus reintentos deben conservar
   exactamente la huella actual. El estado de inscripción sigue REGISTERED.
6. Actualizar contratos de datos del cliente para aceptar y conservar la ausencia
   real de grupo. La selección y presentación de pantallas se integrarán en PDGLD-95;
   no presentar el nuevo flujo como disponible antes de esa integración.

## Operaciones previstas

| Operación | Autoridad y datos | Precondiciones |
| --- | --- | --- |
| Configurar formato | Permiso vigente de configuración, participación y versión de temporada, motivo | Categoría/temporada válidas; no transformar actividad existente de forma implícita |
| Inscribir en tabla general | Delegado autorizado, club, temporada, categoría, equipo y clave estable | Afiliación aprobada y categoría autorizada; servidor asigna General |
| Inscribir en fase de grupos | Mismas precondiciones de inscripción; sin grupo elegido por delegado | Persiste categoría y REGISTERED, distribución pendiente |
| Distribuir | Operador con permiso/ámbito explícitos, inscripción, grupo destino y versión, motivo | Misma categoría/temporada, sin cierre; control de concurrencia y cupo si existe configuración |

El permiso de distribución se resuelve con capacidades vigentes. No suponer
que competitions:UPDATE está concedido inicialmente a Secretaría (RF22 solo le
concede READ en ese módulo). Se utiliza clubs:APPROVE con club/temporada y
autorización vigente de la categoría; sujeto a revisión independiente. No se
amplía el catálogo inicial ni se compara un código de rol fijo.

## Aceptación necesaria

- Reconstrucción y comparación Prisma; migración sobre datos legados con UUID,
  grupo, categoría, operaciones, huellas y auditoría conservados.
- Ambos formatos por HTTP real, reintento de cuerpo legado, respuesta perdida,
  cancelación concurrente, permisos revocados y aislamiento por club/liga.
- Distribución con un solo ganador; rechazo de grupo ajeno/cerrado, delegado y
  reasignaciones incompatibles con actividad/historial.
- SQL directo no permite programar ni clasificar una inscripción sin grupo.
- Regresión de afiliación, inscripción, seed y compilación; después recorrido
  visual integrado con la interfaz compartida y revisión independiente.

Las migraciones y contratos se comprobaron en bases desechables. No se aplicaron
a la base habitual ni Supabase. No cerrar PDGLD-94/96 sin revisar también sus
otros pendientes y la aceptación integrada.
