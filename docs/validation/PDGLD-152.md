# PDGLD-152 — Confirmación y clasificación transaccional

21 de noviembre de 2026. Trabajo local en `/private/tmp/gestor-pdgld29`, rama `feat/PDGLD-29-clasificacion-estadisticas`, partiendo de `a28404aa42b47f0479a9b5bca63985704dafaa4d` (PDGLD-151). Se conservan los dos commits de PDGLD-150 y el merge de develop. Los fetch de inicio y cierre mantienen origin/develop en `5b3ea851ae11d8b64d14b8c95fba1dc792dace81`. Sin push, PR ni cambios en Jira. El worktree PDGLD-32 permanece intacto en `6284027`.

Se leyó [PDGLD-152](https://victoranhernandez.atlassian.net/browse/PDGLD-152): validar resultados confirmados, empate/victoria/derrota, default, desempates, reenvíos e interrupción, con evidencia y enlace de CI. Se contrastó también [PDGLD-85](https://victoranhernandez.atlassian.net/browse/PDGLD-85). La implementación y las pruebas de esta entrega no equivalen a aceptación humana de toda PDGLD-29.

## Piezas disponibles y bloqueo real

| Pieza | Evidencia de código | Estado |
| --- | --- | --- |
| Escritura de cédula y validaciones de captura | [mutateReportInTransaction](../../src/features/match-reports/server/service.ts), [reportAccess](../../src/features/match-reports/server/access.ts), [firmas](../../src/features/match-reports/server/signatures.ts) | Reales: identidad obtenida por servidor, permisos de captura, liga/temporada/partido, designación efectiva del árbitro, versiones, elegibilidad, sello, eventos, marcador y referencias de firmas. |
| Resultado oficial | [applyConfirmationEffects](../../src/features/match-reports/server/confirmation-effects.ts) crea match_results MATCH_REPORT con autor; [esquema](../../prisma/schema.prisma), modelo match_results | Escritura real y única por partido dentro de la transacción. El bloqueo de dependencias impide alcanzarla desde el cierre oficial. |
| Inicio del partido | [startReportMatchInTransaction](../../src/features/matches/server/report-start.ts) | Real: IN_PROGRESS e historial; su contrato excluye expresamente la finalización. |
| Finalización autorizada de PDGLD-85 | [ConfirmationEffects.finishMatch y getConfirmationEffects](../../src/features/match-reports/server/confirmation-effects.ts) | Falta el adaptador oficial de FINISHED con matriz de autoridades, transición, motivo, versión e historial. La tabla de transiciones no implementa por sí sola ese servicio. |
| Clasificación derivada de PDGLD-29 | [calculateConfirmedReportStandingsInTransaction](../../src/features/standings/server/service.ts) | Integrada en esta entrega; utiliza el mismo motor de PDGLD-150 y la misma transacción del cierre. |
| Incidentes graves y disciplina | [ConfirmationEffects.openIncidentCases](../../src/features/match-reports/server/confirmation-effects.ts), [catálogo](../../src/features/discipline/server/catalog.ts), modelos disciplinary_cases/match_events | Falta el receptor oficial de expedientes e idempotencia. El catálogo administra artículos, no recibe incidentes. La captura valida descripciones para tipos que requieren expediente y ofrece eventIds/dismissals; el receptor debe revisar también tipos de evento y narrativas persistidas. No se inventan sanciones automáticas. |
| Rol de ejecución | [runtime-plan.mjs](../../scripts/preview/runtime-plan.mjs), readColumns/insert/update | Falta acordar y validar el plan mínimo de cierre: lectura completa/escritura de resultados y clasificación, y UPDATE de status/confirmed_at de la cédula. La prueba añade ACL/políticas solo a su base desechable; no cambia el plan desplegable. |

`getConfirmationAvailability()` sigue devolviendo false y `getConfirmationEffects()` sigue lanzando `CONFIRMATION_DEPENDENCIES_PENDING`. Ninguna variable, dato de navegador o matriz habilita un cierre parcial. Se retiró PDGLD-29 de la lista de receptores faltantes, también del informe histórico generado por `scripts/test-pdgld149.mjs`; los otros bloqueos permanecen.

## Implementación

`applyConfirmationEffects` crea el resultado, llama al finalizador, marca CONFIRMED la cédula y luego invoca el motor real; finalmente llama al receptor disciplinario. Así el cálculo ve FINISHED, el resultado oficial, la cédula confirmada y sus eventos persistidos en la misma transacción, sin consultas por HTTP ni transacciones anidadas. La versión de tabla incorpora la versión final del reporte. También refresca los cortes posteriores ya materializados del grupo, para que una confirmación tardía no deje aquellas versiones vigentes desactualizadas.

La función derivada vuelve a autorizar `match-reports:UPDATE` usando reportAccess y obtiene grupo/jornada de la base, no del payload. Exige temporada abierta, cédula confirmada con fecha, FINISHED y resultado MATCH_REPORT que cuenta en tabla. No otorga `competitions:UPDATE` al capturista: el cálculo independiente sigue denegado a esa cuenta.

El cierre usa SERIALIZABLE y bloqueo por grupo. Se conserva READ COMMITTED y el bloqueo por persona de la captura de participaciones. Para compatibilizarlos, confirmar exige exactamente el borrador guardado y firmado, con versiones y sello vigentes, y no reescribe eventos, alineaciones ni periodos. Un cambio pendiente se rechaza con `CONFIRMATION_REQUIRES_SAVED_DRAFT`: debe guardarse y recibir acuse primero. La presentación guardada también queda CONFIRMED/FINISHED, con fecha y captura deshabilitada.

`createReportWriter` es un punto de composición de servidor; las rutas y sincronización conservan el escritor por defecto bloqueado. Se reintenta toda la transacción, hasta cuatro reintentos adicionales, únicamente ante P2034/40001/40P01, conservando operación, comando y hora recibida. Cada intento reautoriza. El clasificador compartido [transaction-conflict.ts](../../src/server/db/transaction-conflict.ts) mantiene los reintentos existentes del motor. Otros errores se propagan; no se repiten efectos parciales ni I/O externo. El acuse de match_report_syncs se guarda con el cierre; un reenvío devuelve ese mismo acuse antes de volver a aplicar efectos.

## Prueba transaccional con dependencias de prueba

Comandos terminados con código 0:

- `npm run test:standings-confirmation` — PostgreSQL 15.
- `npm run test:standings-confirmation -- --postgres=17` — PostgreSQL 17.

La prueba [standings-confirmation.ts](../../tests/integration/standings-confirmation.ts) se ejecuta desde el runner desechable de cédulas, reutilizando sus cuentas sintéticas, permisos RF22, alineaciones selladas, elegibilidad y firmas privadas locales. Se usan Prisma/PostgreSQL reales y el servicio real de escritura. **finishMatch y openIncidentCases son TEST ADAPTERS**: escriben finalización/historial y un expediente sintético dentro de tx, pero no representan los servicios oficiales pendientes. El calculador es el real y no es sustituible mediante esos adaptadores. Las ACL/RLS adicionales existen solo en la base del fixture, con rol de ejecución no propietario.

El reglamento sintético se crea como una versión nueva, se aprueba y vincula a la categoría: puntos 3/1/0 y desempates GOAL_DIFFERENCE, GOALS_FOR. No se alteran parámetros de reglas ya aprobadas. La cédula ya guardada contiene un gol local, una amarilla visitante y una roja directa al jugador local ya sustituido, además de los eventos de captura previos.

| Equipo | Antes PJ / puntos / GF / GC | Después PJ / PG / PE / PP / GF / GC / DG / puntos | Tarjetas observadas después |
| --- | --- | --- | --- |
| Local | 0 / 0 / 0 / 0 | 1 / 1 / 0 / 0 / 1 / 0 / 1 / 3 | 1 roja directa |
| Visitante | 0 / 0 / 0 / 0 | 1 / 0 / 0 / 1 / 0 / 1 / -1 / 0 | 1 amarilla |

El tercer equipo conserva PJ=0 y puntos=0. El gol se atribuye una sola vez al jugador registrado; todos los eventos persistidos entran en el snapshot. Los indicadores oficiales de completitud continúan UNKNOWN/null según PDGLD-150: contar eventos no certifica captura exhaustiva de tarjetas/goleadores.

Se lanzan **tres confirmaciones concurrentes de la misma operación antes del primer éxito**, por el transporte sync; todas devuelven el mismo acuse. Un reenvío secuencial online también coincide. Incrementos comprobados: un resultado, un historial, un acuse, un expediente sintético y dos versiones de clasificación (una para el corte del partido y otra para el corte posterior que ya existía). Un cálculo independiente de comprobación reutiliza la huella final. Los reenvíos y correcciones rechazadas no cambian el snapshot posterior ni duplican estadísticas. Otra cuenta autorizada no puede apropiarse del acuse; una cuenta de otra liga no puede confirmar. Una operación nueva sobre el partido finalizado se rechaza.

El fallo `PDGLD152_CONTROLLED_ROLLBACK` se lanza desde el receptor sintético **después** de crear el expediente y comprobar en tx cédula CONFIRMED, resultado y ambas versiones nuevas de clasificación. Tras abortar, el snapshot coincide exactamente con el anterior: reporte, partido, eventos, alineaciones, periodos y conteos de resultados, historial, versiones, entradas, expedientes, auditoría y acuses. La operación sigue UNKNOWN. No se conserva un cierre ni tabla parcial.

La reapertura de la cédula mediante getReportPage devuelve CONFIRMED/FINISHED y captura deshabilitada. La consulta real que alimenta `/standings`, getStandingWorkspaceForActor, devuelve la versión 2 y los puntos nuevos, incluido el corte posterior. Esta comprobación es de servicio con backend real; **no es una demostración de navegador del cierre oficial**.

## Recorrido HTTP autenticado y verificaciones

- `npm run test:match-reports`: correcto, PostgreSQL desechable y sesión NextAuth real por HTTP. Comprueba acceso propio/ajeno/anónimo, página conectada, firmas privadas, recuperación de acuse perdido y replay. La confirmación oficial devuelve **409 CONFIRMATION_DEPENDENCIES_PENDING** y conserva DRAFT/IN_PROGRESS y versión previa. No se inyectan adaptadores de prueba en HTTP.
- `npm run test:standings-integration` y `npm run test:standings-integration -- --postgres=17`: **18/18 en cada versión**. Se conservan victoria, empate, derrota, default 1–0 en ambas localías (3/0 puntos), criterios configurados, empate pendiente, eventos/segunda amarilla, ámbito, reglas aprobadas, reenvíos, concurrencia y rollback. Los resultados administrativos/default son fixtures SQL, sin afirmar un recorrido oficial de no presentación.
- `npm run test:match-report-tactics`: **22/22**; reloj, capitanes, sustituciones y participaciones por mitad.
- `npm run test:match-report-client`: **3/3**; recuperación y contenido estable de operaciones.
- `npm run test:match-report-storage`: **1/1**; perfil de firmas privado local.
- `npm run test:ci`: **97/97**.
- `npm run typecheck`, `npm run lint`: correctos.
- `MIGRATION_BASE_SHA=5b3ea851ae11d8b64d14b8c95fba1dc792dace81 npm run ci:guard-migrations`: correcto. No se cambian esquema ni migraciones.
- `git diff --check`: correcto.

El [workflow](../../.github/workflows/ci-cd.yml) incluye ahora test:standings-confirmation en PostgreSQL 15 y 17, nombrando las dependencias sintéticas. Se preparó su ejecución futura; no se ejecutó CI remoto ni se declara verde para un commit no publicado. Los runners aplican las 52 migraciones en contenedores propios con puerto de loopback y los eliminan al terminar. Datos y firmas sintéticos, sin bases habituales, producción ni llamadas reales CURP/INE/correo.

## Pendientes de aceptación

No se pudo demostrar el recorrido oficial autenticado cédula → cierre → FINISHED → `/standings`: faltan los receptores de finalización e incidentes y su plan mínimo de permisos. Integrar esos servicios en getConfirmationEffects y su disponibilidad, revisar la exigencia de guardar antes de confirmar en el flujo UI/offline, y entonces ejecutar el recorrido con sesión y navegador reales. No se habilitó el cierre para aparentar una aceptación completa. La revisión humana de PDGLD-29/152 sigue pendiente. Sin despliegue, push, PR ni cierre/cambios en Jira.
