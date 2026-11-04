# Vista previa de firmas durante la revisión de afiliaciones

Secretaría consulta cada firma mediante la acción existente «Consultar firma».
Tras recibir el enlace temporal autorizado, la bandeja muestra la imagen PNG/JPEG
debajo del directivo correspondiente y conserva la acción de descarga.

La imagen usa el enlace firmado sin pasar por el optimizador de imágenes de Next.js
y sin enviar Referer. La vista depende del acceso vigente en el controlador: se
retira al vencer el enlace, cambiar de detalle/consulta o perder autorización en
una respuesta posterior. No se amplía la vigencia del enlace ni se guarda en
localStorage o IndexedDB. El vencimiento no puede revocar una copia ya descargada.

Se muestran estados de carga y de error. Los PDF y las imágenes que no puedan
mostrarse conservan la alternativa de descarga; no se incrusta un visor PDF.
La vista previa es informativa y no cambia las acciones ni las condiciones para
aprobar o solicitar correcciones.

## Validación

La prueba `tests/e2e/signature-review-preview.test.mjs` usa el componente React
real en Chrome con perfil temporal e imágenes sintéticas. Solo reemplaza
`next/image` por un `img` nativo en el entorno de prueba. Verifica carga,
alternativa ante error/PDF, recuperación con un nuevo enlace y retirada al
vencer o desmontar. No prueba NextAuth, permisos del backend ni Supabase.

Ejecutar la prueba de navegador, `npm run test:affiliation-review`, typecheck,
lint y build. En el entorno de pruebas, verificar además una consulta autorizada
con una imagen real, su descarga, el vencimiento y el cambio de solicitud,
en móvil/escritorio y temas claro/oscuro. Estos recorridos reales siguen
pendientes hasta ejecutarlos; preparar el código no acredita su resultado.
