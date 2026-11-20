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
| No habilitar captura con preparación incompleta | Chrome corta respuesta del snapshot autorizado; no fila local ni enlace de captura | Pasó PG15/17 | Corte durante descarga de cada tipo de recurso estático |
| Primera edición online sin Guardar, corte brusco, más captura | Chrome edita observación, inicia reloj y registra incidente sin red | Pasó PG15/17 | Ninguno en ese recorrido |
| Cierre y reapertura offline de última revisión | Compara huella de todo el reporte: alineaciones, dorsales, capitanes, periodos, eventos, marcador, observaciones, firmas y reloj | Pasó PG15/17 | Desalojo del almacenamiento por SO real |
| Sin espacio: memoria, aviso y reintento | Cuota real de Chrome, escritura rechazada, copia durable previa intacta, reintento al liberar cuota | Pasó PG15/17 | Dispositivo físico con disco lleno |
| Cambio de cuenta elimina copias anteriores | Cambio de cookies autenticadas y navegación real; IndexedDB ya no devuelve la copia | Pasó PG15/17 | Revisión humana de la política de siete días y cierre explícito |

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

## Demo de cinco minutos para el 20 o 23 de noviembre

1. `npm run match-reports:offline`; abrir el listado real del puerto 3198 con la cuenta sintética del runner.
2. Preparar REAL-147. Mostrar que el botón de captura aparece al terminar. Las alineaciones ya están selladas para ahorrar tiempo.
3. Escribir una observación sin Guardar y enseñar revisión local. Cortar red en DevTools, añadir incidente y dos trazos sintéticos.
4. Cerrar pestaña y reabrir `/offline/report` sin red. Mostrar mismo borrador, observación, evento, firmas y reloj.
5. Recuperar red y mostrar acuse de borrador; enseñar que el cierre oficial continúa bloqueado. No presentar resultados oficiales, puntos o expedientes como implementados.

La demo manual no sustituye los casos automatizados de respuesta perdida, cuota y rollback. En teléfono físico se necesita un origen HTTPS de prueba; el modo móvil de Chrome no acredita soporte físico.
