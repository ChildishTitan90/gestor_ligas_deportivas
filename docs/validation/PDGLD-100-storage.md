# PDGLD-100 — Storage real de pruebas y primer avance PDGLD-101

31/10/2026. PDGLD-13 continúa En pruebas. No hay commit, push, PR, cambios de estado Jira ni despliegue. No se leyó la configuración de producción ni se realizaron consultas reales de CURP/INE.

## Alcance de la evidencia

- Configuración local comparada en memoria contra el archivo privado de pruebas; valores no impresos. Bucket añadido a .env.local ignorado por Git.
- Adaptador real comprobó bucket privado, 10 MiB y los tres MIME autorizados. No creó recursos ni modificó políticas.
- Dos ejecuciones exitosas de verify:player-document-storage: cada una incluyó regresión de jugadores y un recorrido HTTP real en Supabase de pruebas, con PostgreSQL desechable. La segunda incluyó render autorizado/denegado de la página de expediente. El primer intento previo falló al cargar un módulo, antes de crear objetos.
- Por HTTP real: preparación idempotente, PUT real, repetición del PUT con los mismos bytes, confirmación repetida con una sola asociación, consulta de acuse, rechazo de otro club y anónimo, enlace de descarga de 60 segundos y contenido descargado idéntico. No se esperó su caducidad de 60 segundos como prueba temporal independiente.
- Un PUT con contenido distinto al preparado se rechazó antes de almacenar. Un fixture confiable colocó otro PDF válido en una intención preparada: confirmar devolvió 409 y no lo asoció; intentar sobrescribirlo no cambió el objeto. Confirmar un objeto ausente produjo 503 sin asociación. La indisponibilidad de red se cubre con transporte simulado, no provocando una caída del proveedor.
- La política posterior de Víctor se probó por separado en PostgreSQL desechable: edad cumplida al día del registro y recepción documental sin heredar la ventana lunes–miércoles de altas. Minoría no se recalcula con la fecha de consulta. El fixture de fecha conserva la auditoría exigida por los triggers.
- Revisión de navegador: sesión/backend/PostgreSQL reales del entorno aislado; escritorio 1280×900 oscuro y móvil 375×812 claro, selector con flecha/Enter/Tab, estados recibidos y pendiente de revisión. Sin desbordamiento horizontal. No se probó una cámara física ni el envío completo mediante clics del navegador; el envío y la confirmación se comprobaron mediante HTTP real. Se restauró el viewport y se cerró el servidor/BD aislados.
- Las suites ordinarias usan Storage simulado y no leen el archivo privado. El comando real es optativo y exige verificación de destino; no se incorporó al CI automático.
- La regresión con rol SQL limitado detectó la inicialización de claves de afiliaciones antiguas no autorizada por el plan anterior. La migración aditiva y el plan privado se ajustaron conjuntamente, sin permitir modificar claves existentes. La comprobación se ejecuta en PostgreSQL desechable con RLS, sin provisión real de permisos en Supabase.

## Objetos creados, sin limpieza remota

Comprobaciones locales ejecutadas: 23 pruebas de servicios/regresión de jugadores; 8 de reglas y recuperación del cliente; 5 del adaptador simulado; 42 de firmas; 4 de identidad y 8 de proveedor CURP simulado; 27 controles de pipeline. El runtime limitado pasó 65 pruebas y dejó 2 omisiones planificadas propias de ese recorrido, además de su comprobación de autorización. Typecheck, lint y build pasaron. Esto no equivale a CI remoto ni aceptación humana del recorrido completo.

Se conservaron cuatro PDF sintéticos en expedientes-jugadores. No contienen documentos personales. Nombres finales de objeto:

| Archivo | Escenario |
| --- | --- |
| 127fed3d-72ab-4760-ab0a-b23adbc842ee | PDF confirmado en la primera ejecución |
| cdcd6ede-e1f6-4691-a4af-d0579b0fc941 | PDF diferente al preparado; sin asociación |
| dcf5a283-3cc8-4c76-bd0e-4d655f641889 | PDF confirmado en la segunda ejecución |
| 3f2aedf5-ceb9-43cb-be3c-bbd3be3d018d | PDF diferente al preparado; sin asociación |

Los intentos de objeto ausente no crearon archivos. Las rutas completas y estados se conservaron en manifiestos privados del directorio temporal: player-documents-pdgld48_test_6d5692a0eddf77cc.json y player-documents-pdgld48_test_b634188c6237acae.json. No contienen enlaces firmados ni claves. Como sus bases fueron desechadas, las asociaciones eran de prueba y ya no existen. Cualquier limpieza remota futura debe ser manual y revisar esos manifiestos; este entregable no la ejecuta.

## Cómo repetirlo

1. Mantener URL/clave locales de **pruebas** y SUPABASE_PLAYER_DOCUMENTS_BUCKET. El verificador local de Víctor compara contra Documents/Codex/storage-expedientes-20261031/.env.storage-pruebas; nunca abre .env.storage-produccion.
2. Ejecutar npm run verify:player-document-storage. Inicia servidor y base desechables, prueba HTTP real y deja dos objetos nuevos más un manifiesto privado por ejecución. Al terminar elimina solo la base temporal.
3. Para recorrer la pantalla manualmente en PowerShell: establecer `$env:PLAYER_DOCUMENT_KEEP_SERVER='1'` y ejecutar el mismo comando. Tras pasar las pruebas conserva el servidor. El archivo privado .session.json junto al manifiesto contiene URL local, cuenta sintética y registrationId. Abrir esa URL, iniciar sesión con esos datos y visitar /players/registrations/<registrationId>/documents. El PDF sintético local está junto al manifiesto con sufijo .synthetic.pdf. No publicar el archivo de sesión.
4. Probar selección de requisito, archivo o cámara y carga. Si se envía otra carga real, se creará otro objeto: conservar su intención/acuse para revisión manual. Enter o Ctrl+C detiene el servidor aislado. Quitar después PLAYER_DOCUMENT_KEEP_SERVER de esa terminal. No cambiar reloj del sistema ni desactivar la ventana de altas.
5. Para pruebas sin red: npm run test:player-dossier, npm run test:player-document-storage, npm run test:player-registrations y npm run test:signatures.

En la base habitual, el menú de jugadores enlaza al expediente. Si faltan requisitos por categoría, el sistema lo informa: no se instaló una lista universal ni se alteraron datos habituales para aparentar un expediente completo. Tutor, parentesco/firma y originalidad siguen pendientes de acreditación/revisión. Ninguna carga habilita aprobación deportiva ni cierre de PDGLD-13/14.
