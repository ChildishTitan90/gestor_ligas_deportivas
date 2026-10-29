# Estructura de gestión — PDGLD-114

## Avance iterativo

La estructura se comparte entre `/access`, `/accounts/new`, `/affiliations/new`,
`/affiliations/review`, `/affiliations/[id]/correct` y `/teams/registrations`.
La ampliación responde a la corrección del usuario: sidebar presente en las
pantallas de gestión, control para mostrarla/ocultarla y salida al pie, conservando
la salida del menú de cuenta.

Se mantienen Geist y los tokens existentes de petróleo, cobre, superficies blancas,
bordes y foco. La referencia visual orienta distribución y comportamiento; no se
copian sus marcas, textos o módulos. El resumen de funciones del panel se conserva
sin añadir métricas, dashboard o modales de PDGLD-115.

## Comportamiento

- La sidebar ocupa el alto de la ventana en escritorio. Su zona central desplaza
  los enlaces; «Cerrar sesión» permanece al pie. Su ancho es de 248 px y la franja
  superior comparte con el encabezado y la franja de cierre una altura mínima de
  80 px en escritorio y 64 px en móvil. La salida queda centrada verticalmente; un error de cierre puede ampliar
  su franja para mantener legible el mensaje y permitir reintentar.
- El botón del encabezado muestra u oculta completamente la columna. Ocultarla
  amplía el área disponible. La elección se mantiene al navegar entre pantallas
  del grupo de gestión y se reinicia al abandonar esa estructura o recargar.
- Cada destino implementado tiene un enlace. La opción actual usa `aria-current`,
  fondo y borde cobre. La corrección de una afiliación corresponde a «Mis
  solicitudes de afiliación». No aparecen grupos vacíos ni módulos futuros.
- Las iniciales abren el mismo `AccountMenu`: «Mi panel», «Portal público» y
  «Cerrar sesión». Se muestran `@usuario` y todos los roles vigentes. No se envía
  al shell cliente el nombre completo, correo ni asignaciones internas.
- Las dos salidas reutilizan `SignOutButton` y comparten la petición pendiente.
  Un fallo permite reintentar y no se anuncia como cierre completado.
- En móvil se abre una columna superpuesta con nombre accesible, botón de cierre,
  marca y cierre en la misma franja superior, sin una fila adicional de controles,
  fondo exterior y contenido de fondo inerte. Escape y clic exterior la cierran;
  Tab permanece dentro. Al cerrar se devuelve el foco al control de apertura.
  Cambiar a escritorio devuelve el foco al control de escritorio.
- Elegir un destino o cambiar de ruta cierra el menú móvil. Los enlaces conservan
  su URL, las visitas directas y el historial del navegador. Hay salto al contenido.
- Portal público, login y cambio obligatorio conservan su estructura propia.
  Entrar al portal no cierra la sesión.

## Permisos y errores

La navegación se resuelve en servidor usando las comprobaciones existentes de
cuentas, afiliaciones y clubes consultables. El cliente recibe solo rutas,
etiquetas e iconos; los servicios de destino vuelven a autorizar cada operación.
No se deducen capacidades de nombres de roles ni se otorga un acceso universal
a SUPERADMIN. Se conservan restricciones por ámbito y solicitante original.

Una denegación esperada omite el acceso correspondiente. Si falla la lectura de
navegación, el layout muestra un error con reintento, portal y cierre de sesión,
sin presentar el contenido de gestión como autorizado. Los errores de sesión
redirigen a login o cambio obligatorio. Las páginas conservan sus estados de
carga, acceso denegado y errores de negocio dentro del área principal compartida.

El layout de Next.js persiste entre navegaciones internas. Los accesos se vuelven
a consultar al recargar o refrescar la estructura; el menú no sustituye la
autorización de páginas/API cuando un permiso cambia durante la sesión.

## Cómo revisar el avance

Con el entorno habitual configurado, ejecutar `npm run dev` y abrir
`http://localhost:3000/access` con una cuenta operativa.

1. Ocultar/mostrar la sidebar desde el encabezado y comprobar el ancho del contenido.
2. Abrir un enlace autorizado y usar atrás/adelante: conservar la elección de
   escritorio, cambiar la opción activa y mantener un solo encabezado.
3. Abrir las iniciales: comprobar Mi panel, Portal público y Cerrar sesión.
   Ir al portal y regresar sin perder la sesión.
4. Con una cuenta de pruebas, cerrar desde el pie de la sidebar y después desde
   el menú de usuario, iniciando sesión entre ambos recorridos.
5. En móvil, abrir/cerrar, probar Tab/Shift+Tab/Escape, clic exterior y retorno
   del foco. Comprobar que la salida siga accesible al desplazar los enlaces.
6. Sin sesión o con contraseña pendiente, abrir directamente las URL privadas:
   deben redirigir. Los permisos retirados no deben permitir operaciones.

## Verificación

Las comprobaciones automatizadas y los límites de la revisión visual se registran
en [la arquitectura de navegación](../architecture/management-navigation.md).
Este avance espera revisión humana; no declara terminado PDGLD-114 ni realiza
commits, publicaciones o cambios de estado en Jira.
