# PDGLD-38: pendientes de revisión de Preview, reglas y reenvío

## Correcciones del repositorio

- `acknowledged operation resent`: se reprodujo en Chrome forzando un submit en
  el microtask posterior al acuse, antes del siguiente render de React. El código
  anterior falló con el mensaje reportado. El bloqueo temporal se liberaba antes
  de que el estado visual `locked` quedara reflejado. Ahora un ref bloquea la
  captura inmediatamente al confirmar, denegar o perder certeza del resultado.
  La prueba conserva esa intercalación para no depender de la velocidad del equipo.
- Aprobación explícita de versiones: permiso `competitions:APPROVE`, confirmación,
  validación de parámetros guardados, versión vigente, responsable, fecha y
  auditoría atómica. El inicio rechaza reglas en borrador o pendientes de
  validación. [Contrato](../architecture/competition-rule-approval.md).
- Preview: el plan del backend limitado incorpora las lecturas y columnas de
  escritura que utilizan configuración, aprobación, mantenimiento y distribución.
  No concede superusuario, BYPASSRLS, acceso al ledger, cambios de identidad de
  categorías/grupos/temporadas ni edición del contenido de parámetros aprobados.
  El permiso SQL del backend no reemplaza el RBAC de cada persona.
- `test:preview-runtime` incluye también la suite de competencias por HTTP y las
  consultas de páginas con el rol limitado y RLS, además de afiliación/inscripción.
  Los perfiles de prueba se aíslan y restauran respecto del catálogo RF22.

## Evidencia local

- Chrome: el código previo falló con `acknowledged operation resent` al forzar la
  carrera; la corrección pasó tres ejecuciones consecutivas de
  `test:competition-ui` con esa misma intercalación.
- `test:preview-runtime`: 126 casos declarados, 124 aprobados y dos omisiones
  previstas, sin fallos; incluye las 57 pruebas de competencias, aprobación,
  inicio, rollback y concurrencia con RLS activo y backend limitado.
- Autorizador real de Preview: catálogo RF22 y extensión de creación de ligas
  recuperados sin omitir RLS.
- `test:ci`: 27 aprobadas. Lint y TypeScript sin errores.

Los fixtures que marcan reglas aprobadas o modifican el esquema histórico solo
trabajan en bases desechables. La prueba de migración se ejecuta antes de crear
participaciones con el esquema nuevo; los fixtures de cierre se acotan a su liga.

## Revisión que debe realizar Vic en sus entornos

El plan SQL actualizado se prueba en bases temporales; no se aplicó a Supabase
remoto ni se modificaron conexiones o configuración de Vercel. Vic debe revisar
la conexión de Preview y aplicar el procedimiento autorizado
[check → migrate → provision → check](../architecture/preview-runtime.md).

En el Preview publicado, comprobar con sesiones reales: abrir configuración,
crear una versión, revisar y aprobar con la persona autorizada, asociar categorías,
configurar grupos/formato, inscribir/distribuir equipos y cerrar inscripciones
antes de iniciar. Un perfil sin APPROVE debe conservar la consulta y no poder
aprobar mediante pantalla ni API. El inicio con borrador debe quedar rechazado.

Las pruebas HTTP/markup y las de Chrome con respuestas sintéticas se distinguen
de ese recorrido con clics, hidratación y conexiones remotas. No se afirma que
producción tuviera el problema del rol `gestor_ligas_preview`; sus permisos
dependen de su conexión. Mantener PDGLD-38 en pruebas hasta completar la revisión
funcional y de entorno del equipo; CI verde o aprobación del PR no cierran la historia.
