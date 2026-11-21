# PDGLD-32 — configuración y aceptación de Preview (PR #64)

20 de noviembre de 2026, hora de Morelia. Política **aprobada por Nickte en esta sesión**, exclusivamente para Preview. No es una política aprobada para producción. Reutilizar Resend, el servicio de recuperación y la provisión existentes; no crear otro proveedor ni habilitar producción.

## Destino y acceso

- Repositorio/PR: [ChildishTitan90/gestor_ligas_deportivas #64](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/64).
- Rama: `fix/PDGLD-32-politica-abuso`.
- Proyecto Supabase de pruebas confirmado por la documentación: `loaztwwpwsaqzdtdtvvj`. No inferir otro proyecto desde una credencial.
- Proyecto Vercel: `gestor-ligas-deportivas`, equipo `victor-hernandezs-projects-05a3dba9`.
- [Variables de entorno](https://vercel.com/victor-hernandezs-projects-05a3dba9/gestor-ligas-deportivas/settings/environment-variables): seleccionar **Preview** y restringir las variables de esta aceptación a la rama del PR. No seleccionar Production ni modificar los valores productivos.
- Origen candidato publicado por el bot del PR: `https://gestor-ligas-dep-git-ac9323-victor-hernandezs-projects-05a3dba9.vercel.app`. Confirmar el alias de la rama y el SHA de despliegue tras cada publicación. No usar un despliegue anterior como aceptación del último commit.

**Bloqueo comprobado:** la cuenta de Vercel conectada obtuvo 404 en la configuración del proyecto y “You Need Access” al abrir `/recover-password` del Preview protegido. No se solicitó acceso en nombre del usuario ni se eludió Deployment Protection. El propietario debe conceder a la persona revisora acceso al proyecto/Preview, o realizar la configuración desde su cuenta autorizada. No retirar la protección del despliegue para esta prueba.

En la copia recuperada faltan `PREVIEW_OWNER_URL`, `PREVIEW_CA_CERT_PATH`, `DATABASE_URL`, `DIRECT_URL`, `DATABASE_CA_CERT`, `RESEND_API_KEY`, remitente y origen HTTPS. No hay `.env`, `.env.local`, `.env.preview` ni enlace `.vercel/project.json`. No se ha configurado ni validado el entorno remoto en esta continuación. No pegar secretos en chat, PR, Jira ni comandos con valores literales.

## Política aprobada para Preview

| Variable | Valor |
| --- | --- |
| `PASSWORD_RECOVERY_TTL_MINUTES` | `15` |
| `PASSWORD_RECOVERY_MAX_PER_HOUR` | `3` |
| `PASSWORD_RECOVERY_RATE_WINDOW_SECONDS` | `60` |
| `PASSWORD_RECOVERY_REQUESTS_PER_IP` | `5` |
| `PASSWORD_RECOVERY_COMPLETIONS_PER_IP` | `10` |
| `PASSWORD_RECOVERY_REQUESTS_GLOBAL` | `50` |
| `PASSWORD_RECOVERY_COMPLETIONS_GLOBAL` | `100` |
| `PASSWORD_RECOVERY_CLIENT_IP_MODE` | `vercel` |
| `PASSWORD_RECOVERY_RATE_SECRET` | Secreto privado aleatorio de al menos 32 caracteres; generarlo en el gestor de secretos e introducirlo como variable sensible de Preview. No reutilizar NEXTAUTH_SECRET. |
| `PASSWORD_RECOVERY_ENABLED` | Mantener `false` durante preparación; pasar a `true` solo después de migraciones, permisos y transporte completos. |

`VERCEL=1` lo proporciona la plataforma; no simularlo para habilitar un entorno ajeno. Solo se acepta `x-vercel-forwarded-for`; IPv6 se agrupa por /64. Las ventanas públicas son fijas y pueden admitir tráfico de dos ventanas junto a su frontera. El límite por destinatario cuenta solicitudes existentes/inexistentes y rechazos, y la emisión por cuenta mantiene su límite horario. Una solicitud adicional no invalida un enlace vigente; FAILED invalida únicamente el enlace rechazado y permite otra solicitud dentro de la cuota; UNKNOWN lo conserva.

## Preparación por la persona con acceso

1. En Supabase de **pruebas**, obtener la CA y la conexión propietaria mediante el canal privado del equipo. Inyectar `PREVIEW_OWNER_URL` y `PREVIEW_CA_CERT_PATH` solo en el proceso local; la CA debe pertenecer al proyecto confirmado y estar vigente. La herramienta no carga `.env` ni reutiliza credenciales de producción.
2. Desde la copia recuperada ejecutar `npm run preview:maintain -- check`. Verifica destino, TLS, marcador de pruebas, historial/checksums, RLS y exposición de roles API. Si detecta una migración fuera de orden o cambios inesperados, conservar el estado y revisar el historial; no usar resolve, reset, db push ni editar migraciones para eludirlo.
3. Tras revisar pendientes/respaldo: `npm run preview:maintain -- migrate --apply loaztwwpwsaqzdtdtvvj`; después `npm run preview:maintain -- provision --apply loaztwwpwsaqzdtdtvvj`; repetir `check`. El plan no configura LOGIN/contraseña del rol. El administrador conserva ese secreto en su canal privado.
4. Configurar **solo el runtime Preview de esta rama** con `DATABASE_URL` del rol `gestor_ligas_preview` del proyecto de pruebas y `DATABASE_CA_CERT` (PEM, TLS estricto). Nunca poner la conexión propietaria en DATABASE_URL. Mantener NEXTAUTH_SECRET privado y la configuración de sesión existente. Confirmar el rol efectivo de la conexión y que no omite RLS. No conceder BYPASSRLS, propiedad, ALL PRIVILEGES ni acceso al ledger.
5. Verificar ACL de `password_resets`: SELECT por columnas, INSERT de id/user_id/token_hash/created_at/expires_at y UPDATE únicamente de used_at; sin DELETE ni reescritura de hash. `password_recovery_budgets` permite SELECT/INSERT y UPDATE(window_start,hits), y DELETE para limpieza. Conservar todos los permisos de `venue_loans`, incluida decisión del propietario, `home_venue_assignments`, `matches` e historial aportados por develop. La provisión integrada y sus regresiones mantienen ambos conjuntos.
6. En las mismas variables de Vercel configurar `ACCOUNT_EMAIL_PROVIDER=resend`, `ACCOUNT_EMAIL_FROM` con el remitente ya verificado y `RESEND_API_KEY` sensible del proveedor existente. `NEXTAUTH_URL` debe ser el origen HTTPS estable de la rama, sin ruta, credenciales, parámetros ni fragmento. No inventar un remitente: el dominio verificado y el acceso actual al proveedor no pudieron comprobarse. El antecedente de `onboarding@resend.dev` es una prueba histórica de PDGLD-119, no autorización ni evidencia de configuración actual.
7. Designar una cuenta **sintética, activa y con correo vigente verificado** en esa base, con buzón controlado por la persona autorizada. No reutilizar una cuenta real ni modificar datos productivos. El código no admite un destinatario alternativo por variable: usa users.email. No se ha designado ni acreditado un buzón para esta aceptación.
8. Activar `ACCOUNT_EMAIL_ENABLED=true` y, solo con todos los requisitos anteriores, `PASSWORD_RECOVERY_ENABLED=true` en Preview de esta rama. Redesplegar y comprobar el SHA exacto del PR. No activar ninguna variable en Production. No se comprobó el estado remoto de producción; esta continuación no lo modificó y conserva el valor deshabilitado por defecto del código y del ejemplo.

## Aceptación pendiente en navegador y buzón controlado

Registrar entorno, SHA desplegado, hora, responsable y resultado por fila, sin contraseñas, cookies, tokens, fragmentos URL ni correos completos en evidencias. Un ACCEPTED de Resend no demuestra recepción. No utilizar la prueba histórica de localhost o PDGLD-119 como aceptación de esta versión.

| Comprobación en Preview | Estado de esta continuación |
| --- | --- |
| Inicio desde login y recepción efectiva en entrada/spam del buzón controlado | Bloqueada por acceso/configuración; no ejecutada |
| Cambio mediante enlace recibido y acceso con contraseña nueva | No ejecutada |
| Contraseña anterior rechazada y sesión previa sin acceso a operación protegida | No ejecutada |
| Enlace consumido, vencido y manipulado rechazados sin cambios | No ejecutada |
| Cuentas existente/inexistente con mismo código HTTP, cuerpo y mensaje público | No ejecutada en Preview; cubierta automáticamente con Request/Response y BD sintética |
| Límites por IP/global/destinatario, sin envíos masivos | No ejecutada en Preview; cubierta con transporte simulado |
| FAILED permite nueva solicitud dentro de cuota; UNKNOWN conserva enlace | Cubierta automáticamente; no se provocarán fallos ni envíos masivos al proveedor real |

Para el caso vencido, esperar los 15 minutos aprobados o preparar un fixture vencido únicamente mediante el responsable de la base de pruebas, sin cambiar silenciosamente la política desplegada. Conservar una sesión previa antes del cambio y comprobar una operación protegida después. Para la prueba real, mantener los intentos mínimos y seriales; las matrices de concurrencia/fallos del proveedor se ejecutan con transporte simulado.

Si el recorrido se opera mediante Computer Use, la persona usuaria debe introducir y enviar la nueva contraseña: la política de esa herramienta exige entregar el control para cambiar credenciales. El agente puede preparar el formulario y verificar los resultados posteriores, sin registrar la contraseña.

## Regresión automatizada reproducible

`npm run test:password-recovery-isolated` reutiliza `tests/integration/password-recovery.test.ts` sobre PostgreSQL 15 y 17 propios, en loopback 55415/55417 y tmpfs, con RLS y rol limitado. No usa compose, .env, correo real ni bases existentes. Si un puerto está ocupado, falla sin tocar su ocupante. Aplica migraciones originales, instala dos veces la provisión existente y elimina únicamente el contenedor creado. El comando de integración del CI se conserva.

La suite mantiene la prueba de rollback de auditoría publicada en c650a6c y el control concurrente de consumo. `npm run test:seed` mantiene el arreglo del mismo commit para tablas con clave bucket_key, conservación de cuotas, atomicidad e idempotencia. La evidencia de resultados de esta continuación se registra en `docs/validation/pdgld32-public-recovery-review.md`.

## Cambio de destino de esta continuación — 21/11/2026

La persona usuaria indicó continuar **sin Vercel** y autorizó un entorno alternativo HTTPS local en su Mac. Este documento conserva el procedimiento preparado anteriormente; no acredita configuración aplicada. La ejecución vigente y las intervenciones privadas necesarias están en [aceptación local](pdgld32-local-acceptance.md). No se retomará Vercel en esta fase.
