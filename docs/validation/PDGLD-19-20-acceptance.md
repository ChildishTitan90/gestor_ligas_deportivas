# Evidencia y aceptación PDGLD-19 / PDGLD-20

Fecha de ejecución: 19 de noviembre de 2026. Rama `feat/PDGLD-19-20-cedula-offline-sync`; destino propuesto `develop`. Datos, personas y trazos sintéticos. Sin proveedores externos de identidad.

## Comandos reproducibles

Con Docker y Chrome disponibles, ejecutar secuencialmente:

```powershell
npm run test:match-report-offline -- --postgres=15
npm run test:match-report-offline -- --postgres=17
npm run test:pdgld149 -- --postgres=15
npm run test:pdgld149 -- --postgres=17
npm run test:pdgld149 -- --regression --postgres=15
npm run test:pdgld149 -- --regression --postgres=17
npm run typecheck
npm run lint
npm run test:ci
```

El runner offline compila con el mismo `next build` de `npm run build`, dentro del entorno sintético y con certificados del sistema. Termina automáticamente, cierra su Chrome y elimina su PostgreSQL/Storage temporales. Usa puerto 3298. La regresión principal usa 3398; el entorno manual conserva 3198. Los directorios de compilación están separados y excluidos de Git/ESLint.

El job existente de cédula ejecuta también el nuevo comando para cada versión de PostgreSQL. Conserva los controles anteriores, el bloqueo oficial y el check conjunto del CI. Artefactos nuevos: exclusivamente JSON de criterios y conteos, sin nombres, UUID de cuenta, payloads ni imágenes de firmas. Las comparaciones completas usan huellas en memoria para evitar volcados de contenido al fallar.

## PDGLD-19

| Criterio | Prueba | Resultado | Pendiente |
|---|---|---|---|
| Preparar solo partido autorizado y separar datos privados | `prepareOwnReport`, HTTP cuenta ajena; Chrome inspecciona Cache Storage | Pasó PG15/17 | Prueba física Android/iOS |
| Preparación incompleta conserva la entrada con conexión | Chrome corta el snapshot autorizado, comprueba ausencia de copia y ofrece el editor con conexión | Ver nueva ejecución al final | Corte durante descarga de cada tipo de recurso estático |
| Primera edición online sin Guardar, corte brusco, más captura | Chrome edita observación, inicia reloj y registra incidente sin red | Pasó PG15/17 | Ninguno en ese recorrido |
| Cierre y reapertura offline de última revisión | Compara huella de todo el reporte: alineaciones, dorsales, capitanes, periodos, eventos, marcador, observaciones, firmas y reloj | Pasó PG15/17 | Desalojo del almacenamiento por SO real |
| Sin espacio: memoria, aviso y reintento | Cuota real de Chrome, escritura rechazada, copia durable previa intacta, reintento al liberar cuota | Pasó PG15/17 | Dispositivo físico con disco lleno |
| Cambio de cuenta conserva y aísla los pendientes | Cuenta ajena abre la página offline sin ver la cédula anterior. La reautenticación del titular recupera borrador e intención | Ver nueva ejecución al final | Prueba en dispositivo físico |

## PDGLD-20

| Criterio | Prueba | Resultado | Pendiente |
|---|---|---|---|
| Apertura, reconexión y botón manual recuperan pendientes | Chrome restablece transporte, pulsa Sincronizar y vuelve a abrir online con intención sin acuse | Pasó PG15/17 | Ninguno en esos disparadores |
| Commit con respuesta perdida; mismo UUID y contenido | CDP corta respuesta HTTP después del commit; replay devuelve mismo acuse; SQL comprueba un registro y conteo de eventos estable | Pasó PG15/17 | Ninguno |
| Mismo UUID con otro contenido se rechaza | POST real con UUID original y observación diferente, 409 `OPERATION_KEY_REUSED` | Pasó PG15/17 | Ninguno |
| Acuse anterior conserva edición nueva; dos pestañas ven revisión confirmada | Respuesta real demorada, edición durante espera, observador comparte operationId/revisión; SQL conserva solo revisión enviada hasta siguiente sync | Pasó PG15/17 | Carrera simultánea de edición en ambas pestañas, además del observador |
| Firma subida con respuesta perdida o enlace pendiente | Chrome corta respuesta de firma, conserva claves originales y reintenta sin duplicar archivos; integración SQL interrumpe PUT antes de enlace | Pasó PG15/17 | Cierre del navegador exactamente entre PUT y checkpoint |
| Sesión vencida / cuenta ajena / revocación | NextAuth real, intención conservada, misma cuenta recupera UUID; HTTP ajeno denegado; revocación durante captura bloquea la UI y conserva la copia y la intención | Pasó PG15/17 | Ninguno en los supuestos probados |
| Reprogramación y versión obsoleta | Snapshot antes/después de simular una reprogramación versionada de cancha del fixture futuro; comando antiguo rechazado. Otro dispositivo cambia versión; UI muestra comparación y conserva copia | Pasó PG15/17 | Ninguno en los escenarios descritos |
| Fallo transaccional | Trigger solo en PostgreSQL desechable provoca fallo; versión/proyección/eventos intactos y sin acuse; tras retirar fallo, mismo UUID recibe acuse | Pasó PG15/17 | Ninguno |
| Borrador distinto del cierre oficial | Botón bloqueado. Fixture listo para cierre: POST devuelve `CONFIRMATION_DEPENDENCIES_PENDING`; navegador con reloj activo: `CLOCK_STILL_RUNNING`. Resultados, versiones/entradas de clasificación, suma de puntos y expedientes no aumentan | Pasó PG15/17 | Integrar cierre oficial, clasificación y expedientes; no aceptados por estas pruebas |

## Controles generales

- Recorrido offline completo en PG15 y PG17: aprobado, 11 operaciones distintas y 11 acuses en cada versión. Las claves reales permanecen solo en la base desechable; el JSON publica conteos.
- Regresión `--regression` del paso de #207 en PG15/17: elegibilidad, designaciones, identidad histórica y firmas aprobadas. El historial interno también ejecuta PG15/17.
- Regresión principal `test:pdgld149` en PG15/17: 16 comprobaciones de reglas/cliente, 20 pruebas de componentes y la integración HTTP/Chrome/PostgreSQL aprobadas. La repetición final fue secuencial; una ejecución anterior concurrente falló en una expectativa de foco de la vista previa. El registro final es `checks.json` de cada versión.
- `npm run lint`, `npm run typecheck` y compilación de producción (`next build`, el comando de `npm run build`, dentro del entorno sintético): aprobados.
- `test:ci`: 94/94 aprobados en Node 24 Linux, en contenedor sin red y con el repo de solo lectura. En Windows persisten fallos auxiliares por enlaces simbólicos/instalación independiente; no se alteraron esas pruebas para ocultarlos.
- Las ejecuciones iniciales detectaron ajustes necesarios en los fixtures: versionar la reprogramación simulada y respetar reservas e inmutabilidad de designaciones. Se conservan esos controles de la base. Los selectores de prueba esperan el foco inicial del diálogo; las aserciones de accesibilidad no se retiran.

Para reproducir `test:ci` en Linux desde PowerShell:

```powershell
docker run --rm --network none --mount "type=bind,source=${PWD},target=/workspace,readonly" --workdir /workspace node:24 npm run test:ci
```

## Lectura de la evidencia

`.codex-attachments/pdgld19-20/pg15/browser.json` y `pg17/browser.json` contienen solo criterios aprobados y conteos. Su presencia se genera al terminar todas las aserciones. `failure.json` indica un intento fallido, no aceptación. Las regresiones escriben `checks.json` y `regression.json` bajo `.codex-attachments/pdgld149/pg15` y `pg17`.

El paso de designaciones de #207 se repitió. Se corrigió únicamente su selector de `dialog` a `dialog[open]`: el nuevo aviso de cierre de sesión también existe cerrado en el DOM. Las aserciones sobre asignación, foco y acceso permanecen. Esto no atribuye la falla original de #207 a esa misma causa.

## Seguimiento de firmas en CI · 19 de noviembre

La corrida `44556566670`, job `135674096894` (PG17), terminó esperando la vista previa de una firma en `tests/e2e/match-reports-real.mjs`. Reglas, componentes, compilación y HTTP habían pasado. La versión original también pasó en el intento local de Windows anterior al ajuste; no se reprodujo el timeout exacto de Linux.

Las suites principal y offline ahora comparten `tests/e2e/report-signature-browser.mjs`. El gesto usa eventos nativos, espera el diseño tras `onBegin`, separa los movimientos para respetar el throttle de 16 ms, comprueba tinta y vista previa cargada, y espera la vinculación asíncrona de cada firma antes de dibujar la siguiente. Se sustituyen botones por posición por sus nombres visibles. Se conservan las comprobaciones de recuperación, firmas privadas, acuses y cierre oficial bloqueado. El cambio corrige esas esperas ausentes en la automatización; confirmar la resolución de la corrida requiere repetir CI en Linux.

Verificación posterior al ajuste, secuencial en Windows con Chrome real y PostgreSQL desechable:

- `npm run test:pdgld149 -- --postgres=17`: pasó (16 pruebas de reglas/cliente, 20 de componentes e integración HTTP/Chrome; dos firmas privadas guardadas, reabiertas y cargadas).
- `npm run test:match-report-offline -- --postgres=17`: pasó (25 criterios, 11 operaciones distintas y 11 acuses; incluye firmas recuperadas sin red y subida interrumpida).
- ESLint de los tres archivos de prueba y `git diff --check`: pasaron. Ambas suites compilaron la aplicación de producción y completaron TypeScript.
- Evidencia local: `.codex-attachments/pdgld149/pg17/checks.json`, su `browser.json` y `.codex-attachments/pdgld19-20/pg17/browser.json`. No se repitió PG15 en este seguimiento.

## Integración con PDGLD-16 desde develop · 19 de noviembre

Base incorporada: `origin/develop` en `821ac86` (PR #63). Los conflictos se resolvieron conservando ambos contratos:

- `report-workspace.tsx`: estado durable del dispositivo y reloj offline, junto con `halfReservationData` y sus restricciones de alineación.
- `feedback.ts`: mensajes de conflicto/fecha offline y mensajes de participación por mitades.
- `server/service.ts`: una sola transición del reloj, antes de evaluar elegibilidad por mitades, usando el `occurredAt` original y sus límites de antigüedad/orden. Se mantienen bloqueo por persona, revalidación, transacción e idempotencia.

La integración verifica que el inicio real de la primera mitad sea la hora capturada offline. El recorrido de navegador conserva las aserciones del PR #63 sobre reserva de primera mitad y salida al minuto 12 al guardar/reabrir. Espera un **nuevo ID de operación reconocido en IndexedDB** antes de consultar los periodos del servidor; el acuse anterior continúa visible mientras se guarda la revisión siguiente y no acredita ese nuevo guardado.

El fixture de revocación offline usa un borrador previo sin convocados. Antes comprueba que intentar reutilizar a los jugadores del primer encuentro todavía en juego devuelve `PARTICIPATION_CLOCK_REQUIRED`: la separación del horario no demuestra que terminó la participación real. Así se conserva ese control deportivo y se prueba por separado la revocación visible, la copia local y la intención pendiente.

Un intento intermedio de componentes falló al comprobar el foco en «Abrir cédula» en la vista previa sintética; pasó al repetir la suite aislada, sin retirar la aserción ni modificar el componente. No se considera diagnosticada esa intermitencia. La confirmación de CI remoto sigue pendiente de publicar el merge.

Verificación final del merge, con datos sintéticos y PostgreSQL desechable:

| Comando | Resultado |
| --- | --- |
| `npm run test:pdgld149 -- --postgres=15` y `--postgres=17` | Pasaron: 17 reglas/cliente, 20 componentes, HTTP, firmas y navegador en cada versión. Incluyen compilación de producción y TypeScript. |
| `npm run test:match-report-offline -- --postgres=17` | Pasó: 25 criterios, 10 operaciones distintas y 10 acuses. La preparación de revocación usa un guardado previo en lugar de sello e inicio; por eso cambia el conteo del recorrido anterior. |
| `npm run test:match-eligibility-integration -- --postgres=15` y `--postgres=17` | Pasaron: 21 pruebas en cada versión, incluidos bloqueos entre capturas, marcas reales y persistencia de mitad/tiempos. |
| `npm run test:match-report-tactics` | Pasó: 21 pruebas. |
| `npm run typecheck`, `npm run lint` y ESLint final de las pruebas ajustadas | Pasaron. |
| `npm run test:ci` en Node 24 Linux, sin red y con el repo de solo lectura | Pasó: 94 pruebas. |

En este seguimiento no se repitieron el recorrido offline PG15 ni la regresión completa `--regression`. La evidencia actual de cédula está en `.codex-attachments/pdgld149/pg15` y `pg17`; la offline en `.codex-attachments/pdgld19-20/pg17/browser.json`. No se generan imágenes de firmas.

## Corrida #216: posición del lienzo de firma

La corrida `44652075675` falló en offline PG17, en `report-signature-browser.mjs`, antes de dibujar: `The real canvas receives the pointer` devolvió `false`. El job agregado mantuvo su bloqueo porque falló un job requerido; no se modifican sus condiciones.

Se reprodujo la misma aserción en Chromium Linux con `ReportClosing` y `DirectSignatureField` reales: un foco tardío desplaza la página después de llevar el lienzo a la vista. `ReportWorkspace` también programa el foco/desplazamiento del encabezado al navegar. La prueba nueva `report-signature-browser.test.mjs` fuerza ese orden mediante un evento de scroll real; con el helper anterior falla y con el corregido pasa a 390 y 1440 px.

El helper espera un lienzo visible y reposiciona dentro de un plazo de 45 segundos hasta que el centro y los diez puntos del trazo reciben el puntero según `elementFromPoint`. Conserva la aserción, el trazo nativo, la vista previa, la confirmación y la vinculación. No oculta elementos ni inyecta firmas. El runner `test:pdgld149` incluye la nueva regresión y ejecuta ambos archivos de componentes secuencialmente.

Verificación posterior:

- Linux/Chromium: la regresión falló con el helper anterior y pasó con el corregido. Los dos archivos de componentes, ejecutados secuencialmente, aprobaron sus 21 pruebas. Se usó la imagen local de reproducción con dependencias Linux y los iconos JavaScript instalados montados en solo lectura; no se instaló ningún paquete ni se permitió red.
- Windows/Chrome y PostgreSQL 17 desechable: `npm run test:pdgld149 -- --postgres=17` pasó (17 reglas/cliente, 21 componentes e integración HTTP/navegador); compilación de producción y TypeScript incluidos.
- Windows/Chrome y PostgreSQL 17 desechable: `npm run test:match-report-offline -- --postgres=17` pasó (25 criterios, 10 operaciones distintas y 10 acuses).
- ESLint de los archivos de prueba/runner modificados y `git diff --check`: pasaron. Los acuses y firmas siguen comprobándose; no se generan capturas de pantalla ni volcados de firmas.
- En este seguimiento no se repitió PG15 ni el backend completo en Linux. La corrida remota debe repetirse tras publicar el ajuste.

## Revisión de privacidad, reloj y disponibilidad del 19 de noviembre

La política de intervalos queda acordada en `docs/architecture/refereeing.md`.
Esta revisión filtra la agenda por fin exclusivo y conserva los antecedentes.
La implementación de la depuración de doce meses queda pendiente.

| Comportamiento | Evidencia ejecutada |
|---|---|
| Otra cuenta conserva y aísla el borrador anterior | Chrome real con cookies de dos cuentas, página offline y reautenticación del titular. Compara las huellas del contenido y de las intenciones pendientes |
| Salir de la segunda cuenta conserva la captura del titular | Salida real desde el shell y comprobación de IndexedDB |
| Salida del titular advierte sobre los pendientes | Chrome cancela el diálogo con sesión vencida y con sesión vigente. La misma intención permanece en IndexedDB |
| Navegador sin Service Worker conserva la captura en línea | Chrome deshabilita Service Worker y randomUUID, abre el editor, guarda y comprueba la observación en PostgreSQL. Usa UUID criptográfico compatible |
| Hora declarada conserva el reloj y exige revisión del traslado | Integración de elegibilidad en PG15/17 rechaza salida declarada, entrada declarada y marcas históricas sin origen. La separación horaria aparente por sí sola mantiene el bloqueo |
| El acuse conserva el origen de la hora | Integración de cédula verifica replay idéntico, frontera del dispositivo y frontera posterior del servidor |
| «No disponible» prevalece en el tramo coincidente | PostgreSQL conserva el bloqueo aunque se añada después otro intervalo disponible. Los partidos adyacentes siguen cubiertos |
| El fin es exclusivo y la agenda se actualiza abierta | Lectura real justo antes, al terminar y quince años después. El registro permanece en la base. Chrome comprueba desaparición del intervalo sin recarga |

Las regresiones de `test:pdgld149 -- --regression` aprobaron elegibilidad,
designaciones, identidad histórica y firmas en PG15 y PG17. El recorrido offline
aprobó en ambas versiones con once operaciones distintas y once acuses. Los
componentes arbitrales aprobaron tres pruebas en Chrome. Las reglas de cédula,
reloj y mitades aprobaron 22 pruebas, y el monitor de sesión aprobó ocho.
ESLint y TypeScript aprobaron. Los 94 controles de CI aprobaron en Node 24 Linux,
en contenedor sin red y con repositorio de solo lectura.

La regresión principal detectó que su fixture reutilizaba jugadores de un
encuentro HTTP sin marcas comprobadas para el traslado. El recorrido Chrome ahora
usa personas sintéticas independientes y dorsales propios. La suite de
elegibilidad conserva las aserciones del cruce y del rechazo por evidencia ausente.
La prueba de navegador espera el acuse de inicio del reloj y después la revisión
que contiene el incidente. Mantiene la comprobación de salida al minuto 12 en la
base, evitando confundirla con un acuse anterior.
La compilación de producción pasó durante ambas matrices offline. La revisión
humana de un traslado conserva el bloqueo hasta contar con evidencia suficiente.

La ejecución final completa del comando `test:pdgld149` aprobó en PG15 y PG17.
Cada versión ejecutó 17 pruebas de reglas/cliente, 21 pruebas de componentes y
la integración real HTTP/Chrome/PostgreSQL, con compilación de producción.
Los resultados finales están en `.codex-attachments/pdgld149/pg15/checks.json`
y `.codex-attachments/pdgld149/pg17/checks.json`.
El estado `acceptance: BLOCKED` identifica las dependencias de cierre oficial
que el propio runner comprueba.

Comandos de esta revisión, todos aprobados en la ejecución final correspondiente.

```powershell
npm run test:pdgld149 -- --postgres=15
npm run test:pdgld149 -- --postgres=17
npm run test:pdgld149 -- --regression --postgres=15
npm run test:pdgld149 -- --regression --postgres=17
npm run test:match-report-offline -- --postgres=15
npm run test:match-report-offline -- --postgres=17
npm run test:referees:components
npm run test:referee-availability-ui
npm run test:match-report-tactics
node --test src/features/auth/components/session-activity.test.mjs
npm run typecheck
npm run lint
```

La repetición final offline PG17 también ejercitó el aviso de salida con sesión
vencida, la cancelación del aviso y el cierre de sesión de una segunda cuenta.
PG15 validó el recorrido de cambio de cuenta y conservación del borrador.
`test:ci` se ejecutó con el contenedor Linux de solo lectura descrito arriba.

## Seguimiento del fallo de CI en el cambio de cuenta

La corrida [44684659304, job PG15](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/44684659304/job/136116030493)
falló en `match-reports-offline.mjs:370`, al esperar el texto de ausencia de
copias para la segunda cuenta. El log adjunto muestra preparación, recuperación
offline y sincronización SQL completadas antes de esa consulta.

La prueba lanzaba dos navegaciones consecutivas y evaluaba
`document.body.innerText` durante la carga. Se reprodujo con Chrome real,
sirviendo primero una cabecera HTML y manteniendo pendiente el cuerpo.
La consulta original produjo `TypeError`; CDP devolvió `text: "Uncaught"`,
que era el único detalle conservado por la conexión de esta suite.

`match-report-browser-wait.mjs` comprueba la presencia del cuerpo antes de
evaluar la condición y conserva los 450 intentos, la pausa de 100 ms y la
propagación de errores de la expresión. El recorrido también espera que termine
la navegación a `/matches` antes de abrir la copia offline. El recorrido comprueba
privacidad, conservación, revisión, UUID y acuse.
El diagnóstico identifica esa fase como `account-switch-and-restoration`.

La regresión se añadió a `chrome-session.test.mjs`, ejecutado por
`npm run test:browser-harness` en el job de aplicación. Falló con la espera
original y pasó con la corregida. También comprueba que un `TypeError` deliberado
con el documento listo se propague. El archivo completo aprobó sus siete pruebas
en Chromium Linux, dentro de un contenedor sin red y con repositorio de solo
lectura. La reproducción puntual también pasó en Chrome de Windows.

Los recorridos completos `npm run test:match-report-offline -- --postgres=15`
y `--postgres=17` aprobaron en Windows con Chrome real, NextAuth, Service Worker,
IndexedDB y PostgreSQL desechable. Cada versión confirmó once operaciones
distintas y once acuses, incluido el cambio de cuenta que falló en CI.
`npm run lint`, `npm run typecheck` y `git diff --check` aprobaron.
Ambos recorridos compilaron la aplicación de producción. La validación en
Linux de este seguimiento corresponde al archivo de pruebas del navegador.

## Demo de cinco minutos para el 20 o 23 de noviembre

1. `npm run match-reports:offline`; abrir el listado real del puerto 3198 con la cuenta sintética del runner.
2. Preparar REAL-147. Mostrar que el botón de captura aparece al terminar. Las alineaciones ya están selladas para ahorrar tiempo.
3. Escribir una observación sin Guardar y enseñar revisión local. Cortar red en DevTools, añadir incidente y dos trazos sintéticos.
4. Cerrar pestaña y reabrir `/offline/report` sin red. Mostrar mismo borrador, observación, evento, firmas y reloj.
5. Recuperar red y mostrar acuse de borrador; enseñar que el cierre oficial continúa bloqueado. No presentar resultados oficiales, puntos o expedientes como implementados.

La demo manual no sustituye los casos automatizados de respuesta perdida, cuota y rollback. En teléfono físico se necesita un origen HTTPS de prueba; el modo móvil de Chrome no acredita soporte físico.
