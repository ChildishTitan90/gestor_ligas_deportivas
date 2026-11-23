# Bitácora de operaciones — PDGLD-91

## Recorrido acordado

La consulta tiene dos vistas: **Consultar operaciones → Detalle**. Una línea
discreta con pasos numerados aparece en ambas, marca el paso actual con texto,
contraste y `aria-current="step"`, y permite regresar desde el detalle.
No representa aprobaciones ni escrituras: es un indicador de ubicación.

El listado conserva una sola acción principal, **Filtrar operaciones**.
Limpiar filtros es un enlace y conserva el ámbito elegido. Cada operación
completa es un enlace al detalle, sin un botón adicional por fila.
En el detalle no hay acciones de edición, eliminación, descarga ni publicación.
El primer paso del recorrido permite volver a la consulta conservando filtros
y página. Las páginas anteriores se recorren mediante enlaces.

## Contenido y estados

- Filtros: ámbito autorizado, tipo de entidad, usuario y fechas inclusivas.
- Con varios ámbitos se exige elegir uno; no se selecciona otra liga al filtrar.
- Las fechas y horas usan la zona del ámbito seleccionado, indicada en pantalla.
- El listado muestra operación, entidad, usuario, motivo permitido y fecha.
- El detalle separa los valores anteriores y posteriores que pueden mostrarse.
- Se distinguen carga, selección pendiente, vacío, filtros inválidos, error y
  acceso denegado. Un registro invisible no se presenta como historial inexistente.

Se reutilizan ManagementShell, SelectField, enlaces de Next y los tokens
existentes. Las páginas no agregan otro encabezado global ni un segundo main.
La composición funciona con teclado, en móvil y escritorio, claro y oscuro.

## Comprobaciones

`npm run test:audit:browser` monta los componentes reales con datos sintéticos,
transporte de navegación controlado y estilos compartidos. Comprueba los dos
pasos, retorno con filtros, selección por teclado, una acción principal y
ausencia de desplazamiento horizontal a 390/1440 px en ambos temas.
Las capturas locales de esta prueba se excluyen del repositorio.

La integración HTTP comprueba además las páginas reales con sesiones y datos
temporales y navega en Chrome entre listado y detalle conservando filtros;
las capturas de componentes no se presentan como una sesión manual
de aceptación ni como verificación de todos los recorridos de la aplicación.
