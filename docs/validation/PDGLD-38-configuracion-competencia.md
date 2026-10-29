# PDGLD-38 — Configuración de competencia

Inicio: 28/10/2026. Base: develop e84ef5d, con PR #34 integrado.
Rama: feat/PDGLD-38-configuracion-competencia.

## Primer incremento: temporadas

Panel → Temporadas (`/competitions/seasons`): consulta por liga y creación
planificada de temporadas de fútbol, con nombre y fechas reales de calendario.
Se reutiliza `seasons`; no se cambian migraciones ni datos locales existentes.
El servicio verifica los permisos vigentes `competitions:READ/CREATE` en servidor
y el ámbito de liga, sin comparación fija con SUPERADMIN. Solo ligas activas.
Un permiso acotado a club no habilita la consulta completa de una liga.

Una transacción guarda temporada y auditoría. La restricción existente de nombre
único por liga/deporte protege envíos concurrentes. No se registra una segunda
auditoría de INSERT mediante trigger. Para UPDATE/DELETE existe audit_season;
el servicio conserva ese evento y no registra una segunda actualización manual.
La alta crea PLANNED/version 1; no permite activar, cerrar ni reabrir por formulario.
Las fechas de temporada no equivalen a ventanas de registro de jugadores.

`npm run test:competitions` utiliza el runner local existente: crea PostgreSQL
desechable, aplica migraciones, inicia Next.js y envía el formulario real mediante
su Server Action. Se comprueban consulta y aislamiento, autenticación, fechas,
permiso de creación, revocación con formulario abierto, duplicados concurrentes y
rollback ante fallo de auditoría. Se incorpora al job de PostgreSQL de CI.

Verificación local del primer incremento: 7 resultados de prueba aprobados;
lint, typecheck y build aprobados con Node 24.22.1. Turbopack informa su cambio a
childProcesses y completa la compilación. La base temporal se eliminó al terminar.
Todavía no se ejecutó aceptación visual de esta pantalla ni CI remoto de la rama.

## Segundo incremento: servidor de borradores versionados

Se incorpora consulta y alta de versiones DRAFT de convocatoria, puntuación,
desempates ordenados y calendario, con permisos READ/UPDATE, versión esperada y
bloqueo de la temporada. No agrega vistas. No aprueba ni aplica valores propuestos.
Contrato y pendientes: [configuración de competencia](../architecture/competition-configuration.md).

La suite `test:competitions` pasa 13 resultados: añade acceso privado por temporada,
permisos/origen, esquema estricto, historial intacto, carreras, rollback de reglas y
auditoría ante fallo de parámetros y rechazo de nuevas versiones sobre CLOSED.
Solo se modificó la base desechable del runner. No se ejecuta un cierre real sobre
datos del usuario para probar la barrera de escritura.

## Tercer incremento: catálogo y asociación de categorías

Contrato: [categorías de competencia](../architecture/competition-categories.md).
Sin nuevas vistas, se agregan alta/consulta de catálogo y asociación/consulta por
temporada con validación de liga, deporte, reglamento, permisos y versión.
La migración nueva permite preparar categorías con elegibilidad pendiente sin
inventar corte o edades. Solo se aplicó en bases desechables, no en gestor_ligas_dev.
Se corrigió un evento duplicado de UPDATE en la propuesta inicial de reglas:
el trigger audit_season ya registra ese cambio; una prueba exige un único evento.

Verificación del incremento: 23 resultados de competencias, 27 de afiliaciones,
30 de inscripción, 26 de controles CI y las suites de seed (19 + 7) aprobados.
Lint, typecheck y build aprobados. La prueba de migración ejecuta el archivo real
sobre una participación anterior dentro de una transacción desechable y comprueba
que conserva UUID, reglamento y fecha de corte, con indicador pendiente=false.
La reconstrucción desde
migraciones y su comparación con Prisma no detectaron diferencias. Las pruebas
de inscripción conservan datos legados y el historial de otra temporada.

## Siguiente trabajo de PDGLD-94/95/96

- Edición de categorías/participaciones; validación y aprobación de convocatoria
  y parámetros versionados. No aplicar automáticamente propuestas DRAFT.
- Formato por participación: tabla general con único General y asignación
  automática; fase de grupos con distribución pendiente y asignación posterior
  por operador autorizado. No atribuir al delegado la elección del grupo.
- Migración aditiva y adaptación de inscripción, recuperación e historial para
  separar REGISTERED de grupo asignado, conservando filas legadas y restricciones.
- Edición con concurrencia y protección de datos existentes; cierre auditado y
  solo lectura; grupos eliminables únicamente vacíos y sin referencias.
- Pantallas integradas, coordinación con PDGLD-110 y pruebas de ambos formatos,
  permisos, concurrencia, cierre y regresión de afiliación/inscripción.

PV-04 queda pendiente de la consulta al profesor: documentos, ventanas, edades,
excepciones y participación entre categorías. No se codifican reglas de la
convocatoria histórica de 2024–2025 como reglas vigentes de 2026.

Este primer incremento no termina la historia ni sus subtareas. Faltan los puntos
anteriores, revisión independiente, CI remoto y evidencia de aceptación integrada.
