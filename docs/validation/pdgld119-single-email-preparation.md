# PDGLD-119 — validación simulada y prueba real de correo único

8 de noviembre de 2026. Se continuó en `feat/PDGLD-117-correccion-identidad`,
HEAD `6600f72`, donde reside el adaptador local. Se revisaron status, diffs y
origin/develop (`26081d0`); no se hizo merge/rebase. No se modificó PR #45 ni
su worktree. No se cambiaron contratos, reglas ni lógica de producción.

## Cambios de esta continuación

- `src/server/email/resend.test.ts`: destinos y claves inválidos no llaman a fetch; configuración desactivada/proveedor ajeno no habilitan transporte; cobertura de rechazos 404/405/413 sin reintentos.
- `tests/e2e/account-administrative-reset-browser.mjs`: estado completo intacto y cero mensajes tanto con canal no verificado como sin transporte; comprobación explícita del correo vigente verificado frente a un correo distinto pendiente antes de la acción.
- `docs/architecture/resend-test-provider.md`: vínculo al procedimiento y distinción entre restablecimiento sin mutación y cambio de correo que puede conservar una intención pendiente.
- `docs/operations/pdgld119-single-test-email.md`: configuración exacta, aislamiento, cuenta/buzón sintéticos, máximo de un intento y aceptación separada de recepción.
- Este informe: resultados de esta continuación; no reemplaza resultados originales.

## Resultados exclusivamente simulados

`npm run test:email-transport`: 6/6. `npm run test:account-maintenance`: 28/28.
Lint dirigido de adaptador/pruebas y comprobación sintáctica MJS aprobados.

Matriz afectada: `node scripts/test-delegate-isolated.mjs --run-id b1190001-0000-4000-8000-000000000119 --account-administrative-reset --execute`.
Secuencia efectiva PG15 → limpieza verificada → PG17 → limpieza verificada;
puertos propios inspeccionados, solo loopback, sin compose ni bases compartidas.

| Versión | Servicio/HTTP/Chrome con fetch simulado | Tipado de la copia | Limpieza |
| --- | --- | --- | --- |
| PG15 | 19 comprobaciones aprobadas | Aprobado | Verificada |
| PG17 | 19 comprobaciones aprobadas | Aprobado | Verificada |

Ambas versiones usaron `resend-adapter-with-loopback-fetch`, proveedor sintético,
`realDelivery=false`. Se probaron permisos, último administrador, rollback,
concurrencia, uso único, expiración, FAILED/UNKNOWN, consulta sin replay,
correo vigente en vez del pendiente y auditoría sin credenciales.
En esta matriz simulada, los mensajes del fixture permanecieron en memoria de
la ejecución desechable; no se consultó Resend autenticado ni se enviaron correos
reales. La prueba real posterior se registra por separado a continuación.

Las comprobaciones NOT_CONFIGURED abarcan users, sesiones, tokens de recuperación,
cambios de correo pendientes y auditoría de la cuenta. La inmutabilidad se
refiere al restablecimiento: solicitar cambio de correo tiene su contrato propio.
El formulario de reset no admite un email alternativo. La cuenta debe tener
email_verified_at y el destinatario proviene del SELECT bloqueado del servidor.

## Prueba real única con remitente de pruebas

Ejecución `97be7231-a27f-431f-a73b-d021476cc5d7`, realizada el
9 de noviembre de 2026 a las 00:46:46 UTC (8 de noviembre, hora de Morelia).
Se reutilizó la copia desechable con PostgreSQL 17 exclusivo en tmpfs y puertos
solo loopback, con HTTPS comprobado mediante certificado dedicado. No se usó
producción, la base del compose original ni una base compartida.

El responsable confirmó expresamente el correo exacto de su perfil de Resend y
el control del buzón Hotmail. Esa misma dirección se registró como correo
vigente verificado únicamente en la cuenta sintética `pdgld48_idle`. Las demás
cuentas no cambiaron. No se publica aquí la dirección del destinatario.

El remitente fue **`onboarding@resend.dev`**, permitido exclusivamente para
pruebas dirigidas al correo de la propia cuenta Resend. Se ejecutó el servicio
real de restablecimiento con autorización sobre el fixture y el adaptador real
Resend, desde un proceso único con bloqueo persistente contra repetición.
Esta ejecución no constituye una nueva validación del formulario HTTP/Chrome;
esos recorridos permanecen acreditados por la matriz sintética anterior.

| Comprobación | Resultado y fuente |
| --- | --- |
| Intentos reales | **1**, una llamada al endpoint de envío; sin reintentos |
| Aceptación de Resend | **ACCEPTED**, respuesta HTTP **200**, registrada por el adaptador |
| Recepción efectiva | **Confirmada por el usuario en Hotmail**, en su mensaje posterior a la ejecución |
| Asunto recibido | «Restablecimiento de acceso — Liga Municipal» |
| Remitente recibido | `onboarding@resend.dev`, confirmado por el usuario |
| Envío al terminar | Desactivado en `finally`; `ACCOUNT_EMAIL_ENABLED=false` comprobado |
| Limpieza | Verificada: contenedor y red ausentes, tres puertos libres, copia/dependencias y archivos privados retirados |

La aceptación HTTP y la recepción son comprobaciones distintas. El acuse técnico
original registraba recepción todavía no verificada; la confirmación posterior
aportada por el usuario completa ese criterio. El agente no abrió el buzón
Hotmail ni afirma haber verificado su contenido por una API. No se atribuye una
hora de llegada que el usuario no proporcionó.

La limpieza finalizó el 9 de noviembre de 2026 a las 00:48:06 UTC. Se mantuvo
únicamente un `.env.local` sin credenciales con el flag de envío false.
No se reenviará este correo para obtener evidencia adicional. No se incluye
credencial temporal, clave, token, enlace de restablecimiento ni captura sin
ocultar datos sensibles.

La [evidencia saneada versionable](pdgld119-real-email-results.json) consolida
aceptación, recepción y limpieza con campos permitidos. Omite destinatario
completo, claves, credenciales, enlaces, conexiones y capturas. Los acuses
originales privados se conservan fuera del commit y no se sobrescriben.

## Límites de esta prueba

Fue una **prueba real con remitente de pruebas**, no una validación de la
configuración de producción. No se configuró ni validó dominio propio,
remitente de producción, DNS de ese dominio, credenciales/entorno productivos
ni entrega desde esa configuración. Esos criterios permanecen pendientes.
La recepción confirmada no autoriza desplegar, modificar reglas, cambiar Jira
ni dar por aprobados otros criterios del ticket.

## Conservación

Compose original en 5434, nueve stashes y el trabajo existente permanecen
intactos. PR #45 y su worktree no se modificaron. Los resultados técnicos
originales no se sobrescriben. Esta actualización es documental y no requiere
repetir pruebas o enviar correos.
El índice sigue vacío; sin commit, push, merge ni cambios en Jira.
