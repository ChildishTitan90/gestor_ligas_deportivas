# Diálogos breves — entrega 2 de PDGLD-115

`components/ui/form-dialog.tsx` aporta el contenedor reutilizable. Usa `dialog`
con `showModal()`: el navegador contiene el foco y deja inerte el fondo. El título
y la descripción dan nombre accesible al diálogo; el encabezado petróleo y las
acciones reutilizan la paleta vigente. El cuerpo se desplaza dentro de la altura
disponible en móvil y el pie conserva las acciones.

El padre controla apertura, captura, errores y envío. `initialFocusRef` permite
enfocar el primer campo; una confirmación comienza en Cancelar. Al desmontar se
restaura el foco al control de origen si todavía existe. Escape, X, clic exterior
y Cancelar usan el mismo cierre. Un arrastre iniciado dentro no cierra al acabar
fuera. Los cambios sin guardar abren una advertencia con «Seguir editando» y
«Descartar cambios»; el cierre solo descarta cuando el padre recibe `discard`.

`pending` impide cerrar o repetir acciones durante la escritura; cerrar nunca
equivale a cancelar una petición enviada. `uncertain` permite ocultar el diálogo
conservando en el controlador el payload/versión y los errores para consultar el
resultado. La conciliación y el reintento pertenecen al módulo; el contenedor
no inventa reglas, idempotencia, permisos o persistencia. Se advierte al salir
del documento con captura/envío pendiente; no se ofrece persistencia después
de recargar o cambiar de ruta.

La primera integración utiliza las correcciones de afiliación y la confirmación
de sus categorías autorizadas. El detalle extenso, historial y firmas permanecen
en la página. Los registros breves futuros reutilizan sus formularios y servicios,
sin copiar reglas dentro del diálogo. Alta/edición de grupos depende de PDGLD-95
y espera la aprobación de esta entrega antes de la integración de la entrega 3.

`npm run test:management-ui` prueba los componentes React en Chrome headless con
datos sintéticos; `CHROME_BIN` permite indicar el navegador instalado. La prueba
incluye foco, descarte y conservación de un envío incierto. El controlador y el
adaptador se verifican con `npm run test:affiliation-review`. Estas pruebas no
sustituyen la revisión visual en móvil/escritorio y claro/oscuro.
