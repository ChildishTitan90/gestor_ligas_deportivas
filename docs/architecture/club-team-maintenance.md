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
| Eliminación definitiva (servicio PDGLD-122) | APPROVE de liga/global | Sin referencias ni historial; motivo, confirmación y versión |

Se reutilizan permisos vigentes, sin conceder capacidades por nombre de rol. La consulta/reactivación de clubes inactivos resuelve el ámbito a partir de la base y usa `grantCoversContext`; no relaja `resolveAuthorizationContext`. Una asignación vinculada a un club inactivo deja de ser operativa conforme a las reglas existentes; la reactivación corresponde a una autoridad vigente de liga o global.

`SUSPENDED` y `WITHDRAWN` existentes se conservan y se muestran con su significado propio. Esta pantalla no los transforma a ACTIVE: no sustituye la baja deportiva de PDGLD-87.

## Persistencia, concurrencia e historial

Migración nueva `20261103010000_pdgld121_club_team_maintenance`: añade `version` a clubes y equipos, `status` a equipos y amplía el CHECK de clubes con INACTIVE conservando los estados previos. No crea tablas ni cambia RLS.

Las operaciones adquieren primero el bloqueo exclusivo de autorización (54, 2026), que se coordina con el bloqueo compartido de los servicios operativos. La escritura comprueba la versión recibida y actualiza con condición de versión. Dos peticiones sobre la misma versión no producen dos cambios ni dos eventos de auditoría. El reintento después de una respuesta incierta requiere consultar el estado; no se reenvía automáticamente.

Los triggers nuevos auditan exclusivamente las actualizaciones que cambian `version`, usando la función de auditoría existente y `app.user_id`/`app.reason`. No duplican el historial de altas ni alteran los flujos SQL previos que no actualizan esta versión. La auditoría y el cambio se confirman o revierten juntos.

La corrección de nombre conserva UUID y referencia, normaliza espacios y rechaza coincidencias sin distinguir mayúsculas dentro de la misma liga (club) o club (equipo). Esta validación corresponde al mantenimiento; no se añade una restricción global sobre nombres existentes ni se cambian las reglas de alta por categoría. El bloqueo compartido de las altas y exclusivo de mantenimiento serializa ambos flujos de aplicación.

Un registro con referencias o historial requiere el trámite formal de nombre (PDGLD-92). La comprobación incluye todas las FK del catálogo PostgreSQL, también las compuestas y las futuras, además de auditoría previa. La reasignación de representantes permanece en PDGLD-93 y los cambios formales en PDGLD-92; no se declara cerrada toda la historia PDGLD-121.

## Política acordada para PDGLD-122 — 3 de noviembre de 2026

El usuario aprobó eliminación definitiva únicamente por autoridad vigente de liga/global con APPROVE, sin ninguna referencia ni historial, con motivo, confirmación y auditoría. Una concesión limitada a club no basta. Se admiten registros ACTIVE o INACTIVE; SUSPENDED/WITHDRAWN conservan su flujo deportivo. El servicio usa la misma Server Action autenticada y el contrato `operation: delete`; su botón y confirmación visual corresponden a PDGLD-123.

La migración adicional `20261103120000_pdgld122_reference_guard` crea una función de existencia con SECURITY DEFINER, search_path fijo, identificadores escapados desde el catálogo y parámetros enlazados. PUBLIC no tiene EXECUTE. El plan privado de Preview concede su ejecución al backend; no se exponen filas de dependencias ni se añaden permisos a roles de personas.

El servicio bloquea la fila FOR UPDATE antes de consultar referencias: las inserciones concurrentes de FK esperan y las restricciones siguen siendo la última defensa. Elimina una sola fila sin cascadas y registra actor, motivo y datos generales anteriores en la misma transacción. Si falla la auditoría se revierte la operación. Una respuesta perdida no se reenvía automáticamente; un segundo envío no duplica el evento.

## Operación y validación

Antes de usar esta rama sobre una base persistente, aplicar la migración por el procedimiento de `docs/migraciones.md`. Las pruebas usan una base temporal y no actualizan la base habitual ni Supabase.

El plan de Preview añade INSERT de los nuevos defaults, UPDATE de `name/status/version` y DELETE exclusivamente en clubes/equipos para el servicio autorizado. Conserva prohibición de traslado de club, modificación de referencia y modificación de inscripciones. El mantenimiento remoto de permisos requiere el flujo existente y no se ejecuta como parte de este cambio.

- `npm run test:club-maintenance`: contratos, estado efectivo e integración PostgreSQL/HTTP real; permisos, ámbito, versiones concurrentes, auditoría, reactivación y corrección de nombres.
- La integración también se descubre mediante `test:auth` por el patrón `authorization-*.test.ts`; las pruebas puras se incorporan al job de CI.
- `npm run test:preview-runtime`: regresión del flujo de afiliación/inscripción y restricciones SQL del rol de Preview en base local aislada.
- `npm run typecheck`, `npm run lint`, `npm run test:ci`.

La comprobación HTTP de la nueva pantalla valida sesión, renderizado y aislamiento de datos. No sustituye la revisión visual interactiva en claro/oscuro, móvil/escritorio y teclado, pendiente antes del cierre de la subtarea de interfaz.
