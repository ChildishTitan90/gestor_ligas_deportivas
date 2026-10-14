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
4. El JWT cifrado de NextAuth incluye `sub` (UUID), `userVersion` y `mustChangePassword`, además de metadatos técnicos generados por la biblioteca. No incluye correo, nombre, roles, hash, contraseña ni secreto MFA.
5. El callback JWT consulta el usuario vigente en **cada** lectura de sesión: deniega cuenta eliminada/inactiva/bloqueada o versión distinta. Omite todos los datos enviados por `useSession().update()`.
6. La sesión pública tiene `user?: { id, mustChangePassword }` y `expires`. Una identidad invalidada no tiene `user`. NextAuth 4 puede omitir `expires` al leer mediante `getServerSession()` en un Server Component; no utilizarlo para autorización.

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

Los campos existentes son `users.must_change_password`, `password_hash`, `failed_login_attempts`, `locked_until` y `version`. El login ya respeta un `locked_until` vigente; **todavía no incrementa contadores ni genera bloqueos**. Implementar la política persistente/concurrente de cinco fallos y 15 minutos, reinicio tras éxito y desbloqueo, con valores configurables. `.env.example` reserva `AUTH_MAX_FAILED_ATTEMPTS` y `AUTH_LOCKOUT_MINUTES`; este ticket no los consume ni afirma que el límite esté activo.

El cambio debe obtener identidad mediante `requireAuthenticatedUser()`, validar Zod en servidor, verificar la contraseña pertinente, usar `hashPassword()` y actualizar hash, `must_change_password=false` y `version` incrementada en una transacción. **No existe trigger que incremente version**. El incremento invalida JWT anteriores. Exigir login nuevo después del cambio. Una sesión nacida restringida conserva la restricción aunque alguien retire el flag de la base sin incrementar la versión. No permitir que un payload `update()` cambie identidad o estado.

Mientras faltan operación y vista de cambio, `/change-password` informa la restricción y no ofrece una salida administrativa. No desactivar el flag de cuentas temporales para simular un flujo completo.

## Integración de Nickte — PDGLD-50

Reutilizar `features/auth/schemas.ts`, tipos seguros y `LoginForm` o sustituir su presentación conservando el contrato de signIn. Rutas mínimas: `/login`, `/access`, `/change-password`. Los errores de credenciales permanecen genéricos; carga, validación por campo y fallo de red son estados distintos. Consultar [decisión visual](../design/auth-access.md). La vista definitiva de cambio consumirá el servicio de Sergio; no hay una operación ficticia ni autorregistro.

## Integración de Karol — PDGLD-51

El enlace de salida abre la confirmación nativa de NextAuth. La revocación individual persistente, actividad efectiva, avisos y pruebas completas de cierre/expiración siguen pendientes. Existe `sessions(id, user_id, token_hash, created_at, last_activity_at, expires_at, revoked_at)`; PDGLD-48 **no escribe ni aplica esa tabla**.

Para vincular JWT con sesiones persistentes, definir un `sid` estable separado del `jti`: NextAuth genera un nuevo jti al recodificar JWT. Guardar solo el hash del identificador secreto pertinente y consultar revocación/actividad en servidor antes de operaciones; no exponer el secreto en la sesión pública. `users.version` permite invalidación global deliberada; incrementarlo al cambiar credenciales y en revocaciones globales. Añadir el contrato y sus pruebas al completar PDGLD-51.

**No hay inactividad efectiva implementada en PDGLD-48.** Se mantiene el vencimiento/renovación técnico predeterminado de NextAuth 4 (30 días); no constituye una nueva política máxima aprobada y deberá sustituirse al integrar la persistencia/actividad de PDGLD-51. No presentar `session.maxAge=1800` como implementación de 30 minutos de inactividad. `AUTH_IDLE_TIMEOUT_MINUTES=30` queda reservado en `.env.example`, sin consumidor en este ticket. No habilitar funciones administrativas reales antes de completar sus controles y RBAC.

`authentication_events` admite LOGIN_OK/LOGIN_FAILED/LOGOUT/PASSWORD_CHANGED/BLOCK y es inmutable mediante triggers. La auditoría de accesos se debe completar coordinadamente en 49/51 sin secretos ni registros completos de usuarios. No insertar eventos en fixtures de la base habitual: utilizar bases temporales para poder retirarlas sin alterar los triggers.

## Compilación y pruebas aisladas

El directorio `.next-auth-tests` aísla el build/lock del runner. Se ignora en Git/ESLint y Next registra sus tipos en tsconfig. `experimental.turbopackPluginRuntimeStrategy: "workerThreads"` evita el fallo reproducido del canal IPC de los loaders CSS en Windows/Node 24.9; mantiene Tailwind 4 y su loader. La opción está documentada en Next.js 16.4 en `turbopackPluginRuntimeStrategy.md`. En versiones Node afectadas por el problema de cierre de workers, Next vuelve automáticamente a childProcesses; no se fuerza un modo incompatible. Revalidar al actualizar Node/Next.

## Fuentes

- Documentación instalada: `node_modules/next/dist/docs/01-app/02-guides/authentication.md`, `data-security.md`, guía de estructura y referencia `route.md`.
- [Credentials NextAuth 4](https://next-auth.js.org/providers/credentials), [getServerSession](https://next-auth.js.org/configuration/nextjs), [callbacks](https://next-auth.js.org/configuration/callbacks).
- [Biblioteca Argon2 para Node](https://github.com/ranisalt/node-argon2).
