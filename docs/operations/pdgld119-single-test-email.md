# PDGLD-119 — procedimiento pendiente para un único correo de prueba

**El único intento autorizado ya se completó**: HTTP 200 / ACCEPTED y recepción confirmada por el usuario en Hotmail. No ejecutar otro envío para repetir evidencia. Este procedimiento documenta la preparación y sus límites; las matrices automatizadas usan transporte sintético. Véanse el [informe](../validation/pdgld119-single-email-preparation.md) y la [evidencia saneada](../validation/pdgld119-real-email-results.json). No ejecutar esta guía desde producción, Preview compartido, la base del compose original o el worktree del PR #45.

## Configuración exacta y lugar

Crear una copia desechable de la aplicación y una base local nueva, identificadas con un run-id nuevo. Usar PostgreSQL con datos sintéticos, puertos libres publicados solo en 127.0.0.1 y sin reutilizar volúmenes. Instalar las migraciones de esta rama en esa base; las entregas de cuentas/correo de esta rama todavía no están todas en develop. No usar reset, db push ni aplicar migraciones a una base existente para preparar esta prueba.

Guardar la configuración **solo en `.env.local` de esa copia desechable**, con acceso restringido, fuera de Git. Alternativamente usar el gestor privado de secretos de ese entorno de prueba. No introducir secretos en comandos, argumentos, capturas, logs, documentos o chat. No modificar el `.env` ni compose del repositorio original.

| Nombre exacto | Valor que debe configurar el responsable |
| --- | --- |
| `ACCOUNT_EMAIL_ENABLED` | `false` durante la preparación; `true` únicamente para la única operación autorizada. Volver a `false` y reiniciar después. |
| `ACCOUNT_EMAIL_PROVIDER` | `resend`. |
| `RESEND_API_KEY` | Clave de envío del entorno de pruebas, almacenada de forma privada y con permisos mínimos para el dominio utilizado. |
| `ACCOUNT_EMAIL_FROM` | Dirección completa de un remitente del dominio verificado en Resend, por ejemplo `ligas-pruebas@<dominio-controlado>`. Solo dirección, sin nombre visible ni cabeceras adicionales. El ejemplo no es un remitente configurado. |
| `NEXTAUTH_URL` | Origen HTTPS dedicado a la aplicación de pruebas, sin ruta, usuario, contraseña, query o fragmento. Por ejemplo `https://ligas-pruebas.<dominio-controlado>`. Debe resolver a esa aplicación aislada y ser accesible con certificado válido desde el navegador del responsable. No usar el origen de producción. |
| `DATABASE_URL`, `DIRECT_URL` | Conexión privada a la misma base sintética nueva en loopback. No copiar conexiones de Supabase, producción o una base compartida. |
| `NEXTAUTH_SECRET` | Secreto exclusivo de esa aplicación de pruebas; no reutilizar el de producción. |

El remitente **no está acreditado como verificado** por pasar la validación sintáctica del adaptador: el responsable debe comprobar la verificación DNS/dominio y el permiso de envío en Resend. No se consulta al proveedor para comprobar credenciales desde las pruebas automatizadas.

No existen `ACCOUNT_EMAIL_TO`, `RESEND_TEST_TO` ni otra variable de sustitución de destinatario. El buzón controlado debe ser el `sports_management.users.email` vigente de la cuenta sintética y contar con `email_verified_at`. No usar direcciones reservadas de simulación de Resend ni `example.test` para acreditar recepción real. No se ha designado un buzón real en esta entrega.

## Excepción autorizada para el remitente de pruebas

Para la prueba ya realizada, el usuario autorizó `ACCOUNT_EMAIL_FROM=onboarding@resend.dev`
y confirmó el correo exacto de su perfil de Resend y el control del buzón Hotmail.
Ese remitente solo admite como destino el correo asociado a la cuenta Resend,
según la [restricción oficial](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
No se infirió el destino desde otra cuenta conectada. Se actualizó exclusivamente
el fixture `pdgld48_idle`; no se introdujo un override de destinatario.
La ejecución real invocó el servicio de restablecimiento y el adaptador Resend
desde un proceso único, con bloqueo persistente y desactivación en finally.
No se afirma haber repetido el recorrido HTTP/Chrome con envío real.
Esta excepción no valida dominio propio ni modifica los requisitos de producción.

## Preparación sin enviar correo

1. Mantener el transporte deshabilitado. Verificar manualmente el nombre de la base, host loopback, puertos, ausencia de datos reales y que el origen no apunte a producción. No abrir conexiones a bases compartidas para inspeccionarlas.
2. Provisionar exclusivamente en la base nueva un operador sintético con permiso global efectivo `users UPDATE`, un administrador de respaldo y una cuenta sintética destinataria distinta del operador, activa, sin rol de administrador y sin otros usuarios reales. El alta no debe disparar correo. Usar el catálogo y fixtures existentes adaptados únicamente dentro de la copia aislada.
3. El responsable confirma por un canal externo a este envío que controla el buzón seleccionado. El fixture de esa base registra ese buzón como `users.email` y su `email_verified_at`; documentar que es una acreditación de fixture, no una confirmación del flujo de cambio de correo. **Nunca marcar como verificada una cuenta real o actualizar SQL en producción.** No usar cambio de correo para esta preparación: podría emitir confirmación y avisos adicionales.
4. Revisar el expediente de cuenta y anotar de forma privada su UUID, revisión vigente y el run-id. El destinatario no se introduce en el formulario de restablecimiento: el servicio lo obtiene de la fila bloqueada de la cuenta y exige canal verificado. Un correo pendiente no sustituye al vigente.
5. Opcionalmente comprobar, antes de habilitar transporte, un restablecimiento sobre esa cuenta: debe responder `503 NOT_CONFIGURED` y conservar cuenta, sesiones, tokens, solicitudes pendientes y auditoría. No genera correo. No confundir esta regla con solicitar un cambio de correo: ese otro flujo sí puede persistir una intención sin proveedor.

## Única operación de envío — solo tras autorización humana posterior

1. Confirmar configuración completa, control del buzón y ausencia de cualquier otro usuario/tráfico en esa aplicación. Habilitar `ACCOUNT_EMAIL_ENABLED=true` y reiniciar solo la copia de pruebas. No ejecutar scripts de matrices ni habilitar endpoints de fixture contra Resend.
2. Entrar como operador sintético, abrir `/accounts`, seleccionar la cuenta sintética por su identificador y revisar su correo vigente verificado y revisión. Abrir **restablecer acceso**, registrar la comprobación de identidad correspondiente al caso sintético y un motivo con el run-id. Confirmar **una sola vez**. No aportar un destino alternativo ni automatizar el clic.
3. Registrar únicamente `operationId`, revisión, fecha, expiración y `delivery` de la respuesta. El restablecimiento escribe la credencial temporal, revoca sesiones/tokens y anula cambios pendientes antes de contactar al proveedor. No revertir ni emitir otra credencial por un resultado FAILED/UNKNOWN.
4. Deshabilitar inmediatamente el transporte y reiniciar la copia. No repetir la operación con otra revisión, no reenviar desde Resend y no iniciar cambio de correo. Ante doble clic/revisión obsoleta, respuesta perdida o UNKNOWN, consultar el resultado y el panel de Resend; **no repetir el POST**. Esta prueba tiene un máximo de un intento, sin recuperación automática.

## Dos comprobaciones distintas

| Comprobación | Evidencia mínima privada | Estado actual |
| --- | --- | --- |
| Aceptación de Resend | `delivery=ACCEPTED` indica respuesta HTTP satisfactoria con id no vacío. Correlacionar operación/hora/destino con el evento del panel del proveedor; el adaptador no devuelve ni registra el id del proveedor. No copiar el cuerpo del mensaje ni la credencial. | Ejecutada: HTTP 200 / ACCEPTED en un único intento. |
| Recepción efectiva | El responsable abre el buzón controlado, revisa entrada y spam y confirma la llegada del único mensaje, con hora y asunto. Un evento delivered o ACCEPTED no sustituye esta comprobación. | Confirmada por el usuario en Hotmail; no leída por el agente. |

FAILED identifica un rechazo explícito; UNKNOWN incluye red, timeout, respuestas ambiguas y ciertos estados HTTP. Ambos se registran sin afirmar aceptación ni recepción. Si el correo llega pese a UNKNOWN, registrar esa recepción observada y conservar la aceptación como incierta hasta contrastar el proveedor; no cambiar retrospectivamente la respuesta del servicio.

La credencial temporal solo se consulta en privado desde el buzón, admite un uso y vence a los 30 minutos. Si se comprueba acceso, hacerlo únicamente en la aplicación aislada y completar el cambio obligatorio. No guardar la credencial ni tokens en evidencias, capturas o chat.

## Cierre

Registrar por separado aceptación y recepción, incluso si una queda pendiente. Conservar solo run-id, identificadores técnicos y resultados saneados. Retirar el secreto de la copia/gestor de pruebas y revocar la clave si se creó para este único ensayo. Detener la aplicación y eliminar únicamente los recursos propios identificados por el run-id, verificando ausencia de contenedor/red/puertos/perfiles y copias. No borrar compose, volúmenes, respaldos ni stashes originales.

## Bloqueos identificados en la preparación inicial

Inspección local del 8 de noviembre de 2026, sin mostrar valores: faltan `ACCOUNT_EMAIL_ENABLED`, `ACCOUNT_EMAIL_PROVIDER`, `RESEND_API_KEY` y `ACCOUNT_EMAIL_FROM`. Hay `NEXTAUTH_URL`, pero no cumple el formato de origen HTTPS requerido. No hay remitente/dominio verificado ni buzón controlado acreditados para esta prueba. Esa inspección es histórica: después se configuró únicamente la copia desechable para el intento ya completado y se retiraron sus secretos al limpiar. Los ejemplos no configuran producción ni autorizan nuevos envíos.

Fuentes oficiales contrastadas para la preparación: el remitente debe pertenecer a
un [dominio propio verificado](https://resend.com/docs/dashboard/domains/introduction);
el [contrato de envío](https://resend.com/docs/api-reference/emails/send-email)
devuelve un identificador de aceptación, y la
[idempotencia del proveedor](https://resend.com/docs/dashboard/emails/idempotency-keys)
conserva claves durante 24 horas. Esa ventana no autoriza repetir un
restablecimiento ni sustituye las revisiones y acuses del servicio.
