# Corrección del bloqueo de Chrome y captura de tutor — 04/11/2026

## Integración y diagnóstico

La referencia remota confirmó `4d795b4`, merge del PR #41 (PDGLD-109), en develop.
Se incorporó a la rama existente de PDGLD-13/14 con `--no-commit --no-ff`.
El conflicto de `affiliation-form.tsx` se resolvió conservando la captura directa,
las firmas existentes de correcciones y el aviso de almacenamiento no disponible.
No se publicó la rama ni se hizo merge del PR o despliegue.

La prueba original se reprodujo en Windows/Chrome: venció su timeout de 45 s y
el proceso siguió abierto. El diagnóstico por CDP comprobó navegador y conexión
activos, documento cargado, cuerpo vacío y `window.testDone` sin definir. Al
capturar errores de arranque apareció `ReferenceError: process is not defined`.

La vista de revisión ahora importa `SignatureReviewPreview`, que importa
`next/image`. El arnés es una página de React/esbuild sin runtime de Next.js.
Solo sustituía ActionLink; al evaluar la dependencia de imagen, el bundle fallaba
antes de asignar `testDone`. No era una espera de Supabase ni una subida de firma.
La evaluación CDP esperaba esa variable sin plazo, por fuera del helper. El
timeout de node:test no cancelaba ese trabajo ni garantizaba su finally, dejando
servidor y Chrome abiertos.

La API pública de GitHub respondió con límite de peticiones y la conexión de
diagnósticos de Code Review no estaba disponible. Por tanto, este documento
describe reproducción local; no atribuye mensajes no consultados a los logs del
runner remoto. Los SHA de checkout v6.1.0 y setup-node v6.5.0 se comprobaron con
las etiquetas oficiales mediante git ls-remote: coinciden con el workflow.

## Corrección

Archivos de la corrección y la captura de tutor, además de los archivos recibidos
del PR #41:

- `.github/workflows/ci-cd.yml` y `package.json`: checks de arnés y firmas.
- `tests/e2e/chrome-session.mjs`, `chrome-session.test.mjs` y
  `team-registration-session.test.mjs`: transporte, ciclo de vida y diagnóstico.
- `tests/e2e/direct-signature-browser.test.mjs` y
  `signature-review-preview.test.mjs`: esperas y limpieza de los fixtures.
- `src/components/ui/direct-signature-field.tsx`: captura compartida idéntica a
  Karol; su entrada anterior en clubs permanece como compatibilidad.
- `src/features/players/components/guardian-signature-capture.tsx`,
  `player-dossier.tsx` y `src/features/players/guardian-signature.ts`: captura,
  invalidación y documento de evidencia, sin otro servicio de carga.
- `tests/e2e/guardian-signature.test.mjs` y
  `tests/integration/player-registrations.test.ts`: recorrido y estado pendiente.
- Documentación de arquitectura del expediente, diseño de captura de tutor y
  este informe. `package-lock.json` conserva los cambios recibidos de Karol.

- Se conserva el componente real de revisión y se sustituye únicamente el
  adaptador next/image por img en este arnés, como en las pruebas de PDGLD-109.
- La página registra errores JS antes de cargar el bundle. Esperar testDone tiene
  plazo y comunica el error de arranque; las órdenes CDP usan el transporte común.
- El helper acota arranque, descubrimiento de página, conexión, órdenes y cierre.
  Espera la navegación inicial, reintentando solo una lectura de disponibilidad
  ante «Execution context was destroyed»; no repite acciones o aserciones.
- La cancelación de node:test interrumpe órdenes y cierra el navegador propio.
  El cierre es idempotente, usa PID/árbol propio en Windows y grupo propio en
  Linux, escala a terminación forzada y no espera indefinidamente pipes heredados.
  Los servidores propios cierran también conexiones HTTP activas.
- El job conserva su límite de 15 minutos. El paso afectado tiene un límite de
  dos minutos como defensa adicional; no se omitieron pruebas ni aserciones.
- Se incorporan al workflow pruebas de fallos del arnés, captura y vista previa
  de firmas y recorrido del tutor.

Se observó además una carrera intermitente en la prueba de redimensionado de
firmas: un movimiento pendiente del throttle de signature_pad podía renderizarse
después del cambio de tamaño del fixture. Se deja terminar el último evento antes
de medir; se conserva la misma tolerancia geométrica y todas las aserciones.

## Verificación local

- Recorridos de Chrome, fallos inducidos, firmas y tutor: 18 comprobaciones.
- Tres repeticiones acotadas de inscripción + captura de firma: 8/8 cada una.
  Inscripción terminó aproximadamente en 3.5–4 s y firma en 3.2 s en Windows.
- Regresión PostgreSQL local desechable de jugadores y documentos: 28/28,
  incluyendo recepción de firma de tutor sin acreditación ni activación.
- Contratos, contenido y transporte simulado de firmas: 42/42.
- Planes de migración y permisos focalizados: 16/16.
- Compilación de producción, TypeScript y lint de archivos afectados correctos.
- Ninguna consulta a proveedores de identidad ni conexión a Supabase.

También se comprobó en un contenedor Linux/Node 24 sin red la cancelación durante
el arranque: un proceso sintético y su descendiente ignoraban SIGTERM. El helper
escaló a SIGKILL en el grupo propio, detuvo ambos y eliminó el perfil temporal.
Este caso verifica limpieza POSIX; no equivale a ejecutar la UI en Chromium.

### Reproducción y resultado en Linux con navegador

Se completó un contenedor desechable Debian 12 con Node 24.22.2, npm 11.19.1,
Chromium 156.0.8078.79 y esbuild 0.28.2 del lockfile. El comando original, sin
corregir, informó timeout a los 45 s y seguía abierto hasta la interrupción
externa acotada a 55 s. Una segunda copia, instrumentada únicamente para comunicar
errores de arranque, mostró el mismo `ReferenceError: process is not defined`.

El código corregido pasó **18/18** comprobaciones de arnés, inscripción, captura,
vista previa y tutor. Con dependencias instaladas por npm ci dentro del contenedor
(scripts de instalación deshabilitados), el conjunto terminó en 7.88 s y la
inscripción en 1.37 s. También pasó 18/18 usando dependencias JS de solo lectura
y esbuild Linux verificado contra la integridad del lockfile; la ejecución final
anterior utiliza dependencias nativas Linux completas.

Las ejecuciones usaron `--network none`, origen HTTP loopback, un perfil nuevo y
fuentes de solo lectura. El wrapper de Chromium añadió `--no-sandbox` y
`--disable-dev-shm-usage` únicamente dentro del contenedor desechable; esos flags
no se añadieron al helper ni al workflow de GitHub. Los contenedores se iniciaron
con `--rm` y se comprobó su eliminación. No se copiaron .env ni credenciales.
Esto es validación local Linux, no una declaración de CI remoto aprobado.

Comando del conjunto final, con CHROME_BIN apuntando al navegador del entorno:

```text
node --test --test-concurrency=1 tests/e2e/chrome-session.test.mjs tests/e2e/team-registration-session.test.mjs tests/e2e/direct-signature-browser.test.mjs tests/e2e/signature-review-preview.test.mjs tests/e2e/guardian-signature.test.mjs
```

## Firma de tutor

Consultar [captura y límites](../design/guardian-signature-capture.md).
Se comparte la captura de Karol. El documento generado queda pendiente; no se
inventó un texto de autorización aprobado ni una regla de acreditación de tutor.
La política de equivalencia escolar todavía requiere su integración específica.

## Incidencia local al abrir /access

Durante la revisión, Víctor mostró un error 42703 por ausencia de
`user_roles.delegate_position`. La configuración efectiva consultada apuntaba a
Docker local; se verificaron destino, propietario e historial sin exponer valores
de conexión. Faltaban siete migraciones ya presentes en la rama (cargos,
elegibilidad pendiente, formatos, distribución, política de jugadores, protección
de clave de corrección y cierre de inscripciones).

Se aplicaron mediante migrate deploy exclusivamente a `gestor_ligas_dev` local
en el puerto 5433, conservando el historial y sin reset ni seed. No quedaron
migraciones pendientes; el diff de Prisma no detectó diferencias. Los conteos y
huellas de los campos comparados en nueve tablas de negocio se conservaron
(se excluyeron campos nuevos de las huellas). Se ejecutó en lectura la función
`readAccountPresentation` que originaba el error y respondió correctamente,
sin mostrar los datos de la cuenta. No se actualizó Supabase.
