# Propuesta de un único PR a develop

## Título

PDGLD-19 / PDGLD-20: preparar cédulas, conservar captura offline y recuperar sincronizaciones con acuse

## Descripción

Un corte de red durante la captura podía dejar la edición únicamente en memoria. Las rutas reales `/matches` y `/matches/[matchId]/report` ofrecen preparar el partido y sus recursos, guardan cada revisión preparada en IndexedDB desde la edición y recuperan intenciones persistidas con su UUID y contenido original. El editor con conexión sigue disponible cuando falla o falta el soporte offline, incluido desarrollo. El acuse identifica solamente la revisión enviada y conserva ediciones posteriores.

Se reutilizan ReportWorkspace, el shell y selectores compartidos, el contrato de versiones de PDGLD-18, `match_report_syncs`, autorización del servicio y endpoints privados de firmas. El Service Worker guarda recursos públicos; las copias privadas quedan separadas por cuenta/partido. No hay migraciones nuevas. La autorización local dura siete días con aviso previo; vencimiento de sesión permite reautenticación, y el cambio de cuenta conserva y aísla las copias pendientes. La salida explícita elimina solo las copias del titular tras advertir sobre sus pendientes.

Las acciones nuevas del reloj conectado reciben una marca del servidor también en una cédula preparada. Una acción capturada sin red conserva su hora declarada. Un reintento recupera el acuse del primer commit sin cambiar UUID ni contenido. Las marcas declaradas o antiguas sin origen exigen revisión si un traslado depende de comprobarlas.

Los conflictos ofrecen una resolución explícita tras comparar una referencia autorizada reciente. Se puede retomar el servidor sin escribir en la base o crear un borrador para revisar eventos y notas sobre las alineaciones y el reloj vigentes, repitiendo firmas. Se conservan íntegramente las capturas e intenciones anteriores en el dispositivo. El nuevo borrador espera Sincronizar manualmente. Si una versión cambia durante la revisión, se exige comparar otra vez.

En disponibilidad arbitral se usa «No disponible». Su prioridad rige el tramo superpuesto y ambos intervalos conservan su registro. La agenda excluye los vencidos. La política acordada conserva doce meses los intervalos sin relación con partidos y mantiene los que respaldan una decisión. La implementación de la depuración queda pendiente de revisión.

La rama también contiene la actualización de Next.js 16.4.3 a 16.4.6 de PDGLD-71, ya incorporada antes de esta etapa de pruebas.

## Aceptación separada

**PDGLD-19:** revisar preparación autorizada, descarga completa, reapertura sin red, guardado desde la primera edición, recuperación de contenido y tratamiento de cuota. La validación automatizada usa Chrome de escritorio con viewport móvil. La aprobación de la política de conservación y las pruebas Android/iOS físicos corresponden a revisión humana.

**PDGLD-20:** revisar intenciones persistentes, reintentos con mismo UUID, acuses por revisión, concurrencia, firmas interrumpidas, sesión, ámbito, versiones y rollback. Se entrega sincronización de borrador. El cierre oficial sigue bloqueado por `CONFIRMATION_DEPENDENCIES_PENDING`; no se aceptan resultados oficiales, puntos ni expedientes por aprobar este PR.

## Validación

Matriz de criterios, resultados exactos y pendientes en `docs/validation/PDGLD-19-20-acceptance.md`. Chrome, Service Worker, IndexedDB, NextAuth, backend y PostgreSQL desechable reales para los recorridos principales. Incluye matriz PG15/17, reintentos tras commit y subidas, cuota, rollback y comparación visible. Los artefactos nuevos publican solo JSON de resultados y conteos; no incluyen imágenes de firmas ni borradores.

Las ejecuciones locales y sus resultados más recientes están en la sección de revisión del 20 de noviembre del documento de aceptación. Los controles de componentes usan datos sintéticos; los recorridos principales usan backend real. El estado remoto requiere publicar estos cambios y repetir el workflow.

La regresión del paso de designaciones de #207 conserva sus aserciones y selecciona el diálogo abierto. No atribuye el fallo original al merge de otro integrante ni al motor del navegador.

El job de cédulas incorpora la nueva prueba en ambas versiones de PostgreSQL sin retirar los pasos anteriores. Los 94 controles de `test:ci` pasaron en Node 24 Linux, sin red y con el repositorio montado como solo lectura. En Windows fallan fixtures auxiliares por enlaces simbólicos/instalación independiente; no se alteraron esas aserciones para ocultarlo. Los pendientes detallados de cobertura tampoco equivalen a aprobación total de las historias.

## Revisión requerida

Revisión visual/manual de Víctor, política de datos locales y separación borrador/cierre. Los cambios de esta revisión permanecen locales hasta su autorización. No se modifica Jira ni se realiza push desde esta tarea.
