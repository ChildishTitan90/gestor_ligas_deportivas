# Captura persistente y sincronización · PDGLD-19/20

## Entradas y autorización

`/matches` utiliza `MatchReportOfflineList`. Una cédula editable ofrece **Preparar para usar sin conexión** cuando el navegador reúne las capacidades necesarias. **Abrir cédula** se habilita al completar snapshot y recursos. Si la preparación falla, se ofrece **Capturar con conexión**. Una cédula de solo lectura mantiene su
consulta. En desarrollo, en navegadores sin las capacidades necesarias o si la preparación falla, **Capturar con conexión** abre el editor autorizado y envía el borrador al servidor. En ese modo la edición pendiente vive en la pestaña hasta recibir el acuse.

`POST /api/v1/match-reports/prepare` reutiliza `reportAccess` y la evaluación
de elegibilidad en la misma transacción. REFEREE necesita la designación efectiva
propia. DATA_ENTRY conserva el ámbito autorizado de liga/club de PDGLD-18.
Se descargan los identificadores, equipos, versiones, plantilla, dorsales,
elegibilidad/bloqueos deportivos a la fecha del partido y catálogo de eventos.
Se excluyen fotografías y expedientes. Las firmas ya vinculadas se obtienen por
sus endpoints privados y se conservan como PNG en la copia local.

El servidor valida autoridad, estado y contenido en cada operación. El navegador
confirma la escritura local cuando termina la transacción de IndexedDB. El servidor
carece de acceso al disco del cliente y una declaración de preparación enviada por
un navegador modificado puede ser falsa. La preparación es una condición del flujo
local. La autorización y las restricciones deportivas del servidor siguen siendo
la barrera de seguridad para las lecturas y escrituras.

## Conservación y datos privados

Antes de habilitar la conservación se informa y se pide aceptación en el
dispositivo. La autorización local dura siete días desde preparar/revalidar el
partido. Una copia vencida queda bloqueada hasta reautenticación y preparación
autorizada. Sus pendientes se conservan para revisión y no se purgan por vencimiento.

Las copias están separadas por UUID de cuenta y partido en
`league-match-reports-v1`, almacén `reports`. `account` registra la cuenta
activa y la caducidad local. No contiene credenciales, JWT, cookies ni documentos
de identidad. Un cambio de cuenta bloquea el acceso de la aplicación a la partición anterior. Sus borradores, firmas, revisiones e intenciones permanecen en IndexedDB. Al identificarse su titular puede retomar las copias vigentes.
El cierre de sesión explícito advierte si hay pendientes y elimina las copias
de esa cuenta antes de la salida. El vencimiento de sesión conserva el borrador y permite
iniciar sesión en otra pestaña. Los otros tabs reciben la invalidación local y
sus escrituras dejan de estar permitidas.

La separación por cuenta evita mezclar recorridos de la app. Los datos quedan
bajo el perfil del navegador y el bloqueo del dispositivo. Una persona con acceso
a ese perfil o a sus herramientas de desarrollo puede inspeccionarlos. El
navegador puede desalojar su almacenamiento. Al fallar una escritura se conserva
la revisión en memoria y se muestra cuál falta guardar.

## Recursos y reapertura

`/sw.js` prepara el documento público estático `/offline/report`, sus
scripts, estilos y fuentes de `/_next/static/`. Publica el documento al final
de la descarga. Cache Storage contiene únicamente esos recursos públicos.
Los snapshots y firmas permanecen en IndexedDB.

El documento público carga la copia autorizada del dispositivo y reutiliza
`ManagementShell` y `ReportWorkspace`. El Service Worker puede redirigir una
navegación a `/matches` o a una cédula real hacia ese documento cuando falla
la red. Los enlaces **Abrir copia del dispositivo** y el índice
`/offline/report` permiten abrirlo directamente. No se cachean las respuestas
de las rutas de gestión, las sesiones ni las API privadas.

La preparación de recursos requiere una compilación de producción. Next dev
utiliza recursos de desarrollo que cambian con HMR. El servidor responde con
`X-Report-Offline-Build` para distinguir el artefacto preparado. HTTPS o
`localhost`, IndexedDB, Service Worker, Web Locks y BroadcastChannel son
prerrequisitos comprobados antes de habilitarlo. Se valida Chrome de escritorio
y viewport móvil. La aceptación de dispositivos Android/iOS físicos queda
pendiente de prueba manual.

## Revisiones, intenciones y acuses

`draftId` identifica el borrador. `revision` y `editId` identifican la edición
local. `operationId` identifica una intención inmutable del contrato existente.
Cada edición en los handlers encola inmediatamente una transacción de IndexedDB,
también estando online. La interfaz marca guardado únicamente en `oncomplete`.
Las escrituras se serializan por pestaña y comparan la revisión anterior de forma
atómica. Un choque entre pestañas conserva la captura en memoria para compararla.

Se revisó `venue-loan-recovery.client.ts`: se conserva su patrón de resolver
la escritura en `oncomplete` y persistir la intención antes del transporte.
Las cédulas necesitan su propio almacén por cuenta/partido y revisión; no comparten
documentos ni la cola de solicitudes de canchas.

Antes de usar la red, `enqueueReport` persiste contenido, versiones, tipo,
revisión enviada y todas las claves de subida. `report-client.ts` admite
checkpoint durable y conserva el transporte online original. Las firmas usan
los endpoints privados existentes y sus objetos inmutables. Una respuesta de
subida perdida se recupera con la misma clave. El checkpoint del fileId precede
al envío del comando de cédula.

La apertura, el evento online y **Sincronizar** consultan primero el acuse.
Web Locks permite un único sincronizador por cuenta/partido. Los acuses siguen
en `match_report_syncs`, con el hash, actor, versiones y clave única existentes.
`/api/v1/match-reports/sync` delega en el mismo servicio de PDGLD-18.

Un acuse actualiza la revisión reconocida y las versiones base, sin reemplazar
las ediciones posteriores. BroadcastChannel avisa a otras pestañas y ambas
identifican el operationId y la revisión que recibió acuse. Los conflictos de
versión, pérdida de permisos o reglas deportivas bloquean la cola y muestran
comparación para revisión humana. No existe una conciliación automática.

## Alineaciones, reloj y cierre

El bloqueo de alineaciones y las acciones del reloj se guardan como intenciones
ordenadas antes de aplicarse localmente. La cola anticipa las versiones de esas
operaciones. El reloj local sigue avanzando y se restaura desde sus marcas de
tiempo al reabrir. `occurredAt` es opcional para conservar compatibilidad con
los clientes online. El servidor permite hasta siete días hacia atrás y un
minuto de tolerancia futura, exige orden respecto del periodo vigente y reutiliza
las transiciones de PDGLD-18. Una hora incompatible produce conflicto para revisión.

Cada frontera conserva su origen en `boundarySources`. La hora enviada con
`occurredAt` es una declaración del dispositivo, incluso si llega de inmediato.
El reloj de captura conserva esa hora al reabrir. Para validar cruces entre dos
partidos, el servicio solo usa las fronteras fechadas por el servidor al recibir
la acción. Las marcas antiguas sin origen quedan sin verificar. Si falta una
frontera necesaria, la operación devuelve `PARTICIPATION_CLOCK_REQUIRED` y
conserva el borrador para revisión. Comisión contrasta la salida y la entrada de
los dos encuentros, con su zona y origen en **Marcas de los tiempos**. Un reintento
o un acuse tardío conserva el origen original. La revisión no habilita una
excepción automática ni altera la alineación histórica.

La confirmación se encola solo tras la decisión explícita del usuario.
`getConfirmationEffects` sigue devolviendo `CONFIRMATION_DEPENDENCIES_PENDING`.
La interfaz conserva el bloqueo del cierre oficial y distingue el acuse de borrador.
Una negativa definitiva a confirmar no bloquea la sincronización posterior del
borrador. No se añaden migraciones ni se modifican los receptores oficiales.
