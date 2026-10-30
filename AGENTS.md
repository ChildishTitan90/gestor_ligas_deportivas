<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Proyecto: Gestor de Ligas Deportivas

Guía del equipo y de los agentes. Revisada el 29 de octubre de 2026. Conservar intacto el bloque generado de Next.js que precede esta guía.

## Contexto y estado real

- MVP de fútbol amateur para la Liga Municipal de Morelia. Equipo: Víctor, Sergio, Nickte y Karol; todos pueden desarrollar y revisar código.
- Stack instalado: Next.js 16.4, React 19, TypeScript, Tailwind 4, NextAuth 4, Zod 4, Prisma 7.10. Node.js 24; PostgreSQL 15 en Docker local y Supabase actual destinado a producción.
- El esquema tiene 96 tablas iniciales, modelos/columnas en inglés y UUID. `0_init` ya está registrado en la base local de Víctor y Supabase.
- Ya existen autenticación, autorización y pantallas de cuentas, afiliación e inscripción de equipos. PDGLD-114 incorpora la estructura compartida de gestión y los temas visuales; su disponibilidad en otras ramas depende de integrar su PR. El árbol de módulos sigue siendo una guía para nuevos tickets: comprobar qué carpetas y servicios existen antes de reutilizarlos o crearlos.
- `pg` está instalado como dependencia de desarrollo para los controles del pipeline. La integración de Prisma 7 en el backend necesita su adaptador PostgreSQL: no asumir que generar el cliente o instalar NextAuth implementa conexión de aplicación, login o RBAC.
- La PWA de cédulas requiere Service Worker e IndexedDB; no es una aplicación móvil nativa. El MVP no incluye pasarela de pago ni otros deportes.

## Alcance y cambios

- Respetar el alcance del pedido humano. Una revisión de arquitectura o búsqueda de skills no autoriza crear el scaffold, instalar paquetes, modificar base de datos, hacer commits/push/merge o desplegar.
- Crear carpetas cuando una funcionalidad las necesite; no generar todos los directorios del árbol por anticipado.
- No descartar ni mezclar cambios existentes ajenos al ticket. Las ramas `main` y `develop` reciben cambios por PR; no hacer push directo.
- No imprimir ni versionar `.env`, credenciales, conexiones con contraseña, certificados privados o datos personales. `.env.example` contiene marcadores.
- Antes de escribir código Next.js, leer la documentación pertinente de la versión instalada en `node_modules/next/dist/docs/`. Ante ejemplos externos incompatibles, prevalecen esa versión y las decisiones documentadas del proyecto.

## Arquitectura elegida

**Monolito modular con Next.js App Router, organizado por funcionalidad.** Next.js contiene interfaz React y entradas del backend en Node.js. No añadir Express, microservicios, bus de eventos, colas, monorepo u otra infraestructura sin una necesidad concreta del ticket y una decisión documentada.

```text
src/
├── app/                           # Rutas, layouts, Server Components y handlers
├── features/
│   ├── auth/                      # UI y contratos del acceso
│   ├── clubs/                     # Clubes, equipos y afiliación
│   ├── players/                   # Registro, CURP, documentos y elegibilidad
│   ├── competitions/              # Ligas, temporadas, categorías y reglamentos
│   ├── venues/                    # Canchas, disponibilidad y reservas
│   ├── scheduling/                # Calendarios y propuestas
│   ├── matches/                   # Estados, resultados y cierre de partidos
│   ├── match-reports/             # Cédula, captura offline y sincronización
│   ├── discipline/                # Casos, sanciones y recursos
│   └── standings/                 # Tablas y clasificación
├── server/
│   ├── auth/                      # NextAuth, identidad y políticas comunes RBAC
│   ├── db/prisma.ts               # Conexión y cliente Prisma con adaptador
│   ├── audit/                     # Auditoría compartida
│   └── integrations/              # Adaptadores externos realmente necesarios
├── components/
│   ├── ui/                        # Controles accesibles sin lógica de liga
│   └── layout/                    # Navegación y shell compartidos
├── styles/tokens.css              # Paletas y tokens compartidos de la UI
└── lib/                           # Utilidades puras y compartidas
```

Mantener `prisma/schema.prisma`, `prisma/migrations`, `prisma.config.ts`, `compose.yml`, `.github/workflows` y `scripts/ci` donde están. `db/init.sql` es referencia histórica, no inicializador activo. Mantener las guías existentes de `docs/`.

Módulos futuros —finanzas, comunicaciones, administración, documentos— se crean según sus tickets. No crear un módulo por cada tabla ni por cada uno de los 12 roles de usuario. La infraestructura global vive en `server/`; las reglas particulares viven junto a su módulo.

### Estructura de un módulo

```text
features/clubs/
├── components/club-form.tsx
├── schemas.ts                     # Contratos Zod compartibles con la UI
├── types.ts                       # Datos seguros para UI y contratos
├── actions.ts                     # Server Actions breves cuando se necesitan
└── server/
    ├── queries.ts                 # Lecturas autorizadas y selección de datos
    ├── service.ts                 # Reglas, permisos y escrituras/transacciones
    ├── rules.ts                   # Reglas puras cuando lo justifique el módulo
    └── rules.test.ts              # Pruebas de reglas relevantes
```

Un módulo pequeño puede tener un solo archivo de servidor. Separar responsabilidades al crecer. No añadir repositorios/interfaces por cada modelo Prisma ni archivos `index.ts` que reexporten juntos código cliente y servidor. Los imports entre módulos apuntan a contratos o funciones deliberadas; evitar ciclos y acceso a sus componentes/internals para reutilizar negocio.

### Límites y dirección de llamadas

1. `app/page.tsx` o páginas de segmentos delegan las lecturas a `features/<module>/server/queries.ts`; no contienen consultas Prisma o reglas de negocio.
2. La UI envía la escritura a una Server Action o un Route Handler.
3. La entrada obtiene la identidad del servidor y valida el contrato; llama al servicio del módulo.
4. El servicio autoriza permiso y alcance, aplica reglas y coordina Prisma/transacciones. Nunca acepta como verdadero el rol, usuario o club autorizado enviado por el navegador.
5. La respuesta contiene los datos mínimos que la interfaz requiere. Invalidación o actualización de caché se realiza tras el éxito, conforme a la versión Next.js instalada.

Las páginas de servidor consultan la capa de datos directamente; no llamar por HTTP a la propia API para lecturas internas. Los endpoints HTTP se crean para contratos que lo necesitan, especialmente PWA. Action y endpoint reutilizan el mismo servicio; no duplicar reglas de negocio por cada entrada.

## Next.js y seguridad del servidor

- Usar Server Components por defecto. `use client` solamente en límites interactivos o que utilicen APIs del navegador.
- Marcar módulos exclusivos de servidor con `server-only`; `use server` identifica las acciones invocables, no vuelve privada una función por sí solo. Un módulo `use server` exporta funciones async según las convenciones de Next.js.
- Prisma, sesiones privilegiadas, secretos, datos internos y conexiones no se importan desde componentes cliente, contratos compartidos o IndexedDB.
- `schemas.ts` y `types.ts` deben poder compartirse sin arrastrar imports de Prisma runtime, autenticación de servidor o configuración sensible.
- NextAuth es versión 4: configurar sus opciones y handler según esa versión; no usar automáticamente `auth()` u otros ejemplos propios de Auth.js/NextAuth 5.
- Server Actions y Route Handlers autentican, validan y autorizan cada operación. La capa de datos también protege lecturas y escrituras. Un layout protegido o un botón oculto no reemplaza estos controles.
- RBAC combina permiso con liga, temporada, club, equipo o partido autorizado. Comprobar el alcance contra los datos del servidor; no permitir que un delegado use un ID ajeno aunque tenga permiso de edición en su club.
- NextAuth identifica al usuario; no lo convierte automáticamente en un rol PostgreSQL. La conexión administrativa puede omitir RLS, por lo que el RBAC del backend es obligatorio.
- Seleccionar campos mínimos y devolver DTOs seguros. No enviar al cliente usuarios completos, hashes, tokens, CURP o documentos si no los necesita y está autorizado. No compartir cachés de datos privados entre usuarios con permisos diferentes.

## PostgreSQL, Prisma y reglas del dominio

- Mantener nombres existentes en inglés/snake_case, UUID y schemas actuales. No renombrar modelos o tablas para ajustarlos al nombre de una carpeta.
- La CLI usa `prisma.config.ts`, con `DIRECT_URL` y el historial en `public`; los datos del negocio están en `sports_management`. No reorganizar esto incidentalmente.
- En código de aplicación centralizar Prisma 7 y su adaptador PostgreSQL en `server/db/prisma.ts`. No asumir configuraciones del cliente de Prisma 6 ni actualizar versiones para copiar un ejemplo.
- Validar con Zod también en servidor. La unicidad de CURP se garantiza con la restricción de PostgreSQL; una consulta previa no evita carreras concurrentes. Traducir los conflictos a mensajes útiles para el usuario.
- Las operaciones relacionadas que deban ser atómicas usan transacciones. Mantener restricciones, funciones, triggers y vistas del baseline. Al usar auditoría, revisar los triggers existentes para no duplicar eventos de la misma operación.
- Centralizar elegibilidad, cambios de estado de partidos, sanciones y cálculo de clasificación en los módulos pertinentes; reutilizarlos desde registros individuales, importaciones o sincronización. Las reglas puras pueden probarse sin servidor/base.
- No editar `0_init` ni migraciones compartidas/aplicadas. Para cambios futuros, crear una migración nueva y revisar el SQL y la conservación de datos.
- `migrate dev`, shadow database y pruebas de desarrollo trabajan sobre una base local adecuada, nunca Supabase. Para recibir cambios locales se usa `migrate deploy` y `generate`, siguiendo `docs/migraciones.md`.
- No usar `db push` para distribuir cambios ni `migrate reset`, `resolve`, scripts iniciales o eliminación de volúmenes para solucionar discrepancias por iniciativa propia.
- RLS permanece habilitado solo en Supabase por decisión del usuario; Docker continúa sin RLS. No cambiar esa decisión automáticamente ni interpretar el baseline como réplica completa de seguridad de una nueva Supabase.

## Captura offline y PWA

- Manifiesto futuro en `src/app/manifest.ts`; Service Worker MVP servido como `/sw.js` desde `public/sw.js`. No crear ni activar estos archivos en una revisión documental.
- IndexedDB, cola local y cliente de sincronización se agrupan en `features/match-reports/offline/`, con archivos `.client.ts` y llamadas del navegador.
- Contrato HTTP previsto: `src/app/api/v1/match-reports/sync/route.ts`; delega a `features/match-reports/server/sync-service.ts` y al servicio de cédulas.
- La cola conserva una clave de operación estable. El servidor verifica identidad, asignación, permisos, estado del partido y contenido en cada sincronización. Garantizar idempotencia mediante el contrato y restricciones adecuadas de la base; no duplicar tarjetas, goles o resultados en reintentos.
- Resolver conflictos de versión explícitamente. No sobrescribir información oficial silenciosamente. No depender exclusivamente de Background Sync; permitir reintento manual y al recuperar conectividad mientras la aplicación esté abierta.
- Distinguir borrador guardado en el dispositivo, pendiente, sincronizado, rechazado y conflicto. No mostrar guardado definitivo si todavía no llegó al servidor.
- Separar datos locales por usuario/partido, limitar su contenido y tratar los pendientes al cerrar sesión o cambiar de cuenta. No cachear indiscriminadamente sesiones, documentos, CURP ni respuestas privadas.

## UI/UX y convenciones

- Carpetas/archivos nuevos en inglés y kebab-case; componentes React en PascalCase. Conservar el alias `@/*` existente. Los textos de producto y documentación del equipo se escriben en español.
- `components/ui` contiene controles genéricos; `features/*/components` contiene pantallas y componentes de negocio. Compartir un componente cuando existe una necesidad real de reutilización.
- Conservar Tailwind 4, Geist y los tokens vigentes de `styles/tokens.css`; los estilos compartidos están en `src/app/globals.css`. No introducir configuraciones de Tailwind 3, otra paleta o paquetes UI por iniciativa propia.
- Diseñar carga, vacío, error, éxito, acceso denegado y estados offline. Formularios con etiquetas, errores asociados al campo y prevención de envíos duplicados. Foco visible y navegación por teclado; no comunicar estados solo por color.
- La cédula arbitral prioriza uso móvil y mala conectividad. Pantallas administrativas priorizan tablas/filtros legibles. Proteger datos sensibles en listados y confirmaciones.
- Nickte/Karol acuerdan flujos y componentes; Víctor/Sergio acuerdan contratos y reglas de servidor. Todos pueden implementar ambas partes y revisar trabajo ajeno. Documentar las decisiones visuales cuando se implementen en `docs/design/` y las arquitectónicas en `docs/architecture/`.

### Base de gestión que deben conservar las nuevas pantallas (PDGLD-114)

- Las rutas de gestión viven en `src/app/(management)/`. Su layout incorpora `ManagementShell`, un único encabezado y el `main` compartido. Una página nueva aporta su contenido y sus consultas autorizadas; no agrega otro shell, `AccountHeader`, menú de cuenta o `main` anidado. El grupo no cambia las URL: conservar enlaces directos e historial. Portal público, login y cambio obligatorio mantienen sus estructuras propias.
- Reutilizar `components/layout/management-shell.tsx` y `management-navigation.tsx`. Conservar sidebar de alto completo, zona de enlaces desplazable, salida al pie, control para ocultar/mostrar y expansión del contenido al ocultarla. Marca, encabezado y franja de cierre comparten las reglas de altura (80 px en escritorio y 64 px en móvil); no compensar sus alturas con márgenes distintos por página. En móvil, la marca y el botón de cierre van en una misma fila, sin otra franja encima.
- La navegación se construye en `features/auth/server/management-navigation.ts` mediante capacidades y servicios existentes. Añadir solo destinos implementados y autorizados; omitir grupos vacíos. No construir otra matriz en el cliente ni usar nombres de roles como permisos. El menú no sustituye la autorización de página, servicio o API, aunque un layout persistente conserve un enlace hasta refrescarse.
- Mantener opción activa con `aria-current`, fondo y borde cobre. En móvil, conservar nombre accesible, cierre por Escape/clic exterior, foco dentro del menú, fondo inerte, retorno del foco y cierre al navegar. Comprobar tamaños pequeños y recorridos de teclado al modificar esta estructura.
- Reutilizar `AccountMenu`: iniciales, `@usuario` y nombres de roles vigentes, sin exponer nombre completo, correo o asignaciones internas. Conservar Mi panel, Portal público y Cerrar sesión; una cuenta restringida muestra Cambiar contraseña. Ir al portal no cierra la sesión.
- Las dos salidas de sesión son deliberadas: pie de sidebar y menú de cuenta. Ambas usan `SignOutButton` y el cierre compartido existente, con prevención de solicitudes duplicadas y recuperación ante error; no sustituirlas por enlaces o cierres de sesión nuevos.

### Apariencia y jerarquía visual acordadas

- Conservar modo claro, oscuro y sistema. Con sesión, el interruptor sol/luna y Usar tema del sistema viven dentro de `AccountMenu`, sin otro selector junto al usuario. Sin sesión, reutilizar `ThemeSelector` en los recorridos públicos. Respetar persistencia del navegador, sincronización entre pestañas y aplicación inicial del tema antes del pintado; no guardar esa preferencia en sesión/JWT ni añadir otra implementación por pantalla.
- Las acciones principales deben distinguirse por su relleno: petróleo con texto blanco en claro y cobre con texto oscuro en oscuro. Reutilizar `ActionLink` o la clase `primary-action` en botones de formulario; las acciones secundarias conservan contorno. No convertir la acción principal en texto plano al cambiar de tema.
- La sidebar conserva su fondo petróleo, separado del contenido en ambos temas; reutilizar `management-sidebar`, `sidebar-link` y los tokens de sidebar/estado activo. Reservar la menta para estados positivos. No usar `--primary` como fondo de botones ni `--surface` como texto sobre la sidebar: esos tokens también cambian con el tema; usar los tokens semánticos de acción y navegación.
- Extender los tokens y componentes compartidos cuando haga falta un estado visual. Mantener contraste, foco visible, etiquetas, errores y estados de carga/vacío/denegación legibles en ambos temas. Un color o icono no reemplaza el texto ni el estado accesible; respetar movimiento reducido en controles animados.
- Un PR de UI debe explicar cómo reutiliza esta base y aportar la validación pertinente en claro/oscuro, escritorio/móvil y teclado. Distinguir pruebas con sesión/backend reales de respuestas simuladas y no declarar verificados recorridos no ejecutados. La estructura de PDGLD-114 no da por implementados el dashboard/modales de PDGLD-115 ni la regresión completa de PDGLD-116.

Referencias de la base: [estructura y recorrido](docs/design/management-shell.md), [temas y contraste](docs/design/color-themes.md) y [integración de rutas/enlaces autorizados](docs/architecture/management-navigation.md).

## Pruebas, Jira y CI/CD

- Rama de trabajo: `tipo/PDGLD-N-descripcion`; commits y PR comienzan con la clave real. Trabajo hacia `develop`; liberaciones de `develop` a `main`, conforme a las protecciones existentes.
- Antes de crear otra rama, comprobar la rama y los cambios existentes. No hacer rebase, reset, limpieza, commit o publicación sin que correspondan al pedido del usuario.
- **Revisión obligatoria de `develop` antes y después de los cambios:** antes de modificar cualquier archivo y nuevamente al terminar, actualizar la referencia remota mediante `git fetch origin develop` (o el remoto configurado) y revisar los commits y archivos actuales de `origin/develop`. No asumir que la rama local `develop`, el contexto de una conversación o una revisión anterior reflejan el estado vigente. Si no es posible actualizar la referencia, indicar esa limitación y no afirmar que se comprobó el estado actual.
- En ambas revisiones, comparar la rama de trabajo y sus cambios locales, incluidos los preparados para commit, contra `origin/develop`. Antes de entregar, comprobar que el diff final no elimina, sobrescribe ni revierte involuntariamente funcionalidades, contratos o correcciones ya integrados por el equipo. Si `develop` avanzó durante el trabajo, integrar sus cambios en la rama de trabajo y ajustar la implementación y las pruebas pertinentes antes de darla por lista.
- **Resolver conflictos automáticamente antes de continuar:** si la actualización desde `develop` genera conflictos con la rama de trabajo, resolverlos de manera autónoma antes de seguir desarrollando o entregar el resultado. Conservar la intención y funcionalidad de ambos cambios, revisar cada conflicto y ejecutar las comprobaciones pertinentes; no descartar trabajo ajeno ni elegir globalmente `ours`/`theirs` para forzar la integración. Esta regla autoriza la integración local y la resolución de conflictos; no autoriza resets, limpieza destructiva, rebase, commits, push, merge de PR ni despliegues que no correspondan al pedido humano.
- Las pruebas verifican comportamientos: RBAC/alcance, CURP duplicada, rollback, transición de partido, disciplina y sincronización idempotente. No escribir pruebas que solo reflejen la forma del código.
- Pruebas puras junto a su módulo; pruebas de base y permisos en `tests/integration`; recorridos en `tests/e2e`, cuando esos tickets configuren los runners. Estas carpetas son objetivo, no suites ya instaladas.
- Actualmente `npm run test:ci` ejecuta los controles `.mjs` de `scripts/ci`, no futuras pruebas TypeScript. Incorporar comandos/runner al implementar pruebas nuevas; no afirmar que CI las ejecuta sin esa integración.
- El pipeline revisa aplicación y migraciones en PostgreSQL temporal 15/17. El check conjunto es `CI listo para integrar`.
- Supabase se actualiza solo mediante ejecución manual desde `main` con `deploy_production`, tras pasar CI y con los secretos del environment `supabase-production`. El workflow debe estar publicado para ejecutarse; consultar estado real y `docs/ci-cd.md`.
- El despliegue verifica historial, RLS y permisos; no corrige seguridad automáticamente. Migraciones que crean tablas o desactivan RLS quedan detenidas hasta definir su plan de seguridad de producción. No debilitar controles para hacer pasar el pipeline.
- Este CD cubre migraciones de base, no el alojamiento de la aplicación. Las alertas de dependencias se revisan en PDGLD-71; no ejecutar `npm audit fix --force` para ocultarlas.

## Skills candidatas: no instaladas por esta revisión

Consultar y revisar la skill pertinente antes de aplicarla; una referencia en esta guía no significa que esté instalada. No instalar ninguna por el solo hecho de estar recomendada. Las preferencias humanas y la versión instalada prevalecen sobre recetas genéricas.

- UI visual: [frontend-design, Anthropic](https://github.com/anthropics/skills/tree/main/skills/frontend-design).
- Revisión de UI/UX y accesibilidad: [web-design-guidelines, Vercel](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines).
- Arquitectura de componentes React: [vercel-composition-patterns](https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns).
- Arquitectura de backend: [architecture-patterns, comunidad wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/backend-development/skills/architecture-patterns). Usar como referencia selectiva para límites y dependencias; conservar el monolito modular de este proyecto, sin introducir capas, interfaces o repositorios por tabla sin una necesidad concreta.
- Rendimiento y acceso a datos React/Next.js: [vercel-react-best-practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices).
- Si el equipo adopta Figma y conecta sus herramientas: [figma-implement-design](https://github.com/openai/skills/tree/main/skills/.curated/figma-implement-design) y [figma-create-design-system-rules](https://github.com/openai/skills/tree/main/skills/.curated/figma-create-design-system-rules). No afirmar acceso a diseños o Figma sin verificarlo.
- `next-best-practices` ya no se distribuye como skill independiente. Sus referencias se incluyen en los documentos de Next.js y el bloque generado de este archivo. [Aviso de Vercel](https://github.com/vercel-labs/next-skills/blob/main/README.md).
- Las skills Prisma existentes en `.agents/skills` se eligen según tarea y se comprueba compatibilidad con Prisma 7/Supabase. No aplicar instrucciones de Prisma Postgres/Compute como si fueran Supabase.

## Referencias del equipo

- `README.md`: entrada y estado del proyecto.
- `docs/guia-equipo.md`: instalación, Docker y flujo Git/Jira.
- `docs/migraciones.md`: baseline y cambios de base.
- `docs/ci-cd.md`: comprobaciones y liberación controlada.
- `docs/revision-entorno.md`: validaciones realizadas y dependencias pendientes.
- Next.js: `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`, `01-app/02-guides/data-security.md`, `01-app/02-guides/authentication.md` y `01-app/02-guides/progressive-web-apps.md`.

## Selectores desplegables compartidos

- Usar `components/ui/select-field.tsx` (`SelectField`) para seleccionar valores en formularios, filtros, paneles y demostraciones. No añadir `<select>`, `<datalist>`, menús del sistema ni otra implementación particular por pantalla. El menú de cuenta conserva su componente y semántica propios.
- **Conservar el aspecto cerrado que ya tiene la app:** campo completo con borde redondeado, fondo de superficie, texto/placeholder y flecha alineada a la derecha, altura mínima de 48 px y estados deshabilitado/error/foco visibles. La personalización corresponde al menú abierto; no reemplazar el campo por texto suelto ni eliminar su recuadro. La variante compacta del selector de tema conserva su tamaño específico.
- Las opciones utilizan los tokens vigentes de claro/oscuro, una lista desplazable y resaltado cobre para opción activa/seleccionada. La selección confirmada muestra además una marca de verificación y `aria-selected`; recorrer o filtrar opciones no confirma un valor. No sustituir estos estados por el color predeterminado del navegador.
- Pasar opciones serializables `{ value, label, description?, disabled? }`; `value` conserva el identificador o código del contrato real. `description` admite referencias breves como el código del club. Buscar no envía texto libre ni modifica el valor confirmado. Para selecciones breves sin búsqueda, como el tema compacto, reutilizar `searchable={false}`.
- Preservar `id`, etiqueta asociada, `name`, `required`, `disabled`, `aria-invalid` y `aria-describedby`. Los selectores controlados usan `value` y `onValueChange`; los formularios GET o no controlados usan `defaultValue`. No elegir automáticamente otro club, liga o temporada al filtrar ni conservar identificadores de opciones retiradas.
- El valor de formulario se envía mediante un campo oculto. Para enfocar errores o restablecer el foco, usar `focusFormControl` en lugar de enfocar directamente `form.elements.namedItem(name)`, que puede devolver el campo oculto. Conservar validación de servidor y bloqueos de operaciones inciertas; el selector no concede permisos.
- Mantener flechas, Enter, Escape, Tab, búsqueda sin distinción de acentos, foco visible y cierre al salir del control. El popup se ajusta al espacio disponible, puede abrir hacia arriba y respeta el desplazamiento de página/lista y el teclado móvil. Dentro de un diálogo se monta en ese diálogo para conservar su foco y capa modal.
- Verificar campo cerrado y opciones abiertas, ambos temas, móvil/escritorio, teclado, valores de `FormData`, reset, estados dependientes/deshabilitados y opciones cambiantes. Las pruebas estáticas no deben exigir opciones de un popup todavía cerrado. La prueba de navegador con datos sintéticos se ejecuta con `npm run test:team-registration-browser` (configurar `CHROME_BIN` cuando sea necesario); distinguirla de recorridos con backend real.

Referencia de integración y decisiones: [selectores personalizados](docs/design/select-field.md).

## Diálogos breves y bandeja de revisión (PDGLD-115, entrega 2)

- Reutilizar `components/ui/form-dialog.tsx` para captura breve y confirmaciones. El padre conserva captura, errores y estado de envío; no duplicar validaciones, servicios ni permisos en el contenedor. Mantener expedientes, firmas y procesos extensos en página.
- Conservar título/descripción accesibles, foco inicial seguro, fondo inerte, desplazamiento interno en móvil y retorno al control de origen. Escape, X, clic exterior y Cancelar comparten las reglas; advertir antes de descartar captura sin guardar.
- Cerrar un diálogo no cancela una escritura enviada. Evitar doble envío y no descartar el payload/versión ante respuestas inciertas. Ofrecer consulta sin reenviar y reintento manual solo con el mismo contrato/versión; nunca afirmar éxito sin acuse o resultado oficial. Si la captura no persiste entre rutas/recargas, no presentarla como borrador guardado.
- En revisión de afiliaciones, conservar búsqueda por folio/club, filtros por liga/estado/fase/temporada, tabla en escritorio y tarjetas en móvil. Filtrar y contar solo la colección autorizada completa; no calcular totales globales con una página parcial. Con varias ligas, exigir selección explícita.
- Validar foco, descarte, doble envío, incertidumbre y pérdida de permisos. `test:management-ui` usa Chrome headless y respuestas sintéticas; distinguirlo de pruebas HTTP/base reales y de revisión visual manual. La integración de grupos de PDGLD-95 espera la entrega 3.

Referencias: [diálogos](docs/design/management-dialogs.md) y [bandeja de afiliaciones](docs/design/affiliation-review.md).
