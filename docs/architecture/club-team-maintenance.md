# Administración de clubes y equipos — PDGLD-121

## Alcance de esta entrega

Ruta `/clubs` integrada en el shell de gestión: consulta paginada, búsqueda por nombre/referencia, filtros por entidad y estado, detalle, últimos 20 motivos de mantenimiento, corrección de nombres sin historial y baja/reactivación administrativa con confirmación.

La decisión del usuario es bloquear a todos los equipos mientras su club esté de baja. El estado efectivo se obtiene del club y del equipo; no se propaga un UPDATE a sus equipos. Reactivar el club conserva las bajas individuales. No se modifican afiliaciones, inscripciones, partidos, resultados, firmas, representación ni documentos.

## Matriz de autorización

| Entidad / acción | Permiso de clubs | Estado / alcance |
| --- | --- | --- |
| Club/equipo: lista, detalle e historial administrativo | READ | Liga activa y ámbito de la concesión vigente |
| Club/equipo: corregir nombre | UPDATE | Activo, club activo y sin historial vinculado |
| Club/equipo: baja/reactivación | APPROVE | ACTIVE ↔ INACTIVE; motivo y confirmación obligatorios |
| Equipo: baja/reactivación | APPROVE | Además exige club activo |
| Nuevas inscripciones / distribución de grupos | Permisos existentes | Equipo y club activos |
| Eliminación definitiva | No habilitada | Pendiente política de conservación; usar baja temporal |

Se reutilizan permisos vigentes, sin conceder capacidades por nombre de rol. La consulta/reactivación de clubes inactivos resuelve el ámbito a partir de la base y usa `grantCoversContext`; no relaja `resolveAuthorizationContext`. Una asignación vinculada a un club inactivo deja de ser operativa conforme a las reglas existentes; la reactivación corresponde a una autoridad vigente de liga o global.

`SUSPENDED` y `WITHDRAWN` existentes se conservan y se muestran con su significado propio. Esta pantalla no los transforma a ACTIVE: no sustituye la baja deportiva de PDGLD-87.

## Persistencia, concurrencia e historial

Migración nueva `20261103010000_pdgld121_club_team_maintenance`: añade `version` a clubes y equipos, `status` a equipos y amplía el CHECK de clubes con INACTIVE conservando los estados previos. No crea tablas ni cambia RLS.

Las operaciones adquieren primero el bloqueo exclusivo de autorización (54, 2026), que se coordina con el bloqueo compartido de los servicios operativos. La escritura comprueba la versión recibida y actualiza con condición de versión. Dos peticiones sobre la misma versión no producen dos cambios ni dos eventos de auditoría. El reintento después de una respuesta incierta requiere consultar el estado; no se reenvía automáticamente.

Los triggers nuevos auditan exclusivamente las actualizaciones que cambian `version`, usando la función de auditoría existente y `app.user_id`/`app.reason`. No duplican el historial de altas ni alteran los flujos SQL previos que no actualizan esta versión. La auditoría y el cambio se confirman o revierten juntos.

La corrección de nombre conserva UUID y referencia, normaliza espacios y rechaza coincidencias sin distinguir mayúsculas dentro de la misma liga (club) o club (equipo). Esta validación corresponde al mantenimiento; no se añade una restricción global sobre nombres existentes ni se cambian las reglas de alta por categoría. El bloqueo compartido de las altas y exclusivo de mantenimiento serializa ambos flujos de aplicación.

Un club con afiliaciones/equipos o un equipo con inscripciones requiere el trámite formal de nombre (PDGLD-92). Reasignación de representantes (PDGLD-93), eliminación definitiva y otros cambios formales quedan fuera de esta entrega; no se declara cerrada toda la historia PDGLD-121.

## Operación y validación

Antes de usar esta rama sobre una base persistente, aplicar la migración por el procedimiento de `docs/migraciones.md`. Las pruebas usan una base temporal y no actualizan la base habitual ni Supabase.

El plan de Preview añade únicamente INSERT de los nuevos defaults y UPDATE de `name/status/version`; conserva prohibición de traslado de club, modificación de referencia, DELETE y modificación de inscripciones. El mantenimiento remoto de permisos requiere el flujo existente y no se ejecuta como parte de este cambio.

- `npm run test:club-maintenance`: contratos, estado efectivo e integración PostgreSQL/HTTP real; permisos, ámbito, versiones concurrentes, auditoría, reactivación y corrección de nombres.
- La integración también se descubre mediante `test:auth` por el patrón `authorization-*.test.ts`; las pruebas puras se incorporan al job de CI.
- `npm run test:preview-runtime`: regresión del flujo de afiliación/inscripción y restricciones SQL del rol de Preview en base local aislada.
- `npm run typecheck`, `npm run lint`, `npm run test:ci`.

La comprobación HTTP de la nueva pantalla valida sesión, renderizado y aislamiento de datos. No sustituye la revisión visual interactiva en claro/oscuro, móvil/escritorio y teclado, pendiente antes del cierre de la subtarea de interfaz.
