# Navegación pública de fútbol y resumen privado

Fecha: 21/10/2026. Misma rama `fix/PDGLD-49-PDGLD-54-cierre-acceso`, por instrucción del usuario. Referencia inicial actualizada: `origin/develop = a7396c3`, incluido PR #11. Los cambios locales anteriores de PDGLD-49/54 se conservan sin confirmar. Esta implementación no recibe una clave de Jira inventada ni publica un PR.

## Rutas y separación

| Ruta | Acceso y responsabilidad |
| --- | --- |
| `/` | Primera pantalla pública, selección de deporte. Elegir Fútbol abre directamente `/login`; otros deportes despliegan «en desarrollo» sin navegar. |
| `/futbol` | Portal público de fútbol sin cuenta ni consultas de datos privados. |
| `/login` | Login existente más enlace de espectador. Sesión operativa → `/access`; cambio obligatorio → `/change-password`. |
| `/access` | Sesión vigente y operativa; consulta de resumen autorizada en servidor. Sin sesión → login. |
| `/change-password` | Contrato restringido y operación segura existentes, conservados. |

Las páginas son Server Components y delegan la presentación pública en `features/public-portal/components`. El shell común y los enlaces de acción pertenecen a `components/layout` y `components/ui`; no contienen reglas de liga. Se conservan login NextAuth 4, redirecciones internas fijas, cookies, bloqueo, versión, inactividad y autorización en cada entrada/servicio.

`SessionActivity` distingue explícitamente `/`, `/futbol` y `/login` al gestionar el vencimiento: no expulsa al espectador de una página pública por una sesión anterior caducada. No se modifica la expiración ni se renueva una sesión vencida; las páginas/API privadas siguen validando en servidor. Rutas públicas futuras deberán incorporarse deliberadamente a esta distinción.

## Información pública disponible

En el código revisado no existe un servicio de consultas públicas de partidos, resultados o clasificación con un contrato de publicación definido. La presencia de tablas/vistas del baseline no convierte sus filas en información publicable. Por eso las tres secciones muestran estados vacíos y no ejecutan consultas, ni siquiera para después ocultar campos en el navegador.

No hay resultados, equipos, jornadas o videos de ejemplo presentados como oficiales. Básquetbol y voleibol aparecen como «Próximamente» en la portada y su selección solo despliega un aviso «en desarrollo». No tienen rutas ni funcionalidad deportiva. Visitar el portal no crea usuarios, sesiones de invitado ni asignaciones; GUEST y RF22 permanecen intactos.

Cuando se implementen los módulos, el portal consumirá queries públicas deliberadas de partidos/programación y clasificación, con selección mínima y filtros de publicación aprobados. Una lectura privada, un resultado calculado o una bandera de estado aislada no deben reutilizarse como contrato público sin definir sus reglas.

Las alineaciones quedan fuera de este alcance. Se incorporarían como componente de detalle de partido en `features/public-portal/components`, alimentado por una query pública del módulo de partidos, por ejemplo `features/matches/server/public-queries.ts`, cuando estén definidos publicación, estados, rectificaciones, campos de persona permitidos y restricciones de privacidad. No se crea ahora ese servicio, ruta ni consulta de inscripciones/documentos.

## Panel según permisos efectivos

`features/auth/server/access-overview.ts` usa `requireOperationalUser()` y el motor existente, sin consultar el nombre del rol ni la matriz inicial como autoridad. Dentro de una transacción:

1. Lee concesiones actuales mediante `getActorPermissionGrants`, conservando sus bloqueos y filtros de cuenta/ámbitos/vigencia.
2. Agrupa por el ámbito de cada concesión completa, resuelve relaciones con `resolveAuthorizationContext` y comprueba `grantCoversContext`. Una concesión contextual sin ámbito no se presenta como global.
3. Selecciona únicamente IDs/nombres de ligas y clubes ya autorizados para nombrar los ámbitos. Al renderizar devuelve solo nombres, descripciones y etiquetas de acciones; omite persona, correo, rol, IDs de concesiones, sesiones y secretos.
4. No conserva ese resumen en caché ni JWT. Retirar una concesión cambia la siguiente lectura con la misma sesión.

Las etiquetas de módulos/acciones son presentación, no otra matriz ni una autorización para ejecutar operaciones. La información propia/asignación arbitral, separación de funciones y demás reglas siguen siendo obligatorias en los servicios. El resumen marca permisos contextuales como restringidos y explica sus límites.

El acceso anterior solo confirmaba la sesión; no existía un selector de contexto de UI. Se presentan los ámbitos por separado, sin crear doce paneles, inventar un selector o combinar autoridad de varias ligas. Tampoco se añade un administrador de cuentas/permisos: los servicios HTTP existentes mantienen sus controles y los módulos sin pantalla no reciben botones ficticios.

## Regresiones y verificación

### Archivos y motivo del cambio

| Archivo | Cambio y motivo |
| --- | --- |
| `src/app/page.tsx` | Sustituye la redirección inicial por la selección pública de deporte. |
| `src/features/public-portal/components/sport-selection.tsx` | Presenta Fútbol → login y avisos desplegables de deportes en desarrollo, sin abrir otros módulos. |
| `src/components/layout/public-shell.tsx` | Comparte encabezado, contenido, salto accesible y pie entre portada y portal. |
| `src/components/ui/action-link.tsx` | Comparte enlaces de acción con los estilos y tokens actuales. |
| `src/app/futbol/page.tsx` | Define la ruta pública y su identidad de fútbol. |
| `src/features/public-portal/components/football-portal.tsx` | Muestra las tres secciones solicitadas con estados vacíos honestos. |
| `src/app/login/page.tsx` | Añade «Continuar como espectador» sin alterar el contrato del formulario. |
| `src/app/access/page.tsx` | Conserva las redirecciones de sesión y presenta el resumen autorizado junto a la cuenta. |
| `src/features/auth/server/access-overview.ts` | Consulta permisos vigentes por ámbito en servidor y devuelve únicamente etiquetas seguras. |
| `src/features/auth/components/access-overview.tsx` | Renderiza ámbitos, acciones permitidas y estado sin concesiones; no simula herramientas. |
| `src/app/access/error.tsx` | Ofrece un error genérico recuperable y salida al portal público. |
| `src/features/auth/components/session-activity.tsx` | Evita expulsar de las páginas públicas al visitante cuya sesión anterior venció. |
| `tests/integration/authorization-public-navigation.test.ts` | Verifica navegación, protección privada, minimización y revocación por contexto contra la base desechable. |
| `docs/design/public-navigation.md` | Documenta continuidad visual, flujo final y recorrido manual. |
| `docs/architecture/public-navigation.md` | Registra decisiones, límites, archivos y comprobaciones de esta implementación. |

El runner existente descubre `tests/integration/authorization-public-navigation.test.ts`; no se cambia su infraestructura ni el script de pruebas que ya tenía ajustes de PDGLD-49. La suite comprueba entrada pública sin identidad nueva, estados vacíos, enlace de espectador, rutas privadas, resumen por contexto, minimización, concesión contextual global denegada, retirada de permisos sin nuevo login, asignación futura, cambio obligatorio y portal con cookie vencida. Solo escribe en la base local desechable creada por el runner.

Resultados ejecutados:

- `npm run typecheck`, `npm run lint`, `npm run build` y los 12 controles de `npm run test:ci`: aprobados. La compilación conserva `/` y `/futbol` estáticos y las rutas de sesión dinámicas.
- `npm run test:auth`: 110 comprobaciones aprobadas, sin omisiones. Después de la aclaración final Fútbol → login, se repitió `npm run test:authorization`: 69 comprobaciones aprobadas (35 del motor/integración y 34 HTTP), incluida la nueva suite pública y su enlace directo al login. También se repitieron build y lint sobre esa versión final.
- Navegador local: escritorio de 1440 px y móvil de 390/320 px, sin desbordamiento horizontal. Se verificaron selección de Fútbol → login, avisos desplegables de ambos deportes, enlace de espectador → portal, navegación con Tab/Shift+Tab/Enter, foco visible y salto al contenido.
- Con cuentas sintéticas de la demostración desechable: login operativo → `/access`, estado sin concesiones, cierre de sesión, cuenta temporal → `/change-password` y sesión revocada que conserva la portada pública pero redirige `/access` al login. Los contextos con concesiones y la retirada de permisos se comprobaron automáticamente contra PostgreSQL real.

Estas son verificaciones locales, no una ejecución remota de CI ni una validación de producción/PostgreSQL 17. El portal conserva tres estados vacíos hasta definir consultas públicas; el panel presenta el resumen autorizado, sin pantallas de gestión nuevas. El cambio de contraseña sigue cubierto por las pruebas HTTP existentes; en el recorrido visual solo se comprobó su redirección y formulario.

Los puertos locales 5432/5433 ya estaban ocupados. Se descartó iniciar otro contenedor en esos puertos y se usó el runner como está diseñado: crea y elimina su propia base aleatoria en el servidor local validado, sin escribir fixtures en la base habitual ni detener servicios ajenos. No se cambia esquema, migraciones, seeds, matriz RF22 ni Supabase. No se ejecutan commits, push, merge, despliegues o cambios en Jira.

Mensaje de commit propuesto para esta funcionalidad, sin clave inventada: `feat: añadir entrada pública y portal de fútbol con acceso según permisos`. Los archivos de esta funcionalidad están separados de los cambios anteriores sin confirmar.
