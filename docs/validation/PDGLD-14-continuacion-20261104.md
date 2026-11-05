# PDGLD-14 — continuación del 04/11/2026

Base anterior conservada en `7ac9125` (commit solicitado, sin push). Esta entrega
posterior permanece sin commit. PDGLD-13 continúa en pruebas; no se modificó Jira.
`origin/develop` se actualizó antes y después del trabajo y sigue en `4d795b4`.
Se conservan la integración de Karol, firmas de afiliación y el resto del equipo.

## Cambios implementados

- Para menores: **credencial escolar o constancia de estudios**. Basta una
  alternativa vigente y revisada. Se mantiene autorización del tutor por separado.
  La migración aditiva `20261104010000_pdgld14_student_id` añade el tipo STUDENT_ID;
  no modifica migraciones anteriores ni inserta requisitos en categorías reales.
  Se aplicó en las bases temporales; no en la base habitual ni Supabase.
- El portal prepara una autorización firmada, versión GUARDIAN_AUTHORIZATION_V1.
  Su recepción queda PENDING. Secretaría/Administración comprueba identidad,
  relación, firma y autorización y registra motivo y decisión. READ/APPROVE y
  alcance se verifican en servidor, con fingerprint e intención idempotente.
- Revisión en `/players/review/[registrationId]/documents`, enlazada en la bandeja.
  `PLAYER_DOCUMENT_REVIEWED` vincula decisión, archivo y versión de identidad.
  Aprobar con las cuatro atestaciones presenta ACCREDITED. Sustituir autorización
  o cambiar identidad invalida la acreditación. No se inventa versión de aviso de
  privacidad ni se crean consentimientos acreditados solo por subir archivos.
- Preview concede UPDATE únicamente status/reviewed_by en player_documents;
  file_id y demás columnas siguen inmutables. Sin aplicar permisos remotos.
- «Jugadores» es el título y destino del sidebar. «Mis jugadores» carga desde el
  servidor sin seleccionar primero un equipo, con búsqueda, filtro y expediente
  accesible al volver. El formulario queda en FormDialog con botón Registrar
  jugador, descarte, foco, Escape y conservación de operaciones inciertas en
  memoria. No hay borrador persistente. Los filtros tienen la misma alineación.
- El POST humano de alta coordina registro y CURP. No consulta en render, GET,
  búsqueda ni al escribir. Reutiliza el servicio y una intención estable;
  reenviar no duplica la consulta ni repite automáticamente un intento incierto.
  Se mantienen las cuotas conservadoras. No se muestran tokens en controles de
  CURP. Un fallo no pierde el registro ni afirma verificación o habilitación.
- La prueba INE ahora usa el helper compartido de Chrome y su limpieza; adapta
  únicamente next/image al entorno sin Next, captura errores de inicialización y
  comprueba controles visibles para evitar confundir botones de un diálogo cerrado.

## Comprobado en esta entrega

- `node scripts/test-auth.mjs --players`: **31/31** en PostgreSQL temporal, con
  CURP/INE/Storage simulados. Incluye alta integrada concurrente e incierta,
  alcance del listado, ambas alternativas escolares, acreditación del tutor,
  reemplazo, versiones, rollback y regresiones de PDGLD-13.
- `node scripts/test-auth.mjs --preview`: **126 aprobadas, 2 omisiones existentes
  justificadas por la suite**, cero fallos. Provisión repetible, permisos por
  columna, inmutabilidad, RLS y recorridos existentes preservados. No se añadieron
  omisiones. Ejecutar esta suite y --players en serie: sus roles de prueba anon/
  authenticated/service_role comparten el clúster. Un cruce detectado durante
  esta entrega se resolvió repitiendo --players solo, sin cambiar sus aserciones.
- Chrome: recorridos de firma de tutor, lista/modal/revisión y cámara INE/CURP
  pasaron con respuestas y cámara sintéticas. El modal verifica descarte y retorno
  de foco; la revisión conserva idéntico envío tras incertidumbre y respeta un
  acuse confirmado aunque falle el refresco.
- Reglas/recuperación documentales: 9/9. Planes de producción: 11/11.
- Typecheck y ESLint de los archivos afectados pasaron; sin modificar dependencias.
- Smoke de Next con sesión y base reales aisladas: login, dos recorridos con
  nacimiento adulto real conservado, lista, expediente, INE aplicable solo al caso
  Veteranos, acceso anónimo denegado y bloqueo de habilitación deportiva.
- Estilos reales: 1280×900 oscuro y 375×812 claro, listado y modal. Filtros visibles
  de igual altura y alineados en escritorio; sin desbordamiento horizontal móvil.
  Escape cierra y la prueba sintética comprueba retorno de foco y descarte.
  Capturas locales `pdgld-player-manual-87e5fc3ed5ace690-*.png` en TEMP.

No se consultó CURP/INE real ni se consumieron créditos por agentes. No se creó
ningún objeto nuevo en Supabase en esta continuación: los archivos de pruebas
fueron sintéticos y se guardaron en memoria/local. La evidencia histórica de
carga real de Storage sigue en PDGLD-100-storage.md; no se presenta como nueva
validación externa de identidad. La cámara física queda para aceptación humana.

## Prueba humana aislada

Runner: `node scripts/test-auth.mjs --player-demo` (o `npm run players:demo`).
Por defecto usa 3001. Para el enlace que Víctor ya utiliza, se preparó el puerto
3000 y `PLAYER_DEMO_ORIGIN` con su URL HTTPS, sin modificar `.env.local`. Se
comprobó primero que el puerto estaba libre; no se detuvo ningún proceso ajeno.
Ejemplo de arranque PowerShell con las variables solo para ese proceso:

```powershell
$env:PLAYER_DEMO_PORT = '3000'
$env:PLAYER_DEMO_ORIGIN = 'https://TU-ENLACE-DEL-PUERTO-3000'
node scripts/test-auth.mjs --player-demo
```

El runner comprueba URL/clave de Storage contra el archivo privado de **pruebas**,
conserva VMX_API_KEY exclusivamente para acciones humanas y no abre producción.
Crea base `pdgld48_test_<aleatorio>`, compilación `.next-player-manual`, cuentas
sintéticas con contraseña aleatoria y manifiesto privado en TEMP. No versionar ni
publicar ese manifiesto. El origen HTTPS se usa en sesión/CSRF y solo su hostname
se permite como origen adicional de desarrollo. El túnel/permiso físico debe
probarlo Víctor; configurar el origen no demuestra que el túnel sea accesible.

1. Entrar por `/login` usando el correo/contraseña del manifiesto privado que
   imprime el runner. Usar primero la cuenta delegado; no son las cuentas DEMO
   habituales y no existen en la base habitual.
2. Abrir Jugadores → Registrar jugador. Elegir el contexto «Escolar y tutor» y
   capturar **fecha de nacimiento y CURP reales**, sin simular que se es menor.
   Confirmar el alta inicia la consulta CURP humana. Los agentes no pulsan esta
   acción cuando hay credenciales reales.
3. Abrir expediente: muestra PRUEBA AISLADA y edad adulta conservada, pero ofrece
   el recorrido documental escolar. Adjuntar credencial **o** constancia; preparar,
   revisar y cargar la autorización firmada. Es una prueba de flujo, no acredita
   que el adulto sea un menor ni demuestra un parentesco real.
4. Entrar con la cuenta Secretaría del mismo manifiesto, abrir Revisiones de
   jugadores, consultar archivos y aprobar o solicitar corrección. Para tutor,
   marcar las cuatro comprobaciones y justificar. Verificar acreditación; una
   sustitución vuelve a dejarla pendiente. No se habilita deportivamente.
5. Registrar los mismos datos reales en el otro contexto, «INE Veteranos». Son
   temporadas de fixture distintas; se conserva la identidad y se reutiliza su
   comprobación CURP vigente sin nueva consulta. Abrir expediente → frente,
   reverso, selfie → revisión final → envío **solo por el humano**. No falsificar
   edad ni tomar las edades sintéticas como política aprobada de la Liga.
6. La cámara requiere HTTPS y permiso del dispositivo; si se deniega, usar el
   único selector de fotos. La carga de evidencia INE es distinta del expediente.

El override documental exige simultáneamente development, flag privado, base
loopback con nombre aleatorio exacto y marcador de servidor por equipo. No se
acepta desde el navegador ni en la base habitual, Supabase o producción. También
bloquea activación automática aunque CURP sea VERIFIED.

## Recuperación y cierre

- Documentos: conservar intención/bytes/versión, consultar acuse y reintentar la
  misma operación. No generar otra clave ante respuesta perdida. Los objetos son
  inmutables, sin upsert. Storage puede contener un objeto aún sin confirmación.
- CURP/INE: consultar estado o acuse no consulta al proveedor. Un resultado
  incierto no provoca reenvío automático; cualquier nueva consulta exige decisión
  humana y pasa los controles existentes.
- Enter/Ctrl+C detiene únicamente el servidor abierto por el runner. Antes de
  borrar **su propia base temporal**, exporta al manifiesto privado files y los
  eventos documentales/INE (incluidas intenciones incompletas), para identificar
  objetos y resultados. Si falla la exportación, conserva la base para recuperar.
- No se elimina automáticamente ningún objeto de Supabase. Los archivos que
  Víctor suba al probar pueden permanecer en el bucket privado de pruebas; el
  manifiesto permite revisarlos posteriormente sin publicar rutas ni documentos.
- Si se interrumpe el proceso sin ejecutar cierre, conservar la base y manifiesto
  de esa ejecución para recuperación; no lanzar limpiezas indiscriminadas.

Pendiente de aceptación humana: proveedor real, cámara física y comprobación del
acceso por túnel. Sin commit nuevo, push, PR, despliegues ni cambios de Jira.

## Ajustes posteriores de identificación y carga

El encabezado del expediente ya identifica nombre, equipo, categoría, club y
temporada, seleccionados después de autorizar la inscripción. La carga ahora
ofrece tarjetas con acción Adjuntar/Sustituir, un único selector individual con
botón visible «Elegir archivo»/«Elegir foto» y cámara integrada alternativa.
No se expone «Posición del requisito» para documentos de un solo archivo. Si hay
una cantidad explícita mayor, se conserva y se explica «Archivo N de M», uno por
envío. Imágenes y PDF tienen vista previa local y opción de quitar o cambiar la
selección; nada se envía antes de guardar. El historial y contrato de sustitución,
cantidades, permisos, hashes e idempotencia del servidor permanecen vigentes.

Prueba enfocada `player-dossier-upload.test.mjs`: botón de archivo/foto, cámara
denegada y alternativa conservada, formatos, vista previa PDF/imagen, selección
única, slot interno 1, cantidad 2 configurada, sustitución de versión y reintento
de confirmación sin volver a subir bytes. Pasó con transporte sintético, junto
con las regresiones de firma de tutor e INE. Una primera ejecución concurrente
de Chrome agotó el cierre de taskkill; se repitió en serie y pasó. No se aumentó
ningún timeout ni se relajaron aserciones. `test:player-workspace` incluye esta
prueba en serie con el recorrido de lista/modal. Tipos y lint revisados.

Revisión visual con CSS real obtenido del login local y datos sintéticos:
escritorio oscuro 1280×900 y móvil claro 375×812, sin desbordamiento horizontal
y botón de al menos 48 px. Capturas en TEMP/pdgld-document-ui-xXa5Fc. No se
reinició el servidor humano, no se enviaron archivos a Supabase ni se consultó
ninguna API real de identidad para estos ajustes.
