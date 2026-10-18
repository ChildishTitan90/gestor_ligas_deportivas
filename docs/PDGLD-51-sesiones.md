# PDGLD-51 — Integración de sesiones con develop

Revisión local: 17/10/2026. PR #9, cabeza comprobada en GitHub: `ed6dac26d68d5f304f525d8c7b2b9c273167585b`, rama `feat/PDGLD-51-cierre-expiracion-sesiones`. Base: `origin/develop` en `3c0f4c10f3e78363672c2eeb0bdb2230df8b5f00` (PR #7 y #8 integrados). La resolución se preparó en `fix/PDGLD-51-integrar-sesiones-develop`, creada desde la cabeza remota del PR, sin rebase.

## Respaldo y aislamiento

El avance previo de PDGLD-54 quedó en `backup/PDGLD-54-autorizacion-antes-integracion-51`, commit `b97fd172f2335eae7e9d15f9061474b566e36cb1` (30 archivos revisados). La rama original `feat/PDGLD-54-autorizacion-compartida` permanece en `3c0f4c10f3e78363672c2eeb0bdb2230df8b5f00`. El respaldo no es ancestro de esta rama de resolución. No se incorpora autorización dinámica, administración de permisos ni catálogo PDGLD-55.

## Conflictos y decisiones

| Archivo conflictivo | Resolución |
| --- | --- |
| `src/server/auth/options.ts` | Conservar callbacks de develop: creación con bloqueo de usuario, actualización explícita validada por CSRF y representación numérica del vencimiento interno. El evento de cierre usa el almacén existente. |
| `src/server/auth/token.ts` | Mantener versión de cuenta y restricción inicial; delegar la validación a `persistent-session.ts` para tener una sola implementación. |
| `src/features/auth/components/session-activity.tsx` | Un solo monitor en el layout global. Sin sesión inicial no redirige; al perder una sesión conocida vuelve al login. Foco/visibilidad/recarga solo consultan; eventos reales visibles pueden renovar mediante el contrato de develop. |
| `tests/integration/auth.test.mjs` | Conservar todas las regresiones de develop. Los casos nuevos de Karol se integran en `session-lifecycle.test.mjs`, sin duplicar escenarios equivalentes. |

Se revisaron además los merges automáticos: se retiraron los montajes duplicados de `SessionActivity` en access/change-password, el almacén alternativo `session-store.ts`, la política duplicada `session-policy.ts` y el endpoint alternativo `/api/session/activity`. Sus comportamientos válidos se incorporaron a los helpers existentes; no se eliminaron indiscriminadamente archivos actuales/entrantes. La política pura de Karol y sus pruebas se reutilizan sobre `idle-policy.ts`.

El contrato de cuentas, su backend y `accounts.test.mjs` coinciden con develop. Se conservan el incremento de `users.version` y el bloqueo de fila durante cambio de contraseña, los intentos concurrentes, las sesiones independientes y la obligación de volver a iniciar sesión. Una prueba de baja se ajustó: el nuevo historial LOGIN_OK impide borrar usuarios por la FK existente; se sigue probando la retirada de sesión y se comprueba esa protección, sin borrar auditoría ni desactivar restricciones.

## Contrato de sesión y cierre

- `AUTH_IDLE_TIMEOUT_MINUTES` es un entero de 1 a 1440, predeterminado 30. El servidor evalúa tanto `expires_at` como última actividad + plazo vigente. Persiste la invalidación para que ampliar luego el plazo no reactive una sesión rechazada.
- JWT: `idleExpiresAt` es número de milisegundos desde epoch; `sid` es secreto estable dentro del JWT cifrado. PostgreSQL conserva únicamente su hash. La sesión pública expone UUID, cambio obligatorio y `expires` ISO, sin sid, hash, versión ni credenciales.
- Actividad: POST de NextAuth a `/api/auth/session` con token CSRF y `{ data: { action: "activity" } }`. Identidad, versión, fechas y permisos enviados por el cliente no son autoridad. GET, foco, visibilidad y recuperación de conexión no renuevan actividad. No hay heartbeat de actividad.
- `LOGIN_OK` se registra una sola vez al crear la sesión, en la misma transacción. `LOGOUT` se registra solo si la revocación condicional cambió una fila; cierres concurrentes/repetidos no lo duplican. Los eventos no contienen secretos.
- El wrapper de NextAuth captura un fallo de revocación y devuelve 503 `SIGNOUT_FAILED` sin reenviar las cookies de limpieza. Así se conserva la cookie y puede reintentarse.
- `SignOutButton` comprueba la respuesta antes de navegar y muestra error recuperable. No usa el comportamiento de redirección incondicional del cliente estándar de NextAuth 4. El helper se reutiliza al cambiar contraseña; allí la versión ya invalida las cookies aunque falle su limpieza, por lo que se conserva la navegación obligatoria a login.

## Verificación realizada

- `npm ls --depth=0`: dependencias instaladas coherentes. No se cambiaron versiones ni `package-lock.json`; package.json solo agrega la ejecución de las pruebas de política.
- `npm run test:auth`: 6 pruebas puras + 39 resultados HTTP, todos aprobados, sin omisiones. Incluye contraseña/cookies, concurrencia, cuentas, CSRF, actividad, sesiones independientes, fallo/reintento de revocación, fallo de auditoría y cambio efectivo de plazo a cinco minutos sin reactivación posterior.
- `npm run test:seed`: 19 resultados aprobados; rollback, idempotencia, integridad y guardas locales.
- `npm run test:ci`: 12 aprobados. TypeScript, lint, build, guardas de migraciones y comprobación de espacios completaron correctamente.
- Los primeros typechecks detectaron tipos generados de rutas de PDGLD-54 en las compilaciones locales previas. Se regeneraron las rutas para esta rama y se verificó de nuevo; no se incorporó su código ni se alteró tsconfig para ocultar errores.
- Pruebas únicamente en PostgreSQL 15 desechable con tmpfs, sin bases persistentes, Supabase o volúmenes del proyecto. El runner aplica `migrate deploy`; esquema, baseline y RLS permanecen intactos.

En navegador real se comprobó login anónimo estable, login operativo, cambio obligatorio visible, recarga sin renovación, clic confiable que actualiza fechas, expiración por temporizador y retorno a login, fallo de cierre visible con botón habilitado y cierre correcto al reintentar. Las fechas y el único LOGOUT se contrastaron en la base temporal. La expiración se adelantó exclusivamente en el fixture; no se esperaron treinta minutos reales. El cambio completo de contraseña se verificó por HTTP, no se introdujeron nuevas credenciales desde la UI. No se automatizó el cambio de foco entre aplicaciones nativas ni un recorrido completo entre navegadores distintos.

## Publicación y continuación

No se hizo push, merge remoto, aprobación, despliegue ni cambio en Jira. El merge local conserva ambos historiales. Antes de publicar, volver a comprobar la cabeza del PR y develop; quedan pendientes CI remoto (incluido PostgreSQL 17) y revisión del equipo.

Si hay permisos sobre la rama de origen del PR existente, publicar explícitamente desde la rama local de resolución hacia ella, sin force:

```powershell
git fetch origin
git push origin fix/PDGLD-51-integrar-sesiones-develop:feat/PDGLD-51-cierre-expiracion-sesiones
```

Ese comando actualiza el PR #9 existente; no debe empujarse solo el nombre local `fix/...` esperando que lo actualice. Si la rama remota avanzó, integrar y verificar primero esos cambios; un rechazo de fast-forward no se resuelve con force. Si no hay permisos, Karol/un mantenedor debe aplicar el resultado en la rama de origen, o se necesitaría una alternativa de rama/fork y un PR acordado; aquí no se abrió ninguno.

Para volver al avance protegido, con árbol limpio:

```powershell
git switch backup/PDGLD-54-autorizacion-antes-integracion-51
```

Para continuar en otra rama conservando además el respaldo sin cambios:

```powershell
git switch -c feat/PDGLD-54-continuar-autorizacion backup/PDGLD-54-autorizacion-antes-integracion-51
```
