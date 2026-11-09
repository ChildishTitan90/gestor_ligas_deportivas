# PDGLD-119 — proveedor de pruebas y contrato del adaptador

Decisión técnica autorizada el 8 de noviembre de 2026: usar **Resend** como
proveedor inicial de pruebas. Su API HTTP y la cabecera de idempotencia permiten
reutilizar el contrato existente sin SDK ni nuevas dependencias. La elección inicial
del proveedor se validó primero con simulaciones y después con un único envío
real de pruebas; no acredita configuración de producción.

Referencias oficiales consultadas:
[enviar correo](https://resend.com/docs/api-reference/emails/send-email),
[idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys),
[errores](https://resend.com/docs/api-reference/errors) y
[direcciones de prueba](https://resend.com/docs/dashboard/emails/send-test-emails).
Las claves de idempotencia del proveedor tienen una ventana de 24 horas; no
sustituyen la revisión/operación persistente del servicio ni autorizan reenvíos.
Las direcciones de simulación del proveedor no prueban recepción en un buzón.

## Configuración y privacidad

`getEmailTransport()` devuelve null salvo que estén completos:

- `ACCOUNT_EMAIL_ENABLED=true` y `ACCOUNT_EMAIL_PROVIDER=resend`.
- `RESEND_API_KEY`: secreto privado del servidor, con permiso de envío limitado.
- `ACCOUNT_EMAIL_FROM`: dirección del remitente verificado, sin cabeceras extra.
- `NEXTAUTH_URL`: origen HTTPS público, sin usuario, ruta ni parámetros.

`.env.example` contiene solo marcadores y deja la activación en false. La
configuración original no se modificó; para la prueba real se usó exclusivamente
el `.env.local` de la copia desechable y después se retiraron sus secretos. La falta de configuración conserva NOT_CONFIGURED y el reset
no modifica cuenta, sesiones, tokens ni auditoría. No hay un transporte falso
disponible como alternativa de producción.

El adaptador recibe el destino vigente ya autorizado por el servicio. Usa POST
al endpoint fijo `https://api.resend.com/emails`, texto plano, sin redirecciones
ni caché y un plazo de diez segundos. No acepta endpoint ni remitente del
navegador. La credencial viaja solo en memoria/cuerpo del correo; el enlace de
confirmación conserva el token en el fragmento, no en query ni URL del servidor.
No registra cuerpos, respuestas del proveedor, claves o excepciones originales.

Una respuesta satisfactoria con id acredita ACCEPTED, nunca recepción. Rechazos
explícitos 400/401/403/404/405/413/422 producen FAILED. Timeout, red, respuestas
ambiguas, 408/409/429 y 5xx producen UNKNOWN. No hay reintentos automáticos;
recuperación y eventual nueva emisión conservan el flujo de revisión existente.

## Evidencia simulada y envío real de pruebas

Las pruebas del adaptador inyectan fetch sintético. El recorrido integrado de
restablecimiento ejecuta el adaptador real con fetch redirigido exclusivamente
a un servidor loopback de la copia desechable; ese servidor devuelve respuestas
con el formato Resend. En esas matrices ninguna petición sale al proveedor. Se ejercitan
aceptación, rechazo, incertidumbre, idempotencia y ausencia de doble envío.

Posteriormente se ejecutó un solo restablecimiento real desde una base/cuenta
sintéticas, con `onboarding@resend.dev`. Ese remitente de pruebas está limitado
al correo exacto de la cuenta Resend, confirmado por el responsable junto con
el control del buzón. Resend respondió HTTP 200 / ACCEPTED y el usuario confirmó
la recepción en Hotmail. No hubo reintentos; el envío se deshabilitó y la limpieza
se verificó. El agente no abrió ese buzón ni publica su dirección o contenido.

Esta excepción de prueba no cambia el remitente predeterminado de producción ni
acredita dominio propio, DNS, credenciales o entorno productivos. La configuración
con dominio propio en producción sigue **sin validar**. Véanse el
[informe consolidado](../validation/pdgld119-single-email-preparation.md) y la
[evidencia saneada](../validation/pdgld119-real-email-results.json).

## Preparación de la prueba única

El procedimiento humano, con variables exactas, base/cuenta sintéticas y
aceptación separada de recepción, está en
[un único correo de prueba](../operations/pdgld119-single-test-email.md).
No hay variable para reemplazar el destinatario: el restablecimiento usa solo
el correo vigente verificado. La invariancia completa ante NOT_CONFIGURED se
refiere al restablecimiento; solicitar un cambio de correo puede conservar una
intención pendiente aun sin transporte, conforme a su contrato propio.
