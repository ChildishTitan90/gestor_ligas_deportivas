# Navegación compartida de gestión — PDGLD-114

`src/app/(management)/layout.tsx` integra las pantallas privadas existentes sin
cambiar sus URL. El layout raíz mantiene fuentes, estilos y `SessionActivity`.
Las páginas conservan sus consultas, comprobaciones de sesión y servicios; se
retiran únicamente encabezados y contenedores `main` duplicados.

`components/layout/management-shell.tsx` es el límite cliente para mostrar/ocultar,
menú móvil, foco y opción activa mediante `usePathname`. El estado de escritorio
persiste con el layout. Su DTO de cuenta contiene únicamente username, iniciales
y nombres de rol. No recibe datos de creación de cuentas, clubes o asignaciones.

`features/auth/server/management-navigation.ts` está marcado `server-only` y
reutiliza los servicios siguientes, sin otra matriz de permisos:

| Ruta | Comprobación existente |
| --- | --- |
| `/access` | Sesión operativa. |
| `/affiliations/new` | `canAccessAffiliationCapture()`. Incluye UPDATE para correcciones. |
| `/affiliations/review` | `getAffiliationReviewLeagueOptions()` devuelve ligas consultables. |
| `/teams/registrations` | `getTeamEnrollmentCatalogs({ limit: 1 })` devuelve un club consultable. |
| `/accounts/new` | `getAccountCreationOptions()` devuelve roles que se pueden asignar. |

Las lecturas no se almacenan en JWT ni en caché compartida. El layout se reutiliza
durante navegación cliente; recargar o refrescar vuelve a consultar sus datos.
La retirada de permisos se aplica a cada operación en servidor, aunque la
presentación de un layout ya abierto todavía conserve un enlace.

`ManagementUnavailable` sustituye todo el contenido del grupo si falla la consulta
de accesos, con un mensaje genérico y reintento. No interpreta fallos de servicio
como permiso ni expone el error original. Cada página conserva sus denegaciones y
errores particulares; el control de sesión y cambio obligatorio no depende del
estado visual de la sidebar.

Las dos instancias de `SignOutButton` utilizan `signOutCurrentSession()`: comparten
una promesa pendiente para evitar solicitudes CSRF/POST duplicadas, restablecen
el intento después de un error y mantienen el contrato de NextAuth 4 existente.

## Ejemplo real y ampliación

`src/app/(management)/affiliations/review/page.tsx` obtiene sus ligas autorizadas
mediante `getAffiliationReviewLeagueOptions()` y renderiza su contenido. No importa
`AccountHeader` ni crea otro `main`: los recibe del layout. La URL sigue siendo
`/affiliations/review`.

Su enlace utiliza la misma consulta en `management-navigation.ts`. Para incorporar
otra pantalla implementada, ubicarla en el grupo, consultar su capacidad mediante
el servicio del módulo y añadir un enlace solo cuando esa comprobación lo permita.
Conservar autorización en página/servicio/API y enviar únicamente la presentación
del enlace. No añadir módulos futuros a partir de una etiqueta de rol.

## Comprobaciones y límites

- La suite `authorization-public-navigation.test.ts` está incluida en
  `npm run test:authorization`; usa sesiones HTTP y PostgreSQL local desechable.
  Comprueba rutas directas compartidas, un solo encabezado/main, las dos salidas,
  opción activa, navegación autorizada, ámbitos independientes y revocación.
- `npm run test:management-navigation` comprueba con respuestas simuladas la
  deduplicación del cierre y la recuperación ante rechazo o ausencia de CSRF.
  No es una validación de navegador ni de backend real.
- La revisión visual posterior cubrió escritorio, ambos temas, ocultar/mostrar,
  alineación del encabezado y controles de cuenta con teclado en el navegador
  integrado, con sesión y PostgreSQL local temporal. El recorrido móvil completo
  y la regresión de PDGLD-116 siguen pendientes. El recorrido manual está en la
  guía de diseño.
- No se modifican migraciones, producción, permisos de la base habitual, dashboard
  o modales. No se ejecuta CI remoto ni se da por aceptada la historia completa.

### Revisión de alcance antes del PR

La revisión del 28/10/2026 confirmó la implementación de estructura compartida,
sidebar plegable, navegación por capacidades, opción activa, identidad y las dos
salidas de sesión. Se repitieron TypeScript, ESLint, 102 comprobaciones de
autorización/navegación con PostgreSQL local real y las diez pruebas de tema/cierre,
sin fallos. El portal público no mostró desbordamiento a 320 ni 390 píxeles.

El recorrido móvil autenticado sigue pendiente de validación: el control de
navegador dejó de estar disponible durante el login de la demostración aislada.
No se presenta la revisión del portal ni las pruebas HTTP como prueba del foco,
apertura/cierre o historial del menú móvil privado. Antes de cerrar PDGLD-114,
comprobar ese recorrido con sesión, Escape, Tab/Shift+Tab, clic exterior, retorno
del foco y navegación atrás/adelante. Esto es comprobación de la estructura de
PDGLD-114; la regresión completa de negocio permanece en PDGLD-116.

Las reglas de UI acordadas quedaron incorporadas en `AGENTS.md` para el PR y las
pantallas futuras. La actualización documental no cambia el estado de Jira ni
equivale a CI remoto, aprobación o integración del PR.
