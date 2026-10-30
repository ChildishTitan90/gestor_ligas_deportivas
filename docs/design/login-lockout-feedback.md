# Aviso de bloqueo temporal de acceso

Ajuste solicitado durante la revisión de PDGLD-115, 29/10/2026.

El formulario distingue validación de campos, credenciales rechazadas, fallo del
servicio y bloqueo temporal real. Una contraseña incorrecta devuelve siempre
`CredentialsSignin`, incluido el intento que activa el bloqueo y los posteriores.
El aviso «Acceso bloqueado temporalmente» solo se devuelve después de verificar
la contraseña correcta de una cuenta activa bloqueada. Muestra los minutos restantes,
redondeados hacia arriba. No presenta un contador de intentos calculado por pestaña.

El servidor conserva `AUTH_MAX_FAILED_ATTEMPTS` y `AUTH_LOCKOUT_MINUTES`; el texto
refleja sus valores reales. `authorizeCredentials` devuelve un resultado interno
de bloqueo desde la transacción y lo convierte en el código público
`LOGIN_LOCKED_<intentos>_<minutos>` después de confirmar la escritura. Lanzar el
error dentro de la transacción revertiría el contador y los eventos de auditoría.

Este cambio hace explícito el estado de bloqueo en el contrato de login, que antes
devolvía `CredentialsSignin` también para ese estado. El código controlado no
incluye correo, identificadores, hash ni el mensaje de una excepción de base de
datos. Las cuentas ausentes/inactivas y credenciales inválidas mantienen rechazo
genérico. La interfaz solo interpreta el patrón y los límites numéricos previstos.

La revisión de seguridad del 30/10/2026 restringe el aviso a contraseñas verificadas:
no se revela el bloqueo por alcanzar cinco fallos. Se conserva la comprobación de
hash incluso durante el bloqueo, sin crear sesión ni reiniciar su plazo. El contador
y los eventos LOGIN_FAILED/BLOCK siguen confirmándose antes de devolver la respuesta.

Los intentos durante el bloqueo siguen sin ampliar `locked_until` ni generar otro
evento `BLOCK`. El servidor sigue siendo la autoridad aunque se recargue la página,
se cambie de dispositivo o se manipule la interfaz. No se impide editar los campos
ni se simula un desbloqueo con un temporizador del navegador.

Validación: `npm run test:login-feedback`, `npm run test:login-policy` y
`npm run test:auth`. Las pruebas HTTP cubren quinto fallo concurrente, bloqueo
vigente, vencimiento, política configurable y rollback si falla auditoría.

## Verificación realizada

Typecheck, lint y las dos pruebas de texto/contrato fueron correctos. La ejecución
de `test:auth` completó 42 pruebas del subproceso de autorización y 94 del proceso
HTTP, además de las pruebas de política de sesión y login. El quinto intento,
el bloqueo vigente y el plazo configurable se comprobaron contra PostgreSQL real
en la base desechable, sin cuentas locales habituales ni producción.

No se completó la comprobación visual del aviso: la herramienta del navegador
perdió el objetivo de entrada al escribir en el formulario, incluso tras abrir una
pestaña nueva. Esto no se registra como fallo de la aplicación ni como una prueba
visual superada. Se conserva la revisión manual del aviso en el login local.
