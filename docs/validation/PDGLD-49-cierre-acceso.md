# HU18-01 / PDGLD-31 — correcciones PDGLD-49

Revisión: 21/10/2026, America/Mexico_City. Base inicial comprobada mediante fetch: `origin/develop` y HEAD en `a7396c3`, incluido PR #11 de Nickte y las suites de Karol. Rama: `fix/PDGLD-49-PDGLD-54-cierre-acceso`. Esta entrega corrige los incumplimientos solicitados; no sustituye la aceptación de toda la historia.

| Criterio | Implementación | Prueba o evidencia | Resultado / pendiente |
| --- | --- | --- | --- |
| Política configurable, defaults 5/15, límites seguros | `login-policy.ts`, consumida antes de consultar credenciales. Enteros decimales 1–20 y 1–1440 minutos; error genérico ante configuración inválida. `.env.example` actualizado. | `login-policy.test.ts`: ausentes, configuración y límites, rechazo de vacíos/fracciones/negativos/exponentes/hexadecimal/desbordamientos. HTTP: reinicio con 3 intentos/2 minutos. | Implementado y aprobado en pruebas puras y PostgreSQL 15. |
| Concurrencia, recuperación y reinicio | Conserva `lockAuthUser`, lectura tras bloqueo y reinicio tras éxito o bloqueo vencido. | Caso HTTP existente de cinco fallos simultáneos; intento durante bloqueo; vencimiento simulado en fila y nuevo login. | Conservado y aprobado en PostgreSQL 15. |
| LOGIN_FAILED y BLOCK atómicos, transición única | Eventos dentro de la transacción de contador/bloqueo; intentos bloqueados no repiten BLOCK. | Cinco fallos: cinco LOGIN_FAILED y un BLOCK; intento bloqueado añade solo LOGIN_FAILED. CHECK temporal de rechazo de eventos demuestra rollback de contador y evento previo si falla BLOCK. | Implementado y aprobado en PostgreSQL 15. |
| Identidad inexistente sin filtración ni cuenta ficticia | LOGIN_FAILED con user_id NULL, FK existente; no registra email ni el input. Contrato inválido se rechaza antes de la base. | HTTP con cuenta inexistente, error genérico, sin sesión y conteo de usuarios idéntico. | Implementado y aprobado en PostgreSQL 15. |
| PASSWORD_CHANGED y credenciales atómicos | Misma transacción para hash, flag, versión, contadores, bloqueo y evento. | CHECK temporal que impide PASSWORD_CHANGED: hash/flag/versión/contadores iguales, sin evento; después éxito y dos cambios concurrentes con un único ganador/evento. | Implementado y aprobado en PostgreSQL 15. |
| Origen confiable y JSON en ruta propia | NEXTAUTH_URL obligatorio y válido, sin derivar confianza de URL/Host/forwarded. Origen ausente/ajeno/null/cross-site: 403. Tipo no JSON: 400. | HTTP con cookie válida y contraseña correcta; todos los rechazos conservan estado y eventos de éxito. Incluye origen ajeno y forwarded manipulados. | Implementado y aprobado en PostgreSQL 15. |
| Flujo temporal → cambio → cierre → nuevo login | Conserva NextAuth 4, versión de usuario, UI de Nickte y cierre existente. | Casos existentes de auth/catálogo/cuentas usan Origin real. Nueva contraseña autentica; anterior y cookies previas se deniegan. | HTTP aprobado; recorrido visual manual no realizado. |
| LOGIN_OK / LOGOUT sin duplicación | `persistent-session.ts` intacto; eventos junto a creación/revocación de sesión. | Suite existente `session-lifecycle.test.mjs`, incluidos cierre concurrente/idempotente y rollback de auditoría. | Aprobado en PostgreSQL 15. |

## Verificación y límites

- `npm run test:auth`: 102 resultados aprobados: 6 de política de sesiones, 3 de política de login, 27 del proceso TypeScript de autorización y 66 del proceso HTTP/base. Cero fallos, cancelaciones u omisiones en la ejecución completa final; los conteos incluyen las pruebas contenedoras de node:test.
- `npm run test:authorization`: 61 resultados aprobados (27 + 34), sin fallos, cancelaciones u omisiones.
- `npm run test:ci`: 12 aprobados. `npm run typecheck`, `npm run lint`, `npm run ci:guard-migrations` y `git diff --check`: correctos.
- `npm run build`: correcto fuera del sandbox; dentro, Windows denegó crear el junction de Prisma requerido por Turbopack. No se modificó configuración para esquivar ese límite.
- PostgreSQL 15 en un contenedor propio con tmpfs, puerto loopback 5433 y contraseña efímera no impresa; el runner existente creó/aplicó migraciones/eliminó únicamente su base `pdgld48_test_<aleatorio>` y detuvo su Next.js. El contenedor se eliminó al finalizar. No se usaron volúmenes ni cuentas persistentes del equipo.
- El runner fija 5/15 para aislarse de preferencias locales y permite reinicio con otra política. Los CHECK de inyección de fallo existen únicamente en la base temporal del runner y se retiran en finally; no se desactivan triggers ni se modifica el baseline.
- Primer intento del harness: detenido al conectar al PostgreSQL local, antes de crear fixtures. No es una ejecución aprobada.
- Las ejecuciones intermedias detectaron el fallo de importación Windows/tsx de la suite de Karol y un reloj de fixtures que no afectaba al path fijado del trigger; se corrigieron en PDGLD-54 antes de obtener los resultados finales. No se contaron esos intentos como suites completas aprobadas. Las aserciones de credenciales comparan el hash mediante booleanos y omiten su valor en diagnósticos de fallo.
- No hay commits, push, PR publicado, cambios en Jira, Supabase ni despliegues. Alojamiento compartido, CI remoto, PostgreSQL 17 y aceptación manual se coordinan por separado.

## Preparación del commit

Todos los cambios de estos archivos pertenecen exclusivamente a PDGLD-49: `.env.example`, `package.json`, `scripts/test-auth.mjs`, `src/server/auth/login-policy.ts`, `src/server/auth/login-policy.test.ts`, `src/server/auth/credentials.ts`, `src/app/api/auth/change-password/route.ts`, `tests/integration/auth.test.mjs`, `tests/integration/accounts.test.mjs`, `tests/integration/catalog-accounts.test.mjs`, `docs/architecture/authentication.md`, `docs/authentication.md` y este documento. No se mezcla aquí el archivo nuevo de pruebas de jugadores ni su documento de PDGLD-54.
