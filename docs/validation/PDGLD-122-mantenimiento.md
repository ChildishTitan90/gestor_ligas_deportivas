# PDGLD-122 — mantenimiento y bajas

Validación local del 3 de noviembre de 2026. Base de integración: `origin/develop` en `9911e9a`, que incorpora cargos y representantes de PDGLD-93. Integración local sin conflictos.

## Alcance completado en servidor

- Matriz entidad/acción/permiso/estado en `docs/architecture/club-team-maintenance.md`.
- Consulta y edición autorizadas, baja/reactivación administrativas, control de versión y auditoría transaccional.
- Política de eliminación aprobada expresamente por el usuario: solo autoridad de liga/global con APPROVE, sin referencias ni historial, motivo y confirmación.
- Comprobación PostgreSQL de todas las FK hacia el identificador, incluso compuestas, más auditoría previa. No hay cascadas ni cambios de inscripción, representación o baja deportiva.
- Bloqueo de fila frente a inserciones concurrentes de referencias. Auditoría de eliminación conservada después de retirar el registro.
- Nueva migración adicional; no se modifican migraciones previas ni bases persistentes.

## Evidencia

`npm run test:club-maintenance`: 2 pruebas puras y 13 comprobaciones de integración (incluido contenedor del suite), correctas. Usa PostgreSQL temporal y servidor HTTP real. Cubre aislamiento por liga, sesión, baja y reactivación, concurrencia, duplicados normalizados, identidad conservada, confirmación y motivo, eliminación vacía, referencias e historial, autoridad limitada a club y rollback ante fallo de auditoría tanto en baja como eliminación.

TypeScript y ESLint: correctos sobre el árbol integrado. La regresión de Preview: 125 pruebas correctas, 2 omisiones previstas y ninguna falla; proceso finalizado correctamente. Usa base local aislada con RLS y el rol limitado; no es una ejecución contra Supabase remoto.

La regresión detectó que, al habilitar DELETE al backend, una concesión indebida de DELETE a PUBLIC podía coincidir con el permiso efectivo esperado y pasar el control anterior. El plan ahora rechaza explícitamente cualquier ACL de tabla para PUBLIC antes de normalizar permisos del backend. Se conserva la prueba negativa original y el recorrido completo pasa.

## Pendiente de aceptación

El comando general `npm run test:ci` encuentra limitaciones de Windows al crear enlaces simbólicos y recursos temporales de diagnóstico (EPERM), reproducidas fuera del sandbox. Se ejecutó el mismo comando en un contenedor Linux desechable `node:24`, con el proyecto montado en solo lectura: **67 pruebas correctas, ninguna falla ni omisión**. No se modificaron ni omitieron pruebas para obtener ese resultado. Esto valida localmente los controles; la ejecución remota del workflow y revisión de PR siguen pendientes antes de declarar la tarea integrada.

PDGLD-123 conserva el botón/confirmación visual de eliminación y la revisión de la interfaz. PDGLD-124 conserva la evidencia transversal de aceptación; la historia padre PDGLD-121 no se considera cerrada con esta entrega de servidor. La migración y los permisos remotos no se han aplicado a bases persistentes.
