# Estado de aceptación — PDGLD-12 / PDGLD-64 / PDGLD-63

Revisión documental del 26/10/2026 sobre el código integrado de develop.

`npm run test:team-enrollments` contiene un recorrido HTTP real con PostgreSQL
temporal: solicitud del delegado, detalle vigente, aprobación de Secretaría con
`expectedVersion` y `authorizedCategoryIds`, opciones autorizadas e inscripción
REGISTERED. Comprueba que una categoría no seleccionada sea rechazada y que la
aprobación no active equipos previos. Los otros escenarios conservan fixtures
explícitos separados para alcance, concurrencia, rollback e idempotencia.

La autorización individual que faltaba en la revisión del 25/10 ya está incorporada
en el código y las pruebas actuales. Esto describe el alcance de la suite, no
certifica su ejecución ni una base compartida. Esta continuación de PDGLD-63 no
ha ejecutado pruebas con base ni modificado servicios.

La suite HTTP no abre un navegador ni verifica los controles de PDGLD-63.
`npm run test:team-registration` prueba presentación y adaptador con simulación.
`npm run test:team-registration-browser` utiliza Chrome y React DOM reales con
negocio sintético; verifica foco, modal y aislamiento por usuario. No arranca Next
ni realiza el recorrido con autenticación real.

Para aceptar las vistas falta un recorrido en el entorno de pruebas con sesión y
backend preparados por el equipo: navegación, selección dependiente, inscripción
existente/nueva según capacidad explícita, errores, doble envío, recuperación con
cuerpo/clave originales y consulta de historial. El contrato está publicado en PR #31 (9eb5373), todavía fuera de develop al
revisar esta entrega. La interfaz se adapta a capacidades, catálogos, seasonName,
consulta/cancelación e identidad esperada de esa revisión. El recorrido real
requiere primero integrar ese backend y confirmar PostgreSQL/Storage aislados.
Ver `docs/validation/PDGLD-63-recorrido-integrado.md`; no se han ejecutado sus
escrituras ni se acredita aceptación por las pruebas con negocio simulado.

Activación a ACTIVE: pendiente de definición con profesor/Liga. Mostrar ACTIVE no
implementa su transición. El cierre requiere revisión de otra persona, CI y
evidencia de aceptación; no se deduce de terminar subtareas o hacer merge.
