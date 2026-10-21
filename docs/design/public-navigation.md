# Entrada pública y navegación de fútbol

Implementación del flujo solicitado el 21/10/2026, con la aclaración final del usuario: **Inicio → elegir deporte → Fútbol → Iniciar sesión → Acceso según permisos**. Desde login, **Continuar como espectador** abre `/futbol`. La imagen proporcionada es una referencia conceptual de navegación; se conserva el diseño existente.

## Continuidad visual

Los tokens existentes ya coinciden con la referencia: petróleo `#123B4A`, cobre `#C97B52`, fondo `#F3F6F7`, superficie `#FFFFFF`, texto `#23252B`. Se conservan `src/styles/tokens.css`, la tipografía Geist, Tailwind 4, las tarjetas redondeadas/bordes discretos del login y los iconos de lucide-react instalados. El cobre se usa como acento decorativo; los textos y acciones mantienen los colores de contraste existentes. No se añaden dependencias.

`components/ui/action-link.tsx` comparte el tratamiento visual de enlaces de acción; `components/layout/public-shell.tsx` comparte encabezado, enlace para saltar al contenido y pie de las dos páginas públicas. La portada usa la identidad del sistema; el portal identifica expresamente a la Liga Municipal de Fútbol de Morelia. Se conserva la decisión existente de no añadir encabezado de marca al login.

## Pantallas y estados

- `/`: título «Elige tu deporte», Fútbol como tarjeta principal enlazada directamente a `/login`. Básquetbol y voleibol muestran «Próximamente»; al seleccionarlos se despliega un aviso «está en desarrollo» mediante details/summary nativo, sin navegación ni módulo deportivo. Se puede abrir/cerrar con teclado.
- `/futbol`: únicamente fútbol, con secciones de partidos programados, resultados y tabla de posiciones. Cada sección muestra su estado vacío explícito. No hay marcadores inventados, rivales de otros deportes, videos, pestañas simuladas ni alineaciones.
- `/login`: formulario y protecciones existentes; enlace visible «Continuar como espectador» independiente del envío del formulario.
- `/access`: conserva la confirmación de sesión y el cierre; añade resumen de permisos por ámbito, estado sin funciones y enlace al portal. No hay pantallas de gestión conectadas actualmente: el resumen lo informa y no añade botones a módulos inexistentes. El error de carga ofrece reintento y regreso al portal.
- El monitor de inactividad conserva la redirección de páginas privadas. Si una sesión anterior vence mientras la persona está en `/`, `/futbol` o `/login`, permite continuar en la parte pública.

Diseño móvil con tarjetas en una columna, tres columnas en escritorio y textos que se adaptan al ancho. Encabezados semánticos, controles de al menos 44 px, foco visible heredado, enlace para saltar al contenido, iconos decorativos ocultos a lectores de pantalla y disponibilidad expresada mediante texto. Los permisos del panel se presentan como listas de lectura, sin controles que aparenten ejecutar operaciones.

## Recorrido manual

Con el entorno local existente configurado:

1. Ejecutar `npm run dev` y abrir la URL que imprime Next.js (habitualmente `http://localhost:3000`).
2. Abrir `/`: comprobar Fútbol disponible y los otros dos deportes «Próximamente».
3. Seleccionar «Entrar a fútbol»: debe abrir `/login`. Seleccionar básquetbol o voleibol debe mostrar que está en desarrollo y mantener la portada.
4. En login, pulsar «Continuar como espectador»: debe abrir `/futbol` sin cuenta, con los tres estados vacíos.
5. Iniciar sesión con una cuenta local existente. Una cuenta operativa llega a `/access`; una temporal conserva `/change-password`, cierre y nuevo login.
6. Revisar permisos y ámbitos del panel. Una cuenta sin concesiones ve el estado sin funciones. No se crean cuentas ni se conceden permisos al visitar páginas públicas.
7. Sin sesión, abrir directamente `/access` y `/change-password`: deben llevar a `/login`.
8. Recorrer con Tab/Shift+Tab y Enter, y comprobar anchos de móvil y escritorio. Las tarjetas «Próximamente» solo deben desplegar su aviso, sin navegar.

Resultados ejecutados y límites: [arquitectura y validación](../architecture/public-navigation.md).

## Pie del login

Por revisión visual del usuario, el pie de `/login` incorpora «Elegir deporte» con
flecha hacia la izquierda y enlace a `/`. Reutiliza el estilo del enlace del portal,
con foco visible y área de interacción de al menos 44 px. Se alinea a la derecha en
escritorio y se apila con la identificación de la liga en móvil.

Se verificaron TypeScript y ESLint, además del enlace en navegador anónimo: foco
visible, Enter hacia la selección de deporte y vista de 320 px sin desbordamiento.
