# Recorrido local de captura offline · PDGLD-19/20

## Iniciar la prueba

Con Docker activo, ejecuta desde la rama de trabajo:

```powershell
npm run match-reports:offline
```

El runner crea únicamente su PostgreSQL desechable y Storage privado en una
carpeta temporal. Prepara datos sintéticos mediante los controles existentes,
compila el código y sirve Next en `http://127.0.0.1:3198`. La terminal imprime
el UUID del partido. No utiliza la base habitual ni los proveedores de CURP/INE.
Mantén ese proceso abierto durante la prueba. Al terminar el proceso se eliminan
su contenedor y su directorio temporal de firmas.

Inicia sesión con `arbitro@example.test` y la clave sintética
`Arbitraje-Local-141!`. Usa `127.0.0.1` durante todo el recorrido para
conservar el mismo origen de cookies, Service Worker e IndexedDB.

## Recorrido manual

Para una revisión de cinco minutos, usa **REAL-147**, cuya alineación ya está
sellada por el fixture. Para probar la preparación desde cero y elegir tú las
alineaciones, usa **OFFLINE-20**. Ambos aparecen en `/matches` y usan el flujo real.

1. Abre `http://127.0.0.1:3198/matches`. Pulsa **Preparar para usar sin
   conexión**, revisa la conservación local y acepta. Espera a **Disponible sin
   conexión**. Una descarga incompleta mantiene oculto el acceso de captura.
2. Abre la cédula real, entra a captura y, en **Cierre y firmas**, cambia una observación de ejemplo.
   Comprueba **Guardando en el dispositivo** y luego el número de revisión
   guardada, aun con internet.
3. Corta la red desde las herramientas del navegador. Captura otro dato y
   espera la escritura local. Cierra la pestaña. Abre de nuevo
   `http://127.0.0.1:3198/offline/report` sin internet y retoma el mismo partido.
   Comprueba el UUID abreviado del borrador, revisión, observación y reloj.
4. Recupera la red y observa el acuse o pulsa **Sincronizar**. Comprueba qué
   revisión recibió acuse. Edita otra observación y revisa que conserve su
   revisión propia. Dos pestañas deben identificar el mismo acuse y advertir
   cualquier diferencia de captura local.
5. En **Resumen**, revisa el bloqueo de confirmación oficial. El borrador puede
   sincronizarse. El cierre continúa bloqueado por las dependencias oficiales.

Para empezar con alineaciones y reloj desde cero utiliza **OFFLINE-20**, un
partido Confirmado asignado al árbitro sintético que crea el runner. Su URL
exacta también se imprime en la terminal. El fixture REAL-147 conserva la captura de las pruebas de
integración y sirve para recuperación y sincronización sin alterar antecedentes.

La prueba usa la opción offline del navegador para cortar la conexión del
origen local. Desactivar Wi-Fi del equipo por sí solo deja funcionando localhost.
Para probar el tamaño de celular, usa el modo adaptable de Chrome. El recorrido
en un teléfono físico necesita publicar el entorno de pruebas mediante HTTPS.

## Evidencia del dispositivo y de PostgreSQL

En Application → IndexedDB → `league-match-reports-v1` → `reports` se pueden
inspeccionar únicamente los datos sintéticos del recorrido. El registro contiene
el snapshot, borrador, revisiones, firmas PNG, intenciones originales, claves de
subida y último acuse. El almacén `account` contiene UUID de cuenta y vencimiento.
En Cache Storage deben aparecer solo `/offline/report` y recursos
`/_next/static/`.

Antes del acuse, los cambios están en IndexedDB y en la memoria de la página.
Después del acuse, `match_reports` contiene la proyección/draft_data,
`lineups`, participaciones y `match_events` contienen la captura validada, y
`match_report_syncs` contiene el operationId aplicado, versión y acuse.
Las firmas usan `files`, el registro de intención de auditoría y el Storage
privado local del runner.

El usuario puede inspeccionar la base desechable con el nombre exacto que
devuelve `docker ps --filter label=pdgld.ticket=PDGLD-147`. No debe usar el
contenedor habitual del proyecto para este recorrido.

## Verificación automatizada

```powershell
$env:CHROME_BIN = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run match-reports:offline -- --verify-offline
```

El ejecutor usa NextAuth, PostgreSQL, IndexedDB, Service Worker y Chrome reales.
Corta el transporte, cierra la pestaña y demora una respuesta auténtica para
comprobar que un acuse tardío preserva una edición posterior. También inspecciona
la revisión compartida entre pestañas y provoca falta de cuota de almacenamiento.
Las respuestas de negocio provienen del servidor. Las identidades son sintéticas.
La evidencia se escribe en `.codex-attachments/pdgld19-20/pg15/` o `pg17/`, según el argumento `--postgres`. El comando automatizado actual es `npm run test:match-report-offline -- --postgres=15` (repetir con 17).

Las reglas de servidor, rollback y subidas interrumpidas continúan cubiertas
por `npm run test:match-reports`. La regresión visual existente se ejecuta
con `npm run test:match-report-ui`. El transporte durable se prueba con
`npm run test:match-report-client`.

## Resultado verificado el 19 de noviembre de 2026

- PostgreSQL 15 desechable con rol Preview y RLS, autorización, versiones,
  rollback, firmas/reintentos y bloqueo oficial: pasó.
- Compilación de producción y TypeScript: pasaron.
- Chrome real, ancho móvil de 390 px: pasó la preparación, primera edición
  online, reloj sin red, cierre de pestaña, reapertura, acuse SQL, respuesta
  tardía, dos pestañas, falta real de cuota, reautenticación, conflicto y
  separación entre IndexedDB y Cache Storage. Siete operaciones distintas y
  siete registros de acuse, sin duplicados, en este recorrido.
- `test:match-report-ui`: 20 pruebas aprobadas; incluye claro/oscuro,
  360/390/1440 px y teclado con datos sintéticos.
- `test:match-report-client`: 2; `test:session-activity`: 7;
  `test:match-report-storage`: 1; `test:match-report-tactics`: 14 aprobadas.
- ESLint de los módulos modificados y `git diff --check`: sin errores.

La primera revisión visual dejó `prepared.jpg`. La matriz ampliada ejecutó
PostgreSQL 15 y 17 y publica únicamente JSON, sin firmas ni borradores, en
`.codex-attachments/pdgld19-20/pg15/browser.json` y `pg17/browser.json`.
Consulta los criterios, resultados y pendientes actuales en
[aceptación PDGLD-19/20](PDGLD-19-20-acceptance.md).
La prueba en un teléfono físico sigue pendiente.
