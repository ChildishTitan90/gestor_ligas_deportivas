# Temas claro, oscuro y sistema

Decisión iterativa de PDGLD-114: conservar la jerarquía de la interfaz al cambiar
de apariencia. Las acciones principales siempre tienen relleno sólido y texto
contrastante; las secundarias conservan contorno. La sidebar debe distinguirse
del área de contenido y marcar la opción activa con fondo y borde cobre.

| Uso | Claro | Oscuro |
| --- | --- | --- |
| Fondo general | `#F3F6F7` | `#101B22` |
| Tarjetas/encabezado | `#FFFFFF` | `#1C2D36` |
| Sidebar | `#123B4A` | `#153F50` |
| Opción activa | `#2A505D` | `#305B6B` |
| Botón principal | `#123B4A` | `#E3A17D` |
| Texto del botón | `#FFFFFF` | `#17282D` |
| Texto principal | `#23252B` | `#EDF3F2` |
| Texto secundario | `#526371` | `#B1C3C5` |

La menta queda reservada para estados positivos. No se reemplazan todas las
acciones o encabezados por ese acento. Los colores de acción y sidebar se separan
de los de texto/superficie para que invertir el tema no elimine sus fondos.

`styles/tokens.css` concentra las paletas. `globals.css` define los estilos
semánticos `primary-action`, `management-sidebar` y `sidebar-link`, incluidos
hover, opción activa y foco. No dependen de generar nuevas utilidades de color
para conservar el relleno. Los formularios y enlaces existentes reutilizan estos
colores sin modificar sus contratos, permisos ni estados de envío.

## Selector y persistencia

Con sesión, la apariencia se controla dentro de `AccountMenu`, sin un selector
adicional en el encabezado. «Modo oscuro» tiene un interruptor deslizante con
sol/luna y los colores petróleo/cobre. Debajo, «Usar tema del sistema» permite
seguir o dejar de seguir la apariencia del dispositivo. Los controles son
`menuitemcheckbox`: anuncian su estado y participan en flechas, Inicio/Fin,
Enter/Espacio y Escape sin cerrar el menú al cambiar la apariencia.

Sin sesión, el selector nativo «Tema de color» sigue disponible junto al acceso
en el portal y arriba del formulario de login. En pantallas pequeñas se muestra
su icono y conserva nombre accesible y opciones. No exige iniciar sesión para
cambiar la apariencia. El interruptor respeta movimiento reducido.

La marca de la sidebar y el encabezado de gestión comparten una altura mínima
de cinco rem (80 px) en escritorio y cuatro rem (64 px) en móvil, con el borde
incluido, para alinear la separación superior. La franja de Cerrar sesión usa las
mismas alturas y queda fija al pie; solo la zona central de enlaces se desplaza.
La sidebar mide 15.5 rem (248 px) en escritorio, con espacios más compactos entre
grupos y enlaces; los controles interactivos conservan al menos 44 px de altura.

- Claro y Oscuro fuerzan esa apariencia.
- Sistema sigue `prefers-color-scheme` y responde a sus cambios.
- La preferencia se guarda en `localStorage` como `liga-theme`, sin datos de
  cuenta, cookies ni solicitudes de servidor. También se sincroniza entre pestañas.
- El script constante de `<head>` aplica el tema antes del pintado. Solo cambia
  los atributos de tema de `<html>`; `suppressHydrationWarning` se limita a ese nodo.
- Si el almacenamiento está bloqueado, Sistema funciona y el cambio se mantiene
  en la página actual. Al recargar puede perderse esa elección.

## Validación y recorrido

`npm run test:theme` comprueba inicialización, persistencia, sincronización,
cambios del sistema, almacenamiento bloqueado y contraste de textos/botones en
ambas paletas. La comprobación numérica no equivale a una auditoría completa de
accesibilidad. Los recorridos del tema no necesitan autenticación ni permisos.

Revisión manual: cambiar el tema en login y portada, recargar, ir al portal y
regresar. Comprobar que Iniciar sesión y Entrar a fútbol sigan destacando; en
gestión, revisar sidebar, opción activa, cierre de sesión y controles del usuario.
La navegación con Tab debe mostrar foco visible. En el menú de cuenta, comprobar
flechas, cambio de apariencia con Espacio y Escape con retorno al usuario. Sin
sesión, el selector se opera con las teclas habituales de un `select` nativo.

Durante esta implementación se detectó una hoja de estilos anterior retenida por
el servidor de desarrollo: los colores nuevos del tema cambiaban, pero faltaban
los rellenos de acciones y sidebar. Se regeneró con un reinicio controlado del
servidor del proyecto y se verificaron los colores calculados en navegador.

Validación local de este avance: TypeScript y ESLint correctos; siete pruebas de
tema, doce de cuentas, veintinueve de revisión/corrección de afiliaciones,
diecinueve del formulario de equipos y tres del cierre de sesión, todas aprobadas.
Se revisaron portada y login en ambos temas en el servidor habitual. La sidebar
se comprobó con una sesión real y datos sintéticos en PostgreSQL local temporal:
fondo, opción activa, ocultar/mostrar, menú de cuenta y foco con teclado.
No equivale a la regresión completa de PDGLD-116 ni a una auditoría de todos los
formularios en cada tamaño de pantalla. No se modificó producción ni se publicó.

La revisión inicial del interruptor, anterior al ajuste compacto, comprobó con
sesión sintética que marca y encabezado terminaban ambos a 96 px, sin desnivel.
El ajuste compacto conserva la regla compartida de altura en ambos elementos.
Flechas y Espacio alternan el
tema sin cerrar el menú; Sistema sigue disponible y Escape devuelve el foco al
usuario. Se mantienen los accesos al panel, portal y cierre de sesión.
