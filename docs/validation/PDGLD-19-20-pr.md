# Propuesta de un único PR a develop

## Título

PDGLD-19 / PDGLD-20: preparar cédulas, conservar captura offline y recuperar sincronizaciones con acuse

## Descripción

Un corte de red durante la captura podía dejar la edición únicamente en memoria. Las rutas reales `/matches` y `/matches/[matchId]/report` ahora exigen preparar el partido y sus recursos, guardan cada revisión en IndexedDB desde la edición y recuperan intenciones persistidas con su UUID y contenido original. El acuse identifica solamente la revisión enviada y conserva ediciones posteriores.

Se reutilizan ReportWorkspace, el shell y selectores compartidos, el contrato de versiones de PDGLD-18, `match_report_syncs`, autorización del servicio y endpoints privados de firmas. El Service Worker guarda recursos públicos; las copias privadas quedan separadas por cuenta/partido. No hay migraciones nuevas. La autorización local dura siete días con aviso previo; vencimiento de sesión permite reautenticación, y salida explícita/cambio de cuenta eliminan las copias conforme a la política documentada.

La rama también contiene la actualización de Next.js 16.4.3 a 16.4.6 de PDGLD-71, ya incorporada antes de esta etapa de pruebas.

## Aceptación separada

**PDGLD-19:** revisar preparación autorizada, descarga completa, reapertura sin red, guardado desde la primera edición, recuperación de contenido y tratamiento de cuota. La validación automatizada usa Chrome de escritorio con viewport móvil. La aprobación de la política de conservación y las pruebas Android/iOS físicos corresponden a revisión humana.

**PDGLD-20:** revisar intenciones persistentes, reintentos con mismo UUID, acuses por revisión, concurrencia, firmas interrumpidas, sesión, ámbito, versiones y rollback. Se entrega sincronización de borrador. El cierre oficial sigue bloqueado por `CONFIRMATION_DEPENDENCIES_PENDING`; no se aceptan resultados oficiales, puntos ni expedientes por aprobar este PR.

## Validación

Matriz de criterios, resultados exactos y pendientes en `docs/validation/PDGLD-19-20-acceptance.md`. Chrome, Service Worker, IndexedDB, NextAuth, backend y PostgreSQL desechable reales para los recorridos principales. Incluye matriz PG15/17, reintentos tras commit y subidas, cuota, rollback y comparación visible. Los artefactos nuevos publican solo JSON de resultados y conteos; no incluyen imágenes de firmas ni borradores.

Ejecuciones locales aprobadas: recorrido offline PG15/17 (11 operaciones distintas y 11 acuses por versión), regresión principal de cédula PG15/17, regresión de elegibilidad/designaciones/historial/firmas PG15/17, lint, tipos y build de producción. Los controles de componentes usan datos sintéticos; los recorridos principales usan backend real. La ejecución remota del workflow queda para después de publicar el PR autorizado.

La regresión del paso de designaciones de #207 conserva sus aserciones y selecciona el diálogo abierto. No atribuye el fallo original al merge de otro integrante ni al motor del navegador.

El job de cédulas incorpora la nueva prueba en ambas versiones de PostgreSQL sin retirar los pasos anteriores. Los 94 controles de `test:ci` pasaron en Node 24 Linux, sin red y con el repositorio montado como solo lectura. En Windows fallan fixtures auxiliares por enlaces simbólicos/instalación independiente; no se alteraron esas aserciones para ocultarlo. Los pendientes detallados de cobertura tampoco equivalen a aprobación total de las historias.

## Revisión requerida

Revisión visual/manual de Víctor, política de datos locales y separación borrador/cierre. Mantener PR sin publicar hasta su autorización. No se modifica Jira ni se realiza push desde esta tarea.
