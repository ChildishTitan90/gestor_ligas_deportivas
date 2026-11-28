# PDGLD-33 · Contrato de verificación en dos pasos

Política de implementación confirmada por Nickte el 28/11/2026. La aceptación de la Liga se registra por separado.
Rama: `feat/PDGLD-33-verificacion-dos-pasos`, base `60dfa29` de `origin/develop`.

## Fuentes y autoridad

- [PDGLD-33](https://victoranhernandez.atlassian.net/browse/PDGLD-33): tres roles elegibles, sesión incompleta y recuperación; método, obligatoriedad, recuperación, intentos y revocación requieren acuerdo explícito.
- [PDGLD-168](https://victoranhernandez.atlassian.net/browse/PDGLD-168): contrato y vistas; [PDGLD-169](https://victoranhernandez.atlassian.net/browse/PDGLD-169): persistencia y flujo; [PDGLD-170](https://victoranhernandez.atlassian.net/browse/PDGLD-170): integración y aceptación. Los cuatro tickets no tenían comentarios al consultarlos.
- Jira exige coordinar sesiones/permisos y migraciones compartidas con Víctor antes de modificarlos. Víctor confirmó que puede avanzar autenticación mientras trabaja en tesorería. Se revisó su PR #74: ambos cambios tocan esquema, navegación, el plan de permisos Preview y CI. El alcance de sus índices de cargos, navegación de Tesorería y migración es independiente de MFA.
- [PR #43](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/43): mantenimiento, identidad privada, versiones y revocación; [PR #46](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/46): transporte de correo. Ambos integrados según GitHub; sus textos históricos sobre borrador no describen su estado actual.
- [PR #61](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/61) y [PR #64](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/64): recuperación de contraseña, consumo único, revocación y cuotas. Integrados. Los comentarios generales consultados no aportan un acuerdo de MFA.
- [Autenticación](authentication.md), [autorización](authorization.md), [recuperación](password-recovery.md). El acuerdo de contraseña y bloqueo existente no aprueba por sí mismo una política de segundo factor.

## Política confirmada

| Tema | Regla | Aplicación |
| --- | --- | --- |
| Método | TOTP de aplicación autenticadora; 6 dígitos, intervalo 30 s, tolerancia ±1 intervalo, sin reutilización de un intervalo aceptado | TOTP SHA-1 según RFC 6238, probado con vectores oficiales |
| Elegibilidad | Opcional para SUPERADMIN, EXECUTIVE_PRESIDENT y DISCIPLINARY_BOARD; solo cuenta propia | Opcional y limitado a configuración propia |
| Recuperación | Diez códigos aleatorios de un uso, mostrados una vez; solo hashes persistidos | Acceso restringido al reemplazo del autenticador |
| Pérdida total | Sin acceso automático si se pierden factor y códigos; procedimiento humano todavía por acordar | Debe explicarse antes de activar; no atribuir un procedimiento administrativo inexistente |
| Intentos | Cinco fallos de segundo paso bloquean 15 min; contador por cuenta compartido entre desafíos | El bloqueo sobrevive a nuevos desafíos |
| Pendientes | Desafío y enrolamiento caducan a los 10 min; no renovar ese plazo por actividad | El enrolamiento incompleto conserva el login vigente |
| Cambiar/desactivar | Contraseña actual y TOTP o código de recuperación; confirmar factor nuevo antes de sustituir el activo | El factor anterior se conserva hasta confirmar el nuevo |
| Revocar | Activar, sustituir, desactivar o recuperar revoca todas las sesiones y exige nuevo login | Revocación, versión y auditoría en la misma transacción |

El acuerdo autoriza la implementación. El procedimiento humano si se pierden el autenticador y todos los códigos sigue pendiente del equipo.

## Integración comprobada en el código actual

`src/server/auth/options.ts` conserva Credentials de NextAuth 4, CSRF, JWT cifrado y sesión pública mínima. `credentials.ts` valida contraseña y serializa por usuario; `persistent-session.ts` crea sesión y LOGIN_OK en una transacción. `token.ts` revalida sesión persistente en cada lectura. `session.ts` separa identidad autenticada de operativa. `request-identity.ts` obtiene identidad privada de cookie, ignora Authorization y se usa también en escrituras: deberá impedir operaciones de cuenta desde un desafío pendiente.

El baseline contenía `users.encrypted_mfa_secret`, pero no confirma estado de enrolamiento, prevención de repetición ni desafío pendiente. `sessions` no tiene estado de segundo factor. La presencia de una columna no acredita MFA implementado. No reutilizar consultas generales de cuentas para leer el secreto ni modificar `0_init`.

`authentication_events` es inmutable y su conjunto de acciones está restringido por SQL. Definir eventos MFA y revisar el trigger de auditoría de usuarios antes de ampliar acciones: nunca registrar secreto, URI de enrolamiento, códigos, contraseña o payload completo. Revisar también las proyecciones de bitácora integradas por PDGLD-91.

## Estados y autoridad previstos

| Estado | Permitido | Prohibido |
| --- | --- | --- |
| Sin factor | Login actual; iniciar configuración propia si es elegible | Configurar cuenta ajena |
| Configuración pendiente | Consultar estado propio, confirmar o cancelar; login actual sin cambio | Mostrar factor activo o bloquear cuenta por iniciar alta |
| Factor activo | Configuración propia y cambio/desactivación con nueva prueba | Obtener sesión operativa solo con contraseña |
| Sesión pendiente | Verificar desafío propio o cerrar sesión | Gestión, API operativa, cambio de contraseña/correo y reset desde esa sesión |
| Desafío vencido/revocado | Volver a login | Renovarlo mediante actividad o payload update de NextAuth |
| Cambio pendiente | Confirmar factor nuevo; mantener el anterior hasta commit | Sustituir secreto antes de confirmación |

La elegibilidad se consulta en servidor con asignaciones vigentes, no desde roles enviados por navegador o copiados al JWT. La configuración pertenece exclusivamente al actor autenticado: no aceptar userId como autoridad. Si dejan de estar vigentes los roles elegibles, se conserva el factor activo y se permite verificarlo. El servicio deniega configurar, reemplazar o desactivar el factor mientras no haya un rol elegible.

## Entradas y respuestas

La configuración propia está en /account/security, el desafío en /two-factor, y las operaciones en POST /api/auth/two-factor. El campo action selecciona la operación. La identidad se deriva únicamente de la sesión validada.

| Operación | Entrada mínima | Respuesta segura / efecto |
| --- | --- | --- |
| Consultar propia | Identidad servidor | Estado, revisión, plazo pendiente y cantidad de códigos; ningún secreto activo |
| Iniciar alta/cambio | Contraseña y prueba actual si aplica; revisión esperada | Identificador opaco y material de enrolamiento solo de la operación propia; respuesta no cacheable |
| Confirmar alta/cambio | Operación, revisión, código | Acuse confirmado y códigos de recuperación de una entrega; commit atómico con revocación |
| Cancelar pendiente | Operación y revisión | Acuse sin alterar factor activo |
| Verificar login | Sesión pendiente derivada de cookie, código y método de prueba | Sesión verificada o error controlado; no aceptar verified=true del cliente |
| Desactivar | Contraseña, prueba, revisión | Acuse, revocación y nuevo login |
| Recuperar | Contraseña ya probada en desafío y código de recuperación | Consume el código y abre una sesión restringida. Confirmar el TOTP nuevo reemplaza el factor, entrega diez códigos nuevos y revoca todas las sesiones. |

Errores previstos: no autenticado (401), segundo paso pendiente o acceso denegado (403), entrada/código inválido (400), revisión obsoleta u operación consumida (409), intentos agotados (429 con plazo seguro), servicio no disponible (503). No revelar existencia de otra cuenta ni detalles criptográficos. Las escrituras propias conservan comprobación de Origin, JSON limitado y no-store; no heredan automáticamente CSRF de NextAuth.

Si se abandona la recuperación o caduca, el factor anterior se conserva y el código permanece consumido. La interfaz muestra esa consecuencia antes de iniciar la operación. Con una recuperación completa, incluso tras usar el último código, el usuario vuelve a entrar con su contraseña y el TOTP nuevo.

Bloquear por cuenta antes de estado MFA/códigos; coordinar el orden con el bloqueo de sesiones existente para evitar interbloqueos. Consumir código, actualizar versión/estado, revocar y auditar en la misma transacción. Dos confirmaciones o recuperaciones concurrentes tienen un solo ganador. Una respuesta perdida no permite repetir emisión ni reconstruir códigos en claro: ofrecer consulta del estado oficial y recuperación explícita del flujo.

## Vistas previstas

Configuración dentro de ManagementShell, con navegación calculada en servidor. Desafío fuera del shell operativo, con ThemeSelector y salida compartida donde corresponda. Reutilizar FormDialog para confirmaciones breves; SelectField solo si hay una elección real entre TOTP y recuperación. Conservar los campos cerrados y los tokens actuales.

Mostrar claramente «Pendiente de confirmar», «Activo» y «Falta verificar tu acceso». Diferenciar envío, error, bloqueo, caducidad, resultado incierto y acuse oficial. No guardar material de enrolamiento ni códigos en localStorage/IndexedDB. Advertir pérdida total antes de activar y pedir conservar códigos antes de abandonar su única entrega. Revisar foco tras error/acuse, Escape, retorno de foco, teclado, móvil, claro/oscuro y acceso directo denegado con navegador real.

## Plan de persistencia por coordinar

Migración aditiva: tablas privadas mfa_factors y mfa_recovery_codes, y estado y plazo en sessions. La clave MFA_ENCRYPTION_KEY es exclusiva del backend y contiene 32 bytes aleatorios en hexadecimal. Debe conservarse estable en cada ambiente. El formato v1 permite versionar una rotación futura; cambiar la clave sin migrar los secretos impide verificarlos.

Preparar permisos explícitos de aplicación, plan Preview con RLS y plan de seguridad de producción conforme al pipeline. Probar migraciones con datos existentes en PostgreSQL desechable y rol limitado. No aplicar migraciones a la base habitual ni a Supabase como prueba.
