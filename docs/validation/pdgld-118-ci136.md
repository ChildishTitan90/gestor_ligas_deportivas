# PDGLD-118 — corrección del CI #136 preparada para commit

Revisión del 6 de noviembre de 2026 sobre `a6397fd18251606eda22fb58de44b72f778264e9`,
[PR #43, Draft](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/43).
**Validación local aprobada; CI remoto de la corrección todavía pendiente.**
El [CI #136 original](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42176461712)
sigue fallido: Aplicación aprobó; PG15 falló en seed y PG17 en el arranque CDP.
No se ha publicado la corrección ni reintentado el job remoto.

## Resultados ejecutados

| Run / versión | Suite | Resultado | Limpieza |
| --- | --- | --- | --- |
| `.211`, sin base | browser-harness completo, incluido HTTP lento | 5/5 | Verificada |
| `.207`, PostgreSQL 15.19 (`150019`) | Seed completo | 19/19 | Verificada antes de PG17 |
| `.207`, PostgreSQL 15.19 | Demo-seed completo | 7/7 | Verificada antes de PG17 |
| `.207`, PostgreSQL 15.19 | Clubes, incluido recorrido de navegador | 13/13 | Verificada antes de PG17 |
| `.207`, PostgreSQL 17.11 (`170011`) | Seed completo | 19/19 | Verificada al terminar |
| `.207`, PostgreSQL 17.11 | Demo-seed completo | 7/7 | Verificada al terminar |
| `.207`, PostgreSQL 17.11 | Clubes, incluido recorrido de navegador | 13/13 | Verificada al terminar |
| `.213`, copia limpia sin base | Prisma generate, Next typegen y TypeScript | Aprobados, exit 0 | Copia y dependencias retiradas |

Las suites `.207` tuvieron cero fallos, cancelaciones, omisiones o pendientes.
Su supervisor terminó con exit 0, siguiendo PG15 → aprobación y limpieza
verificada → PG17 → aprobación y limpieza. No se repitieron browser-harness ni
las matrices de correo `.203`/`.204` para esa ejecución o para este cierre.

Los controles sin servicios aprobaron **91/91**, incluidos nueve controles de
descubrimiento CDP y ocho del perfil CI136. Lint, sintaxis y diff --check aprobaron.
El [resultado saneado](pdgld-118-ci136-isolated-results.json) conserva los resultados
por versión, integridad de dependencias y distinción de intentos históricos.

## PG15: inventario exacto del seed

El [job PG15 original](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42176461712/job/127755941293)
obtuvo 102 tablas y esperaba 101 en snapshot, línea 74 del commit original.
La migración de correo pendiente añade exactamente `account_email_changes`:

| Origen | Tablas nuevas | Total acumulado |
| --- | --- | --- |
| `0_init` | 96 | 96 |
| PDGLD-57 | club_affiliation_categories | 97 |
| PDGLD-64 | team_enrollment_operations | 98 |
| PDGLD-97 | player_curp_checks | 99 |
| PDGLD-13 | player_category_levels, player_category_participations | 101 |
| `20261105020000_pdgld118_pending_email` | account_email_changes | 102 |

Se mantiene la aserción exacta, ahora 102, con descripción de las seis adiciones
y comprobación explícita de account_email_changes. El snapshot conserva su
recorrido completo de tablas, filas, UUID, relaciones y auditoría para integridad,
rollback, idempotencia y concurrencia. No se modificó ninguna migración.

## PG17: descubrimiento y navegación de Chrome

El [job PG17 original](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42176461712/job/127755941257)
falló en launchChrome antes de manipular el diálogo de clubes: no apareció una
página cuyo origen ya coincidiera con la app en cinco segundos. La duración de
37.721 s incluía toda la subprueba y no mide la fase CDP. No había traza de targets
ni tiempos por fase para confirmar el estado específico de aquel navegador.

Se separan descubrimiento y navegación: el Chrome del proceso/perfil propio
arranca en about:blank; se selecciona esa página única y se verifica host, puerto
e ID exacto del WebSocket antes de conectar y enviar Page.navigate. Workers,
páginas ya navegadas, bootstrap ambiguo o endpoints ajenos no sirven de sustituto.
Solo se reintentan lecturas transitorias de descubrimiento; no acciones ni
aserciones funcionales. La reproducción pura demuestra el defecto del filtro
anterior con un target existente en about:blank, sin atribuir ese estado como
causa observada del job original.

Con waitForDocument se habilitan eventos antes de navegar, se espera load del
**frameId y loaderId devueltos por Page.navigate** y se comprueba URL completa y
readyState=complete antes de evaluar el documento. Se conservan eventos que
lleguen antes de la respuesta de navegación. Un load del contexto anterior no
satisface esa espera; las suites backend mantienen el contrato opt-in existente.
La referencia de [PageHandler de Chromium](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/page_handler.cc)
se utiliza para revisar navegación, sin identificar con ella la versión del CI.

Diagnóstico: fase, tiempos y contadores seguros, sin URLs, títulos, cuerpos,
cookies ni errores originales de transporte. Se conserva el cierre de sockets,
órdenes pendientes, grupo propio y perfil, también ante cancelación y señales.
Límites intactos: 30 s para publicar CDP, 5 s para descubrir página, máximo 1 s
por lectura dentro de ese plazo, 3 s de conexión y 5 s para carga inicial tras
Page.navigate cuando se solicita. Los comandos conservan su límite configurable
hasta 45 s. No se añaden pausas para sincronizar el documento.

## Caso HTTP lento: fallo `.208`, diagnóstico y aprobación `.211`

En `.208` falló esta aserción de chrome-session.test.mjs:47 de aquella copia:

```js
assert.equal(await browser.evaluate("document.body.innerText.includes('Documento sintético lento')"), true);
```

Valor real **false**, esperado **true**. La aserción previa de conexión CDP antes
de la respuesta sí aprobó. Los logs originales no registraban texto ni eventos,
por lo que no permiten reconstruir el orden exacto de esa instancia.

La reproducción sintética `.209`, con cuerpo equivalente sin charset, encontró
`Documento sintÃ©tico lento`, document.characterSet=windows-1252, origen esperado,
readyState=complete y JavaScript inline ejecutado. No evaluaba about:blank ni el
contexto anterior. Esto reproduce el falso por codificación; no inventa una
traza de `.208`. La fixture ahora declara text/html; charset=utf-8 y conserva
la comprobación del texto acentuado, además de comprobar charset y JavaScript.

Orden observado y estructural: conexión CDP → Page.navigate → petición HTTP →
respuesta tras demora sintética de 6.5 s → parseo/JavaScript inline → carga →
evaluación. En `.209`, conexión y respuesta de Page.navigate fueron a 4973 y
11594 ms desde el arranque del harness. Petición, envío y fin de respuesta HTTP
fueron a 5068, 11570 y 11595 ms desde el inicio de la reproducción; evaluación
a 11655 ms. Son dos relojes relativos distintos, que no se restan entre sí.
domComplete y loadEventEnd fueron 6552.5 ms desde el inicio de navegación.

`.210` aprobó 5/5 con UTF-8 y espera por loader; `.211` aprobó 5/5 con el cierre
ante señales incluido. No se aumentaron timeouts ni se relajó el contenido.
La demora pertenece al servidor sintético, no es una pausa de sincronización.

## Supervisor y aislamiento validados en `.207`

Se amplía el supervisor existente con el perfil exclusivo --ci136; no se crea
un runner paralelo. Reutiliza matriz, registro atómico, propietarios, Docker,
copias independientes, npm ci, configuración Turbopack y grupos de procesos.
Los validadores habituales conservan 5432/5433; solo las copias se adaptan para
aceptar exclusivamente 55433, con sustitución exacta que falla ante deriva.

Destino: **127.0.0.1:55433**, secuencial para postgres:15-bookworm y
postgres:17-bookworm. Antes de crear recursos se verificaron `.207` sin consumir,
puerto libre y ausencia de nombres exactos. Antes de las fases SQL se verifican
IDs registrados, etiquetas de propietario privado, imagen, estado, publicación
loopback exacta, red exclusiva, tmpfs sin bind/volumen, 768 MiB y 2 CPU. La versión
real se comprueba con SHOW server_version_num en el contenedor propio.

Cada copia omite .env y node_modules compartidos; incorpora prisma.config.ts
explícito y usa instalación/caché/configuración propias con integridad de package,
lock, versiones y resolución. Seed usa gestor_ligas_ci; clubes crea y retira
pdgld48_test_<16 hex>. No se modifican los timeouts internos: instalación hasta
600 s y presupuesto de versión 1200 s, como los perfiles independientes.
Las credenciales nuevas viajan solo en memoria/entorno del hijo.

Comando **ya ejecutado**, documentado para trazabilidad; **`.207` está consumido**:

```sh
node scripts/test-delegate-isolated.mjs --ci136 --execute --run-id 118e2026-1106-4a18-8a15-000000000207
```

Sin --execute, el supervisor solo presenta el plan. La utilidad
scripts/verification/ci136-port-plan.mjs también permanece en PLAN_ONLY.
Otra ejecución requeriría autorización y UUID nuevo. --cleanup con el mismo
perfil/registro solo sirve para recuperar recursos propios si hiciera falta.

Tras clubes se verificó ausencia de bases sobrantes y se retiró gestor_ligas_ci.
Después se comprobó independientemente la ausencia de ambos contenedores/redes
por **nombre e ID**, de app-pg15/17, npm-work-pg15/17, chrome-pg15/17 y de procesos
por rutas propias; el bind a 55433 volvió a aprobar. Ambas versiones registraron
passed=true, cleaned=true, pending=false. Cualquier fallo detiene la secuencia;
recuperación no adopta recursos ajenos ni oculta fallos de limpieza.

## TypeScript en copia limpia `.213`, sin bases

Se usó una copia nueva sin .env ni cachés .next, con dependencias independientes
exactas del lockfile y comprobación de integridad/versiones/resolución. Se copiaron
las fuentes y prisma.config.ts sin configuración sensible. Con entorno reducido,
sin DATABASE_URL/DIRECT_URL ni opciones de carga heredadas, aprobaron:

```sh
npm ci --include=dev --foreground-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ # caché/configuración privadas
node node_modules/prisma/build/index.js generate
node node_modules/next/dist/bin/next typegen
npm run typecheck
```

No se ejecutaron migraciones, seed, build, Next dev, Chrome o Docker. La generación
de Prisma y rutas no conectó bases. El cliente Prisma 7.10.1 se regeneró en la
copia y Next 16.4.3 regeneró tipos antes de tsc --noEmit --incremental false.
El lockfile mantuvo SHA256
818843564eb733efb3bae8e4f6f74ad9c8a57c29cf3fe21030040e84a4539482.
Copia, dependencias y procesos propios quedaron retirados al terminar.

El typecheck directo anterior del workspace fallaba por referencias .next
obsoletas y react-signature-canvas ausente en esa instalación. Se conserva como
intento histórico; la comprobación limpia aprobada `.213` resuelve la validación
sin tocar dependencias o cachés del equipo.

## Intentos históricos y conservación

| Run | Clasificación | Resultado / limpieza |
| --- | --- | --- |
| `.205` | Bloqueo del entorno | EADDRINUSE en 5433; cero conexiones; recursos previstos ausentes; registrado abortado |
| `.206` | Error del wrapper | Prefijo de captura rechazado tras npm ci; navegador no iniciado; copia retirada |
| `.208` | Fallo funcional del harness | 4/5; contenido lento false; copia/procesos retirados |
| `.209` | Diagnóstico sintético | Codificación incorrecta reproducida; HTTP/Chrome cerrados |
| `.210` / `.211` | Aprobaciones del harness | 5/5; limpieza verificada |
| `.207` | Aprobación PostgreSQL | Ambas versiones y limpieza aprobadas; no reutilizar run-id |
| `.213` | Aprobación sin servicios | Prisma/rutas/TypeScript aprobados; limpieza verificada |

Los bloqueos y fallos anteriores no se convierten en aprobaciones. `.203` y `.204`
son matrices previas de correo y no se atribuyen a esta corrección ni se repiten.
El CI remoto de la corrección queda pendiente de publicación y ejecución.

Solo se propone versionar código, pruebas y estos dos resúmenes saneados. Los
scripts temporales de diagnóstico, logs originales, registros privados y evidencia
permanecen fuera de Git en las raíces propias de /private/tmp. No se incluyen
secretos, tokens, cookies, respaldos, compose.yml ni los tres account-delegate-*.
Las fuentes registradas en `.207` coinciden con el código actual revisado.
No hay cambios de migraciones ni de lockfile. origin/develop permanece en
53c2628, ancestro de la rama. Sin bases habituales, Supabase, correos reales,
staging, commit, push, cambios remotos o integración de develop. Respaldos,
compose.yml, documentos internos y los nueve stashes se conservan.

## Selección exacta propuesta para commit

14 archivos; sin staging. La selección incluye los archivos nuevos:

```text
docs/validation/pdgld-118-ci136-isolated-results.json
docs/validation/pdgld-118-ci136.md
package.json
scripts/ci/chrome-page-discovery.test.mjs
scripts/ci/ci136-port-plan.test.mjs
scripts/ci/delegate-isolated-runtime.mjs
scripts/test-delegate-isolated.mjs
scripts/verification/account-independent-dependencies.mjs
scripts/verification/ci136-isolated-suite.mjs
scripts/verification/ci136-port-plan.mjs
tests/e2e/chrome-page-discovery.mjs
tests/e2e/chrome-session.mjs
tests/e2e/chrome-session.test.mjs
tests/integration/seed.test.ts
```

Resumen: inventario exacto de 102 tablas; descubrimiento CDP independiente de la
navegación, espera por loader y fixture UTF-8; regresiones puras en test:ci; perfil
CI136 del supervisor existente con puerto exclusivo y limpieza; resultados saneados.

Mensaje propuesto:

```text
fix(PDGLD-118): corregir inventario del seed y sincronización de Chrome en CI
```

Fuera de la selección: compose.yml, docs/validation/account-delegate-commit-plan.md,
docs/validation/account-delegate-pr-draft.md y
docs/validation/account-delegate-worktree-inventory.md. También quedan fuera
respaldos, .env, scripts de /private/tmp, logs y evidencia original. La selección
no incorpora archivos generados de Prisma/Next ni modifica migraciones publicadas.

Enlaces revisados: resultado JSON relativo y referencias de código resuelven;
PR #43, run #136, jobs PG15/17 y referencia Chromium consultados en solo lectura.
El PR sigue Draft sobre a6397fd; los jobs originales siguen fallidos.
