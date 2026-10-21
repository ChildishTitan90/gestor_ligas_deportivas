# Autenticación — PDGLD-48

Fecha: 13 de octubre de 2026. Alcance: integración Credentials de NextAuth 4 con Prisma 7, PostgreSQL y Zod. No termina PDGLD-31.

## Decisiones verificadas

Se consultaron [PDGLD-48](https://victoranhernandez.atlassian.net/browse/PDGLD-48), [PDGLD-31](https://victoranhernandez.atlassian.net/browse/PDGLD-31), [PV-01 / PDGLD-65](https://victoranhernandez.atlassian.net/browse/PDGLD-65) y las subtareas 49/50/51. El acuerdo interno del 13/10/2026 permite correo y contraseña, cuentas provisionadas por SUPERADMIN sin autorregistro público, cambio obligatorio, 30 minutos de inactividad efectiva y cinco fallos consecutivos con bloqueo de 15 minutos. La confirmación del profesor, segundo factor y duración máxima adicional siguen pendientes.

Versiones de partida comprobadas: Node.js 24.9.0, Next.js 16.4.0, React 19.3.0, NextAuth 4.24.15, Prisma Client/CLI 7.10.0, Zod 4.6.5 y Tailwind 4.3.3. NextAuth queda fijado exactamente en 4.24.15; adaptador PostgreSQL 7.10.0. No se usa NextAuth 5, Supabase Auth ni runtime Edge.

Se conserva `prisma-client-js`, el esquema y el baseline. La CLI continúa con DIRECT_URL e historial en public. El cliente de aplicación usa DATABASE_URL y el adaptador PrismaPg; `getPrisma()` crea el pool de forma diferida y reutiliza la instancia por proceso (también en recarga de desarrollo). No hay consultas en componentes cliente ni llamadas HTTP del servidor a su propia API.

La base local no tenía usuarios al inspeccionar únicamente conteos de formatos. `password_hash` es texto libre, sin un formato heredado documentado. Para esta integración se adopta **Argon2id**, mediante la biblioteca mantenida `argon2`: memoria 19456 KiB, dos iteraciones, paralelismo uno y sal aleatoria de la biblioteca. `hashPassword()` es el contrato de provisión/cambio. No se migra ni interpreta un hash desconocido como texto plano; se rechaza. Si aparece un formato heredado, verificar su procedencia antes de añadir un verificador compatible. Nunca modificar hashes existentes de forma incidental.

## Flujo y datos mínimos

1. `signIn("credentials", { email, password, redirect: false, callbackUrl: "/access" })` utiliza CSRF y cookies de NextAuth 4.
2. `authorizeCredentials()` ejecuta Zod antes de acceder a la base: correo válido de hasta 254 caracteres, normalizado con trim y minúsculas; contraseña de 1–1024 caracteres, sin transformaciones. La política de contraseñas nuevas pertenece a PDGLD-49.
3. La búsqueda utiliza `users.findFirst()` de Prisma Client, con `email: { in: [correo], mode: "insensitive" }` y un `select` mínimo. En Prisma 7.10 este filtro genera comparación literal con `LOWER(email) IN (LOWER(valor))`, coherente con el índice único existente, sin SQL manual. Se usa `in` con un solo correo porque `equals` con `insensitive` genera ILIKE y podría interpretar `_` o `%` como comodines. No se usa `findUnique({ email })`: la unicidad del baseline es sobre `lower(email)` y el modelo Prisma no declara `email` como `@unique`. Después compara Argon2id y deniega inactivos o bloqueo vigente. Una cuenta ausente también verifica un hash ficticio para reducir diferencias de coste.
4. El JWT cifrado de NextAuth incluye `sub` (UUID), `userVersion`, `mustChangePassword`, un `sid` secreto estable y el vencimiento de inactividad calculado por el servidor. El `sid` es aleatorio y solo su hash SHA-256 se guarda en `sessions.token_hash`. No incluye correo, nombre, roles, contraseña ni secreto MFA. Las cookies antiguas sin `sid` requieren nuevo login.
5. El callback JWT consulta sesión persistente y usuario vigente en **cada** lectura: deniega sesión ausente/revocada/vencida y cuenta inactiva/bloqueada o versión distinta. Solo `update({ action: "activity" })`, con CSRF de NextAuth, registra actividad. Los demás datos del navegador se ignoran; GET y update sin esa intención no renuevan la inactividad.
6. La sesión pública tiene `user?: { id, mustChangePassword }` y `expires`, que expresa el plazo real de inactividad. Nunca expone `sid` ni su hash. Una identidad invalidada no tiene `user`. NextAuth 4 puede omitir `expires` al leer mediante `getServerSession()` en un Server Component; la autorización siempre consulta los datos del servidor.

Credenciales inválidas, cuenta inexistente, inactiva, bloqueada o hash no soportado producen la misma denegación CredentialsSignin. No propagar errores Prisma a URLs ni metadata a logs. Los registros técnicos usan códigos constantes sin datos del usuario. La configuración exige un NEXTAUTH_SECRET generado de al menos 32 caracteres; nunca el marcador de ejemplo.

Se conservan CSRF, JWE y cookies HttpOnly/SameSite=Lax de NextAuth 4. Secure depende de NEXTAUTH_URL HTTPS; localhost HTTP es la excepción de desarrollo. Producción requiere HTTPS y secreto persistente. No personalizar cookies para debilitar estos controles. `callbackUrl` solo admite el mismo origen. No hay tokens en localStorage/IndexedDB ni caché compartida de identidades.

## Contrato del servidor

- `getAuthSession()` obtiene la sesión con NextAuth 4 y revalidación del estado de cuenta.
- `requireAuthenticatedUser()` admite también identidades restringidas: **reservarlo para el futuro cambio obligatorio y funciones de sesión**.
- `requireOperationalUser()` exige identidad vigente sin cambio pendiente. Lanza `AuthAccessError` con `UNAUTHENTICATED` (401) o `PASSWORD_CHANGE_REQUIRED` (403).
- Las queries/servicios de negocio deben llamar al helper adecuado y verificar después permisos y alcance con datos actuales del servidor. Identidad operativa no significa SUPERADMIN ni concede autorización para un módulo. No confiar en roles antiguos en JWT, parámetros del navegador o layouts.
- `getAccessIdentity()` y GET `/api/access` demuestran el contrato sin exponer datos administrativos. La ruta responde 401, 403 o `{ user: { id, mustChangePassword: false } }`, con `private, no-store`. `/access` es una confirmación de integración.

No se añade RBAC completo, alta de usuarios de producto ni endpoints administrativos. `npm run seed:dev` carga explícitamente dos cuentas sintéticas persistentes en `gestor_ligas_dev` para trabajar con `npm run dev`; no concede roles ni reemplaza la futura provisión autorizada por SUPERADMIN. El seed reutiliza Prisma y `hashPassword()`, rechaza destinos remotos/producción y no sobrescribe cuentas existentes. Las pruebas automáticas conservan su base desechable dentro del mismo servidor PostgreSQL. La revocación de roles/contexto debe comprobarse por cada servicio según PDGLD-35; estos permisos no se copian al token.

Los futuros servicios que desactiven cuentas o revoquen acceso global deben incrementar `users.version` en su transacción. Consultar `is_active` deniega mientras la cuenta está deshabilitada; el incremento es lo que impide reutilizar la cookie anterior después de una reactivación.

## Integración de Sergio — PDGLD-49

Los campos existentes son `users.must_change_password`, `password_hash`, `failed_login_attempts`, `locked_until` y `version`. El login consume `AUTH_MAX_FAILED_ATTEMPTS` (1–20, predeterminado 5) y `AUTH_LOCKOUT_MINUTES` (1–1440, predeterminado 15) mediante `getLoginPolicy()`. Solo admite enteros decimales positivos: vacío, espacios, fracciones, notación exponencial y valores fuera de límites son errores de configuración; no se sustituyen silenciosamente por defaults. Se evalúa por petición dentro del manejo de error genérico, antes de consultar la cuenta; una configuración inválida impide autenticar. El bloqueo de fila transaccional por cuenta conserva concurrencia, reinicio tras éxito o bloqueo vencido y vencimiento sin prolongación por intentos posteriores. Los límites permiten ajustar la operación sin contadores excesivos ni bloqueos superiores a un día; no equivalen a una nueva política aprobada del equipo.

El cambio debe obtener identidad mediante `requireAuthenticatedUser()`, validar Zod en servidor, verificar la contraseña pertinente, usar `hashPassword()` y actualizar hash, `must_change_password=false` y `version` incrementada en una transacción. **No existe trigger que incremente version**. El incremento invalida JWT anteriores. Exigir login nuevo después del cambio. Una sesión nacida restringida conserva la restricción aunque alguien retire el flag de la base sin incrementar la versión. No permitir que un payload `update()` cambie identidad o estado.

`/change-password` ofrece el cambio funcional de contraseña, que actualiza hash, flag y versión atómicamente. Al finalizar, cierra la sesión y solicita un nuevo login. No desactivar el flag de cuentas temporales para simular un flujo completo.

El endpoint propio `POST /api/auth/change-password` exige `Origin` exactamente igual al origen público de `NEXTAUTH_URL`, rechaza origen ausente/ajeno y `Sec-Fetch-Site: cross-site` con 403 `INVALID_ORIGIN`, y exige `application/json` (parámetros como charset admitidos) con 400 `INVALID_PAYLOAD` para otros tipos. No usa `request.url`, `Host` ni `X-Forwarded-*` como fallback de confianza. Configuración ausente/inválida devuelve 503. Estos controles preceden sesión, lectura del cuerpo y escritura; la UI integrada del PR #11 conserva su fetch JSON y el navegador aporta Origin. Las rutas propias no heredan la protección CSRF de las rutas internas de NextAuth 4.

Cada intento válido por contrato que falla registra `LOGIN_FAILED`. Cuenta inexistente o eliminada durante la consulta usa `user_id = NULL`, permitido por la FK: no crea identidades, almacena correo ni revela la causa en la respuesta. Cuenta inactiva o ya bloqueada registra el rechazo sin cambiar contadores ni prolongar el bloqueo. Para credenciales incorrectas, contador/bloqueo, `LOGIN_FAILED` y, solo al bloquear, `BLOCK`, se confirman en una misma transacción bajo el bloqueo de cuenta. Un fallo de cualquiera de esos eventos revierte toda la operación.

El cambio exitoso confirma hash, flag, versión, reinicio de contadores/bloqueo y `PASSWORD_CHANGED` en una misma transacción. Un fallo de auditoría responde con error genérico y revierte todo; un rechazo de origen, JSON, sesión o contraseña actual no produce ese evento de éxito. `LOGIN_OK` y `LOGOUT` siguen exclusivamente en las operaciones de sesión persistente de PDGLD-51, sin duplicación. Los payloads inválidos se rechazan antes de consultar cuentas. No se registran contraseñas, hashes, cookies, tokens ni datos completos de personas. Ver la [validación de PDGLD-49](../validation/PDGLD-49-cierre-acceso.md).

## Integración de Nickte — PDGLD-50

Reutilizar `features/auth/schemas.ts`, tipos seguros y `LoginForm` o sustituir su presentación conservando el contrato de signIn. Rutas mínimas: `/login`, `/access`, `/change-password`. Los errores de credenciales permanecen genéricos; carga, validación por campo y fallo de red son estados distintos. Consultar [decisión visual](../design/auth-access.md). La vista definitiva de cambio consumirá el servicio de Sergio; no hay una operación ficticia ni autorregistro.

## Integración de Karol — PDGLD-51

El enlace de salida abre la confirmación nativa de NextAuth. La integración actual utiliza `sessions(id, user_id, token_hash, created_at, last_activity_at, expires_at, revoked_at)` para la inactividad efectiva y revocación individual. El evento `signOut` revoca el hash del `sid` de esa sesión, sin afectar otras sesiones del usuario. Avisos previos al vencimiento y auditoría de accesos siguen pendientes.

El `sid` permanece estable al renovar JWT; NextAuth puede cambiar su `jti`. Cada login crea un registro independiente. `users.version` permite invalidación global deliberada y se incrementa al cambiar la contraseña. Las renovaciones de actividad bloquean la fila de sesión para conservar el orden entre pestañas, revalidan el vencimiento y usan el reloj del servidor; nunca reviven una sesión vencida.

`AUTH_IDLE_TIMEOUT_MINUTES=30` configura ahora el plazo real de inactividad y la vigencia técnica del JWT. `updateAge` se omite porque NextAuth 4 no lo aplica a JWT. `SessionActivity` observa clics, teclas y desplazamientos confiables con la página visible, agrupados cada 15 segundos; no emite heartbeats de actividad. Foco y vencimiento solo consultan la sesión. Antes de volver al login se consulta el plazo vigente, permitiendo la actividad de otra pestaña. Las pruebas HTTP simulan el paso del tiempo solo en fechas de la base temporal y verifican que consultas automáticas, payloads manipulados y cookies antiguas no extiendan ni revivan sesiones. Esto no sustituye los controles RBAC pendientes.

`authentication_events` admite LOGIN_OK/LOGIN_FAILED/LOGOUT/PASSWORD_CHANGED/BLOCK y es inmutable mediante triggers. La auditoría de accesos se debe completar coordinadamente en 49/51 sin secretos ni registros completos de usuarios. No insertar eventos en fixtures de la base habitual: utilizar bases temporales para poder retirarlas sin alterar los triggers.

## Compilación y pruebas aisladas

El directorio `.next-auth-tests` aísla el build/lock del runner. Se ignora en Git/ESLint y Next registra sus tipos en tsconfig. `experimental.turbopackPluginRuntimeStrategy: "workerThreads"` evita el fallo reproducido del canal IPC de los loaders CSS en Windows/Node 24.9; mantiene Tailwind 4 y su loader. La opción está documentada en Next.js 16.4 en `turbopackPluginRuntimeStrategy.md`. En versiones Node afectadas por el problema de cierre de workers, Next vuelve automáticamente a childProcesses; no se fuerza un modo incompatible. Revalidar al actualizar Node/Next.

## Fuentes

- Documentación instalada: `node_modules/next/dist/docs/01-app/02-guides/authentication.md`, `data-security.md`, guía de estructura y referencia `route.md`.
- [Credentials NextAuth 4](https://next-auth.js.org/providers/credentials), [getServerSession](https://next-auth.js.org/configuration/nextjs), [callbacks](https://next-auth.js.org/configuration/callbacks).
- [Biblioteca Argon2 para Node](https://github.com/ranisalt/node-argon2).
