# Acceso mínimo de PDGLD-48

Esta interfaz permite comprobar la integración de autenticación mientras PDGLD-50 desarrolla las vistas definitivas. Se tomó la referencia visual proporcionada por el equipo: superficies claras, bordes discretos, esquinas redondeadas y acento cobre. No incluye la plantilla de jugadores.

## Tokens y accesibilidad

`src/styles/tokens.css` centraliza la paleta; `src/app/globals.css` la expone como colores semánticos de Tailwind 4. No se añadió configuración de Tailwind 3 ni una biblioteca de componentes.

| Token | Color | Uso |
| --- | --- | --- |
| `--primary` | `#123B4A` | Acciones, títulos y foco |
| `--accent` | `#C97B52` | Acentos decorativos |
| `--background` | `#F3F6F7` | Fondo de la aplicación |
| `--surface` | `#FFFFFF` | Tarjetas y campos |
| `--foreground` | `#23252B` | Texto principal |
| `--muted` | `#526371` | Texto secundario |
| `--border` | `#D8DFE2` | Separadores y bordes |
| `--soft` | `#E5EEF1` | Superficies de énfasis |
| `--danger` | `#A42E30` | Errores acompañados de texto |

Se conservan las fuentes Geist existentes. La interfaz permanece clara independientemente del modo del sistema. Los campos tienen etiquetas, autocompletado, errores asociados mediante `aria-describedby` y `aria-invalid`; los errores de servicio usan `role="alert"`. El estado de envío se anuncia, bloquea envíos duplicados y mantiene foco visible. La conexión del navegador se observa para informar el estado offline; los fallos de red también se capturan, porque `navigator.onLine` no garantiza que el servicio responda.

Por ajuste solicitado por Víctor, el encabezado de marca se omite en `/login`; se conserva la identificación de la liga en las vistas con sesión iniciada. El campo de contraseña muestra un placeholder de puntos y un botón con `Eye`/`EyeOff` de `lucide-react`. El botón tiene etiqueta Mostrar/Ocultar contraseña, funciona con teclado y no envía el formulario. Alternar la visibilidad conserva el valor y, tras un intento de acceso, el campo vuelve a estar oculto y vacío.

Los errores se presentan en una alerta con icono `CircleAlert`, borde discreto, fondo suave, título y explicación. El rechazo de credenciales muestra «Correo o contraseña incorrectos» sin confirmar si existe la cuenta. La validación de formato muestra «Revisa tus datos», manteniendo el detalle junto al campo; los fallos de red/servicio muestran una indicación para reintentar. La alerta usa `role="alert"` y asociaciones accesibles, sin depender solo del color.

## Contratos para Nickte (PDGLD-50)

- `/login` es un Server Component; redirige sesiones existentes a `/access` o `/change-password` según `mustChangePassword`.
- `features/auth/components/login-form.tsx` es el único límite cliente. Comparte `loginSchema` con el servidor; no importa Prisma ni sesiones del servidor.
- El envío usa NextAuth 4: `signIn("credentials", { email, password, redirect: false, callbackUrl: "/access" })`. Tras éxito se navega a `/access` y se refresca el árbol del servidor. No acepta destinos arbitrarios del navegador.
- El servidor decide la restricción de cambio obligatorio. La pantalla nunca concede permisos por el resultado local del formulario.
- El formulario muestra errores de validación por campo y un mensaje genérico ante denegación. El mensaje no distingue cuenta inexistente, contraseña incorrecta, cuenta deshabilitada o bloqueo. No hay autorregistro público ni recuperación simulada.
- `/access` muestra únicamente confirmación de sesión. Su lectura pasa por `getAccessIdentity()` y `requireOperationalUser()`; no es un panel administrativo ni implementa RBAC de negocio.
- `/change-password` es un estado restringido sin formulario de cambio. Solo admite sesiones con `mustChangePassword`; informa que la función está pendiente. PDGLD-49 debe implementar la operación segura y PDGLD-50 su vista. Debe conservarse la restricción hasta completar ambas partes.

## Cierre y pendientes

El enlace «Salir de la cuenta» abre la confirmación nativa `/api/auth/signout` de NextAuth 4. No se implementó el flujo de cierre, expiración por inactividad, avisos ni pruebas de PDGLD-51. No hay service worker, persistencia offline de credenciales, token en localStorage ni una vista funcional de cambio de contraseña.

La verificación visual definitiva, los flujos de recuperación acordados y la integración de las pantallas de Nickte/Karol siguen en sus tickets. El diseño de este ticket establece tokens y una pantalla mínima de integración; no declara terminado el sistema visual.
