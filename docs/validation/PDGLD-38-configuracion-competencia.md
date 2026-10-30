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

## Cuarto incremento: grupos vacíos (29/10/2026)

Alta, consulta, renombrado y eliminación segura de grupos vacíos mediante servicios
y HTTP. Se comprueba temporada/participación, permisos vigentes, versión, cierre,
referencias y auditoría. Sin vistas nuevas ni migraciones adicionales. No se
declara completada la configuración de formatos o distribución de equipos.
`test:competitions`: 29 resultados aprobados, reconstrucción/migrate diff sin
diferencias; lint, typecheck y build aprobados. CI remoto no ejecutado.
Contrato: [grupos](../architecture/competition-groups.md).

## Trabajo restante

Incremento tabla general: 34 resultados de competencias aprobados. Formato por participación y General automático en
inscripción por HTTP, sin tocar vistas. Nueva migración con compatibilidad
LEGACY_GROUPS y restricción de único General. Pruebas de inscripción legada: 30
resultados aprobados; cliente de inscripción: 73 aprobados; lint/typecheck
aprobados. Contrato y límites: [tabla general](../architecture/competition-general-table.md).
Fase de grupos y distribución añadidas en el incremento del 30/10 descrito abajo;
no se declara completada la historia.

Avance de edición (29/10): PATCH de nombre/fechas para temporadas planificadas,
con permisos, motivo, versión y protección de calendario utilizado. Suite de
competencias: 31 resultados aprobados; lint y typecheck aprobados.
Contrato y límites del cierre: [edición de temporada](../architecture/competition-season-edit.md).

- Edición de categorías/participaciones; validación y aprobación de convocatoria
  y parámetros versionados. No aplicar automáticamente propuestas DRAFT.
- Cierre auditado con comprobación de pendientes: falta concretar qué trámites
  bloquean además de los partidos sin resolver y la autoridad pertinente. La
  preferencia del usuario es bloquear, sin inventar resultados por default.
- Pantallas integradas, coordinación con PDGLD-110 y pruebas de ambos formatos,
  permisos, concurrencia, cierre y regresión de afiliación/inscripción.

PV-04 queda pendiente de la consulta al profesor: documentos, ventanas, edades,
excepciones y participación entre categorías. No se codifican reglas de la
convocatoria histórica de 2024–2025 como reglas vigentes de 2026.

Este primer incremento no termina la historia ni sus subtareas. Faltan los puntos
anteriores, revisión independiente, CI remoto y evidencia de aceptación integrada.

## Incremento: inscripción pendiente y distribución (30/10/2026)

Servidor implementado y contrato en
[fase de grupos](../architecture/competition-distribution.md). Sin nuevas vistas.
GROUP_STAGE conserva categoría y REGISTERED sin grupo hasta asignación autorizada.
GENERAL_TABLE y LEGACY_GROUPS conservan sus recorridos. Se adapta el contrato de
recuperación/listado, sin alterar cuerpos, claves o huellas anteriores.

Comprobaciones locales:

- Competencias: 41 resultados aprobados con HTTP y PostgreSQL reales, incluyendo
  permisos retirados, categoría desautorizada, un ganador concurrente y rollback
  de grupo/versión si falla auditoría. SQL rechaza partidos y clasificación sin
  grupo, reasignaciones y cambio de formato con historial.
- La migración real se ejecutó además sobre inscripciones previas dentro de una
  transacción revertida: categoría proyectada correctamente, temporadas cerradas,
  todos los demás campos/huellas y auditoría intactos, estado de triggers restaurado.
- Inscripciones existentes: 30 resultados aprobados; interfaz/adaptadores: 73;
  recuperación cliente: 12; seed: 19 + 7. Reconstrucción y comparación Prisma sin
  diferencias. Lint sin avisos y typecheck aprobados.
- `npm run build` falla al arrancar el proceso CSS de Turbopack
  (`node process exited before we could connect`, código 0), también al repetir
  con permisos ampliados. No se cambiaron dependencias ni configuración para
  ocultarlo. Comprobación complementaria `next build --webpack` aprobada,
  incluyendo TypeScript y generación de rutas. Confirmación del build oficial
  con Turbopack pendiente en CI; Webpack no lo sustituye.
- Referencia remota consultada nuevamente: origin/develop=e84ef5d, sin nuevos
  commits respecto de la base revisada. No se incorporó el borrador visual de Vic.

Solo bases desechables. No se aplicaron migraciones a gestor_ligas_dev/Supabase;
no hubo commit, push, publicación ni cambios en Jira. PDGLD-95 y aceptación visual
siguen pendientes, además de los criterios de negocio/revisión indicados arriba.
