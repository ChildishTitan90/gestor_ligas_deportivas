# PDGLD-32 — aceptación alternativa en Mac mediante HTTPS local

21 de noviembre de 2026. Esta continuación usa únicamente la copia recuperada y la rama del PR #64. No usa Vercel, Supabase ni las bases habituales. El equipo debe aceptar explícitamente este entorno alternativo como evidencia: no acredita configuración ni aceptación de un despliegue.

## Entorno y política

`scripts/password-recovery-local.mjs` crea PostgreSQL 17 en un contenedor propio, sin volúmenes, con datos en tmpfs y puerto 55417 publicado únicamente en 127.0.0.1. Aplica las 51 migraciones, prepara RLS y provisión idempotente; entrega al backend únicamente `gestor_ligas_preview`, sin conexión propietaria. Conserva las ACL de recuperación y préstamos de cancha. La cuenta inicial es sintética y sin permisos de gestión; se puede comprobar su sesión en `/api/access`.

Origen de la aplicación: `https://127.0.0.1:34432`. Next.js corre en desarrollo y escucha únicamente en loopback. Se reutiliza el modo `local`, que ignora cabeceras IP; no se simulan cabeceras ni variables de Vercel. La regresión de política comprueba que este modo se rechaza en producción, en un origen público o si VERCEL=1.

Se aplica al entorno local la política numérica aprobada por la persona usuaria: TTL 15 minutos; 3 solicitudes por destinatario/cuenta por hora; ventana pública de 60 segundos; 5 solicitudes y 10 confirmaciones por origen local; 50 solicitudes y 100 confirmaciones globales por ventana. En modo local todos los clientes comparten la cuota de origen. El secreto del limitador y el de NextAuth son privados, aleatorios y distintos. Las ventanas públicas siguen siendo fijas; no se altera su semántica.

## Archivos privados e intervención necesaria

`prepare` guarda exclusivamente en `.env-recovery-local/` (ignorada por Git, permiso 0700): estado/credenciales de PostgreSQL, cuenta inicial, claves y certificados. Los secretos y claves tienen permiso 0600. Nunca añadir esa carpeta al índice ni adjuntar sus contenidos a evidencia.

1. Completar `.env-recovery-local/secrets.env` **en un editor local**, sin pegar valores en chat:
   - `RESEND_API_KEY`: clave privada existente de Resend.
   - `ACCOUNT_EMAIL_FROM`: remitente autorizado por esa cuenta/proveedor.
   - `RECOVERY_TEST_EMAIL`: buzón que controla la persona revisora.
   - `RECOVERY_MAILBOX_CONTROLLED=true`: confirmación de ese control.
2. No se encontró configuración privada de Resend en la copia ni en las variables del proceso. La entrega histórica de PDGLD-119 no conserva una clave utilizable y no sustituye este envío. Si se usa el remitente de pruebas de Resend, respetar que solo admite destinatarios autorizados por el proveedor; no asumir otro remitente o dominio verificado.
3. Importar `ca.pem` en el llavero de inicio de sesión y confiar manualmente para SSL en la CA **PDGLD-32 Local Test CA**, válida siete días. Su clave solo se guarda en la carpeta privada. Retirar esa confianza al terminar. No deshabilitar TLS ni usar flags para omitir errores del certificado. La comprobación con CA explícita de Node no sustituye la confianza del navegador.
4. La contraseña inicial solo se consulta localmente en `.env-recovery-local/account.txt`. Al cambiarla mediante Computer Use, la persona usuaria introduce, confirma y envía la nueva contraseña; la política de esa herramienta exige entregar el control para cambios de credenciales.

## Comandos desde la copia recuperada

- `npm run recovery:local -- prepare`: crea el entorno una vez; no envía correo.
- `npm run recovery:local -- serve`: levanta HTTPS con correo y recuperación apagados mientras se completa la configuración. No acredita el recorrido real.
- Detener ese servidor con Ctrl+C antes de `npm run recovery:local -- start`.
- `npm run recovery:local -- start`: exige configuración válida y control del buzón, actualiza únicamente el email verificado del fixture y activa Resend/recuperación en ese proceso. No envía hasta solicitar un enlace. No imprime logs de peticiones ni secretos.
- `npm run recovery:local -- status`: expone solo contadores saneados (migraciones, solicitudes, sesiones no revocadas y cambios de contraseña).
- Tras detener el servidor con Ctrl+C, `npm run recovery:local -- stop` elimina únicamente el contenedor registrado. Retirar además la confianza de la CA; conservar o retirar los archivos privados mediante el canal seguro del usuario. No ejecutar otra preparación mientras quede un entorno registrado.

El aislamiento se comprueba por ID, nombre, etiqueta aleatoria, montajes y mapeo exacto de puerto antes de acceder. Si el puerto está ocupado o una identidad no coincide, se detiene sin adoptar recursos ajenos. No usar `compose down`, reset o clean.

## Recorrido pendiente con navegador y buzón reales

1. Verificar que Chrome acepta HTTPS sin intersticial. Iniciar sesión con la cuenta sintética y mantener esa sesión previa.
2. Desde login solicitar un enlace para el buzón controlado; comprobar recepción en entrada/spam, asunto y hora sin copiar token, enlace completo ni destinatario en evidencias. ACCEPTED no prueba recepción.
3. Abrir el enlace recibido y cambiar contraseña con intervención de la persona usuaria. Antes de iniciar sesión de nuevo, consultar `/api/access` con la sesión previa: debe denegar el acceso. Comprobar que la contraseña anterior falla y la nueva permite entrar.
4. Reabrir el enlace recibido: otro cambio debe rechazarse. No guardar URLs sensibles en capturas o en la descripción del PR.
5. Verificar vencimiento, manipulación, respuesta pública equivalente y cuotas. Los casos del proveedor FAILED/UNKNOWN y concurrencia se ejecutan con transporte simulado; no provocar envíos masivos reales. La suite existente comprueba vencimiento/uso único/rollback, fallos del proveedor, cuotas y equivalencia con Request/Response y PostgreSQL real sintético; no presentarla como prueba de navegador.
6. Registrar por separado qué se observó en navegador, qué confirmó la persona en el buzón y qué cubrieron las suites automatizadas. El equipo debe aceptar esta evidencia local alternativa antes de cerrar la historia.

No se cierra Jira ni se hace merge del PR automáticamente. La recuperación conserva su valor deshabilitado por defecto y no se modifican entornos productivos.
