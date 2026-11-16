# PDGLD-149: cobertura y evidencia

Revisión del 15 de noviembre de 2026 contra origin/develop `3b2e99e`.
Se consultaron en Jira PDGLD-18/147/148/149 y PDGLD-29 sin modificar sus datos.
La aceptación completa de PDGLD-18 y PDGLD-149 está **BLOQUEADA**.

## Comandos reproducibles

Requieren Node 24, dependencias instaladas, Docker y Chrome. `CHROME_BIN` permite
indicar Chrome; en CI se usa `/usr/bin/google-chrome`. Ejecutar secuencialmente:

```powershell
npm run test:pdgld149 -- --postgres=15
npm run test:pdgld149 -- --regression --postgres=15
npm run test:pdgld149 -- --postgres=17
npm run test:pdgld149 -- --regression --postgres=17
npm run typecheck
npm run lint
```

Los ejecutores crean contenedores y bases propios, sin volúmenes y sin heredar
conexiones del proyecto. No usan Supabase ni proveedores CURP/INE reales. Los
datos de identidad son sintéticos. El Next de pruebas usa su directorio de
compilación separado; no ejecutar dos suites HTTP al mismo tiempo en un checkout.

Cada versión conserva JSON, logs y PNG en `.codex-attachments/pdgld149/pg15` o
`pg17`. `checks.json` y `regression.json` enumeran pasos ejecutados y no ejecutados;
los fallos terminan con código distinto de cero. El job `match-reports` del CI
ejecuta ambas versiones y conserva artefactos incluso ante fallo. Su éxito solo
certifica las comprobaciones implementadas: el JSON sigue declarando aceptación
bloqueada. No se ha ejecutado GitHub Actions ni publicado esta rama por este trabajo.

## Correspondencia verificable

| Criterio | Prueba y alcance | Situación |
|---|---|---|
| PDGLD-147: actor, liga, designación, permisos retirados, UUID ajeno | `tests/integration/match-reports.ts`, HTTP con sesión NextAuth | Backend real, rol Preview y RLS |
| BORRADOR y FINALIZADO | Rechazo de escritura en ambos estados en la misma suite | Backend real |
| DATA_ENTRY sin suplantación | Guarda sin designación propia; conserva acceso al revocar al árbitro | Backend real |
| Elegibilidad, sanciones, superior autorizado, coincidencia pendiente | Regresión PDGLD-16 en `match-eligibility.ts` y guardado de jugador bloqueado | Política compartida; no concede excepción pendiente |
| Dorsal histórico, tiempos, cambios, capitanes, marcador, observaciones | Suite de integración y reglas de cédula | Borrador persistente; no resultado oficial |
| Reloj, descanso P2 45:00, no reingreso, doble amarilla, relevo de capitán | `lineup-clock.test.ts`, `tactics.test.ts`, Chrome de componentes | Reglas puras + UI con respuestas sintéticas |
| PDGLD-148: formaciones, colores, portero, arrastre/intercambio, modales | `match-report-demo.test.mjs` | Chrome sintético; no evidencia de backend |
| Firmas privadas e inválidas, vinculación, fallo externo | SQL/HTTP, `signature-storage-profile.test.ts`, regresiones de firmas | Objetos privados locales; no prueba de un bucket remoto |
| Firma dibujada, guardada y reabierta | `match-reports-real.mjs` | Chrome + NextAuth + HTTP + PostgreSQL + almacenamiento local reales |
| Concurrencia de borrador, clave reutilizada, pérdida de respuesta SQL | SQL y HTTP real (corte después del commit) | Un acuse, versión y eventos; no duplica el borrador |
| Rollback del borrador/reloj/inicio | Fallo inducido dentro de transacción real | No acredita rollback de efectos oficiales ausentes |
| Confirmaciones concurrentes | Dos comandos rechazados por dependencia pendiente | No acredita un único efecto oficial |
| Claro/oscuro, móvil/escritorio, teclado/foco | Chrome real y Chrome sintético, evidencia separada | Pantallas y operaciones implementadas |
| PDGLD-149: recorrido de cierre, resultado y clasificación | No hay receptores de finalización/clasificación/expedientes integrados | **BLOQUEADO** |

## Límite del recorrido real

El navegador real utiliza cookies obtenidas mediante login real y no reemplaza
`fetch`. Abre un partido sintético CONFIRMED sin cédula ni designación propia del
capturista: DATA_ENTRY accede por su ámbito. Desde UI elige formación, titular y
capitán de ambos equipos y un suplente local; confirma las vacantes intencionales
del fixture mínimo, guarda y bloquea la alineación e inicia el reloj. No simula
once jugadores registrados: la convocatoria completa se cubre en los componentes
y la prueba manual del Docker habitual. Registra desde UI la sustitución del
capitán con relevo obligatorio, un gol en 15:34 y un incidente grave sin minuto.
Comprueba teclado/retorno del foco, modifica observaciones, dibuja dos firmas,
guarda y reabre. Verifica ambas imágenes privadas, el incidente persistente y las
etiquetas de capitán inicial/en cancha. El resumen muestra Confirmar deshabilitado.

Antes del guardado se interrumpe la red de Chrome mediante CDP: no se devuelve
ninguna respuesta de negocio falsa. La captura y los trazos permanecen en la
página, el estado pasa a incierto, se restablece la red, se consulta el acuse y
se reenvía la misma operación. Se comprueba APPLIED mediante HTTP autenticado.
Esta recuperación requiere mantener abierta la página; no acredita offline,
IndexedDB ni Service Worker. El corte después del commit SQL se comprueba aparte
en la suite HTTP real.

Faltan `finishMatch`, el receptor real de clasificación con reglas versionadas de
PDGLD-29 y el receptor mínimo de expedientes. El contrato propuesto vive en
`src/features/match-reports/server/confirmation-effects.ts`. Sigue siendo una
propuesta, no un contrato acordado ni una integración completada. No hay evidencia
de resultado/puntos/expedientes únicos, ni rollback compuesto de esos efectos.
Se requieren las implementaciones reales para habilitar y aceptar esos criterios.
La lectura de PDGLD-29 en Jira confirma su alcance; su estado no sustituye código.

## Repetición manual

No se amplían permisos ni se modifica el flujo revisado. Si las pruebas encuentran
una corrección funcional, se registra aquí el caso que debe repetirse. No se
reinicializan PR86-04/05 ni cuentas del Docker habitual. Ninguna comprobación
equivale a entrega offline de PDGLD-19/20.

Corrección encontrada al inspeccionar el PNG real: el resumen etiquetaba al
capitán inicial como capitán vigente después de su cambio. Ahora distingue
capitán en cancha/capitán inicial y muestra el firmante por su identificador real.
Repetir manualmente: sustituir al capitán, elegir relevo, capturar la firma del
nuevo capitán, guardar, reabrir y comprobar ambas etiquetas y el firmante en Resumen.

## Resultados de esta ejecución

| Ejecución final | PostgreSQL 15 | PostgreSQL 17 |
|---|---|---|
| Reglas y recuperación del cliente (15 pruebas) | OK | OK |
| Chrome de componentes, respuestas sintéticas (19 pruebas) | OK | OK |
| SQL/HTTP + Chrome real + rol Preview/RLS + migraciones/plan de seguridad | OK | OK |
| Elegibilidad compartida (19 pruebas reportadas) | OK | OK |
| Designaciones, revocación, HTTP/Chrome y contratos de identidad | OK | OK |
| Historial de identidad y carreras de cierre | OK | OK |
| Validación, vinculación y perfil privado de firmas (13 pruebas) | OK | OK |

Tipado y lint completos: OK. También se ejecutaron las 42 pruebas de firmas
compartidas: OK. Todos los pasos de los cuatro informes finales terminaron con
código 0 y `notExecuted: []`; los informes mantienen `acceptance: BLOCKED`.

`npm run test:ci` falló en Windows por pruebas preexistentes dependientes de
symlinks/rutas Unix (también fuera del sandbox). Se contrastó en el Linux de
Docker con `npm run test:referees:regression -- --postgres=15`: los controles de
CI pasaron, además de migraciones, integridad/seguridad y 63 pruebas de regresión
de autorización. No se ocultó el fallo Windows ni se debilitó esa suite.

Se corrigieron dos supuestos del ejecutor: usar Webpack omitía las utilidades
Tailwind de esta instalación (ahora usa Turbopack y verifica CSS compilado), y el
test anterior de designaciones esperaba el título retirado de `/matches`.
Se conservó la denegación del partido revocado en ambas rutas. Se ajustaron las
esperas de foco/hidratación y el conteo de imágenes visibles del recorrido real;
no se sustituyeron respuestas del servidor. Los PNG de fallo de intentos previos
pueden conservarse como diagnóstico; `checks.json`/`browser.json` identifican la
ejecución final exitosa y sus bloqueos.

No ejecutado por dependencias ausentes: cierre oficial, clasificación, creación
de expediente y unicidad/rollback de esos efectos. No ejecutado: GitHub Actions
remoto, bucket Supabase real, proveedores CURP/INE reales, ni aceptación offline.
El recorrido completo hasta clasificación sigue sin acreditarse; no se declara
aceptado por las suites parciales anteriores.


## Incremento de convocatoria e iconos

Se añadieron convocatoria automática hasta once con dorsal válido/único, banca
para los siguientes y comprobación explícita de que arrastrar desde banca a un
puesto ocupado devuelve al titular a banca. Los iconos propios siguen la
referencia y se añadieron ASSIST y OWN_GOAL por migración aditiva del catálogo.
Las asistencias no alteran el marcador y los autogoles suman al contrario.
Se validaron en PG15/17 desechables y se aplicó solo esa migración al Docker
habitual. Los eventos previos se conservan. La leyenda de suspensión representa
los bloqueos existentes, sin añadir sanciones desde la captura.

Repetir manualmente antes de sellar una alineación: convocar trece jugadores con
dorsales únicos, comprobar once en campo y dos en banca, arrastrar un suplente
sobre un titular y comprobar el intercambio con la banca. Registrar una asistencia
sin cambiar el marcador y un gol en contra que sume al rival. El número vaciado
por el operador permanece pendiente y no se restaura silenciosamente al arrastrar.

## Revalidación previa al PR a develop

Ejecutada el 15 de noviembre de 2026 (Morelia), después de los ajustes finales de
iconos y alineaciones. `origin/develop` se actualizó y permaneció en `3b2e99e`.
Se repitieron los cuatro comandos de `test:pdgld149` de esta guía: cédula y
regresión en PostgreSQL 15 y 17. Los cuatro informes finales tienen todos sus
pasos con código 0 y `notExecuted: []`; conservan `acceptance: BLOCKED`.

La regresión de componentes comprueba también:

- Una amarilla y una roja ante segunda amonestación, conservando las dos
  amonestaciones originales en el historial.
- Lesión blanca sobre el campo en claro/oscuro; asistencia con `SportShoe` y
  balón de Tabler en el campo y modal.
- Flecha roja hacia abajo en el once inicial para quien salió de cambio y flecha
  verde hacia arriba para quien entró.
- Convocar trece jugadores llena once lugares y deja dos en banca; el arrastre
  intercambia posiciones y conserva el comportamiento de banca/puesto vacío.

También pasaron `npm run typecheck`, `npm run lint`, las 42 pruebas de
`npm run test:signatures`, las 12 de `npm run test:database-config` y
`npm run ci:guard-migrations` contra la referencia actualizada de develop.
`npm run test:referees:regression -- --postgres=15` pasó en Linux desechable:
incluye los controles `test:ci`, migraciones, integridad/seguridad SQL y las 63
pruebas de autorización. No equivale a ejecutar todos los jobs del workflow.

La compilación de producción con Next/Turbopack terminó con código 0, incluidos
TypeScript y la generación de páginas. Se usó `AUTH_TEST_RUN=1` para aislar la
salida en `.next-auth-tests`, variables sintéticas y una conexión de base
inaccesible de loopback; no se utilizó la conexión del Docker habitual ni
Supabase. El comando del proceso fue `node node_modules/next/dist/bin/next build`.
Se conserva el ejecutor local y su entorno en
`.codex-attachments/pdgld149/pre-pr/build-isolated.mjs`, junto a `build.log`,
`build.json` y `summary.json`.

### Fallos iniciales conservados

Una primera regresión de PG15 agotó la espera del diálogo de designaciones.
El ejecutor podía aceptar el DOM anterior al recargar la misma URL cuatro veces
para temas/tamaños. Ahora exige un `performance.timeOrigin` nuevo y observa el
retorno real del foco al cerrar. Se mantienen la apertura, Escape y la aserción
de foco; no se aumentaron los plazos ni se omitió el recorrido. Además se guardan
PNG y diagnóstico de navegador ante futuros fallos. La regresión completa pasó
después del ajuste en ambos motores. Este cambio afecta al ejecutor, no al
comportamiento de la aplicación que se revisó manualmente.

Un primer recorrido de PG17 registró recargas de Turbopack y agotó la espera de
la pantalla de captura. Ese intento no se cuenta como aprobado. En una repetición
secuencial sin editar fuentes durante Next dev, el recorrido real terminó con
guardado/reapertura, recuperación de red y dos firmas privadas cargadas, sin
reemplazar respuestas HTTP. Los primeros JSON/logs y la captura se conservaron en
`.codex-attachments/pdgld149/diagnostics-before-pr/`; los informes finales de cada
motor están en `pg15/checks.json`, `pg15/regression.json`, `pg17/checks.json` y
`pg17/regression.json`. Sus fechas están en UTC.

Esta revalidación no reinició datos del Docker habitual. El reinicio de
alineaciones de PR86-04 solicitado antes por el usuario fue una operación local
separada, con respaldo; no forma parte de las suites. No se ejecutó GitHub Actions
remoto, ni se creó commit, push, PR, merge, despliegue o cambio en Jira.

El PR debe declarar pendientes el cierre oficial con historial, el receptor de
clasificación PDGLD-29 y el receptor mínimo de expedientes. El éxito de estas
pruebas no acredita sus efectos transaccionales ni la aceptación completa de
PDGLD-18/147/149.

## Regresión del listado autorizado detectada en el PR

La revisión detectó que `getCaptureMatches` limitaba primero los partidos globales
a 100 y luego autorizaba cada resultado. Un partido accesible más antiguo podía
desaparecer y provocar un vacío incorrecto. La prueba anterior no cubría ese caso.

Ahora `readCaptureMatchIds` consulta las concesiones CREATE vigentes de RF22,
conserva unidos permiso/rol/ámbito y filtra liga, clubes activos y, para REFEREE,
la designación propia mediante `referee_assignment_effective`. DATA_ENTRY accede
por su ámbito sin suplantar al árbitro. El orden y `LIMIT 100` se aplican después
de esos filtros. Se mantiene además la revalidación con `reportAccess` por cada
partido antes de devolver sus datos. No se añaden permisos ni migraciones.

`tests/integration/match-report-list.ts` se ejecuta desde la suite de cédulas ya
conectada al CI. Con PostgreSQL real y el rol limitado Preview/RLS comprueba:

- 105 partidos posteriores de otra liga no ocultan el partido accesible antiguo
  del capturista ni del árbitro designado.
- 105 partidos posteriores de su misma liga sin designación no desplazan el
  partido propio del árbitro; otro árbitro sin designación recibe una lista vacía.
- Un ámbito de club permite los participantes y excluye clubes ajenos de su liga.
- Con más de 100 partidos autorizados se devuelven los 100 más recientes en orden
  estable; los eliminados no consumen el límite.
- Retirar el rol elimina el acceso; revocar la designación retira el partido del
  árbitro sin quitar el acceso del DATA_ENTRY autorizado.

Los partidos ajenos permanecen durante la prueba HTTP: `/matches` devuelve el
partido accesible antiguo con una sesión NextAuth real y no incluye los ajenos.
Los datos sintéticos respetan inscripción/distribución, disponibilidad de canchas
y reservas SQL; no se desactivan restricciones para prepararlos.

Se verificó primero que la prueba fallara con la consulta original por la aserción
del partido antiguo del DATA_ENTRY. Después pasaron, con la corrección, ambos
comandos completos (incluidos SQL, HTTP y Chrome reales):

```powershell
npm run test:pdgld149 -- --postgres=15
npm run test:pdgld149 -- --postgres=17
```

También pasaron tipado y lint de los archivos afectados. Los `checks.json` y logs
de `pg15`/`pg17` conservan la ejecución final; no se ejecutó CI remoto ni se
modificaron datos del Docker habitual o Supabase. Los bloqueos del cierre oficial
descritos anteriormente siguen pendientes.
