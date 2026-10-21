# Encabezado y menú de la cuenta

Decisión actualizada el 21/10/2026 con la revisión visual del usuario: el encabezado
privado muestra «Liga Municipal · Morelia», las iniciales, `@usuario` y los nombres
de sus roles vigentes debajo del usuario. Se omite el nombre completo. Conserva
Geist, los tokens de petróleo/cobre, las superficies blancas y el foco del sistema.
El `@` es presentación; el login sigue usando correo y contraseña.

Las iniciales son un botón que abre un menú pequeño. Sus opciones, en este orden,
son «Mi panel» (`/access`), «Portal público» (`/futbol`) y «Cerrar sesión». En la parte
pública la primera opción se llama «Ir a mi panel». Una sesión restringida muestra
«Cambiar contraseña» en su lugar; el servidor conserva todas sus restricciones.
No se agregan opciones sin funcionalidad ni fotografías.

El menú se utiliza en `/access`, `/accounts/new`, `/change-password`, `/` y `/futbol`
cuando hay sesión. Los visitantes anónimos conservan «Iniciar sesión». Las páginas
públicas no consultan ni muestran roles o ámbitos privados. La invitación inferior
de login del portal aparece solo sin sesión. Elegir Fútbol desde la portada sigue
abriendo el portal, conforme al cambio anterior de esta rama.

## Interacción y accesibilidad

- El botón anuncia el menú, su estado abierto/cerrado y la cuenta. Clic, Enter o
  Espacio lo alternan; flecha abajo/arriba lo abren en la primera/última opción.
- Las opciones reciben foco al abrir. Flechas arriba/abajo recorren las opciones;
  Inicio/Fin van a sus extremos. Enter y Espacio activan los enlaces.
- Escape cierra y devuelve el foco a las iniciales. Tab/Shift+Tab cierran y siguen
  el recorrido normal de la página. Un clic exterior también cierra el menú.
- El menú permanece montado mientras está oculto para conservar el estado de un
  cierre de sesión pendiente y su prevención de envíos duplicados. Los elementos
  ocultos no participan en el recorrido por teclado ni en el árbol accesible.
- El encabezado se mantiene compacto en móvil. El username largo se acorta
  visualmente y conserva su valor completo en la etiqueta accesible y en `title`.
  Los roles se ajustan al ancho. El menú se limita al ancho disponible de pantalla.

## Datos y seguridad

`features/auth/server/account-presentation.ts` obtiene identidad mediante el helper
existente del servidor. Las vistas privadas consultan las asignaciones vigentes y
reutilizan `resolveAuthorizationContext` para omitir ámbitos inactivos o incoherentes.
Se muestran todos los nombres de rol distintos, sin inventar un rol principal ni
un contexto activo. Las etiquetas no conceden permisos: el resumen del panel y los
servicios siguen comprobando permisos efectivos y alcance, incluso para SUPERADMIN.

El componente cliente recibe solo username, iniciales, nombres de rol cuando
corresponden y el estado de cambio obligatorio. No recibe el nombre completo,
identificadores internos, correos, ámbitos, matriz de permisos ni secretos. Si un
username heredado contiene un correo, se omite y se presenta «Mi cuenta», sin cambiar
el registro. No se amplían sesión/JWT ni se crea una caché compartida de cuentas.

«Cerrar sesión» conserva `SignOutButton` y el contrato actual de NextAuth 4, con
CSRF, revocación y auditoría del servidor. Navegar al portal no cierra la sesión.
El monitor existente refresca la presentación al detectar cambios de identidad,
restricción o vencimiento y permite seguir como espectador en la parte pública.

## Recorrido manual local

1. Abrir `/access` con una cuenta local operativa: comprobar `@usuario`, iniciales y
   rol debajo del usuario, sin nombre completo ni botón de cierre fuera del menú.
2. Pulsar las iniciales: comprobar «Mi panel», «Portal público», «Cerrar sesión».
   Abrir el portal y regresar al panel mediante el menú; conservar la sesión.
3. Repetir con Enter/Espacio, flechas, Inicio/Fin, Escape, Tab/Shift+Tab y clic exterior.
   Revisar foco visible y ausencia de desbordamiento a 320/390 px.
4. Con varios roles vigentes, comprobar que aparecen todos. Las asignaciones futuras,
   vencidas o de ámbitos inactivos no deben presentarse como roles vigentes.
5. Con una cuenta temporal, comprobar «Cambiar contraseña» y acceso al portal.
   Sin sesión, comprobar «Iniciar sesión» y ausencia de identidad.
6. Para una demostración desechable, ejecutar `npm run auth:demo`; las cuentas
   sintéticas están documentadas en `docs/authentication.md`.

## Verificación

La implementación inicial del encabezado pasó 104 comprobaciones de integración,
12 del formulario, 9 de políticas y 12 del pipeline. Incluyeron duplicados de
username/correo, índices únicos existentes y rollback, sin nuevas migraciones.

La revisión del menú conserva las suites de navegación/autorización/cuentas del
runner local, y comprueba que el nombre completo y los ámbitos no se envíen al
encabezado, que aparezcan los roles privados y que se mantengan las restricciones
del cambio obligatorio y la navegación pública.

La versión final del menú pasó 72 comprobaciones locales (38 del subproceso de
autorización y 34 del proceso principal), además de ESLint y compilación de
producción con TypeScript. La compilación se aisló en `.next-auth-tests` para
conservar el servidor de desarrollo que el usuario tenía abierto.

La revisión de navegador cubrió el menú en escritorio y móvil, clic en iniciales,
foco al abrir, flechas, Escape, Tab/Shift+Tab, clic exterior y panel → portal → panel.
Se usó una pestaña de revisión aparte para evitar interferir con las anotaciones
del usuario. No se creó ninguna cuenta desde el formulario ni se cerró la sesión
que el usuario tenía abierta. La revocación y auditoría siguen cubiertas por las
pruebas HTTP existentes en PostgreSQL local desechable.
