# PDGLD-32 · Recuperación de contraseña por correo

El login enlaza a la solicitud de recuperación. Una solicitud válida recibe
la misma respuesta pública antes de consultar la cuenta o contactar al
proveedor. Solo se considera el correo vigente verificado de una cuenta
activa. El transporte Resend existente envía el token en el fragmento de
una URL HTTPS configurada en el servidor. Abrir el enlace no cambia la cuenta.

Se guarda un hash separado por propósito en la tabla password_resets existente.
La emisión se serializa por cuenta y respeta el límite por hora configurado.
Una solicitud nueva no invalida un enlace todavía vigente. El consumo exige
confirmación explícita, cuenta activa y token vigente. Bajo el bloqueo de la
cuenta, el consumo, el cambio de contraseña, la revocación de sesiones y la
auditoría se completan juntos. Cambiar contraseña, correo verificado, estado
o ejecutar el reset administrativo invalida las recuperaciones previas.

La recuperación se mantiene deshabilitada por defecto. Antes de habilitarla,
registrar la política de caducidad y frecuencia, verificar en el entorno de destino los permisos sobre password_resets
y validar la
protección contra abuso en el punto de entrada público. El plan de Preview concede lectura e inserción por columna y permite
actualizar solo used_at, sin borrar solicitudes ni reescribir hashes.
Esto no aplica permisos en producción. Verificar con un buzón controlado
el recorrido desde login hasta el acceso con contraseña nueva; el acuse del
proveedor por sí solo no acredita recepción.

La suite `npm run test:password-recovery-integration` crea una base temporal
con RLS y un rol limitado. Usa un transporte simulado para comprobar que
solo se guarda el hash, que un enlace vencido no cambia la cuenta, que hay
un solo ganador al consumirlo en concurrencia, y que el cambio revoca la
sesión y registra el evento. No sustituye la verificación en navegador.

La transacción fija UTC localmente: el adaptador envía fechas sin offset,
y usar la zona de la sesión alteraría la caducidad y el límite por hora.
La suite usa America/Mexico_City para el rol de aplicación y comprueba que
la expiración guardada coincida con la del mensaje.

Verificación local: suite de integración aprobada en PostgreSQL 15.19 y
17.11 con bases temporales, RLS y transporte simulado. Pendiente verificar
las pantallas y la entrega a un buzón controlado en un entorno autorizado.


## Revisión de rechazo de envío y permisos compartidos

Un rechazo confirmado (`FAILED`) invalida únicamente la operación emitida,
bajo el bloqueo de la misma cuenta y sin modificar su hash ni borrar el registro.
La persona puede solicitar un enlace nuevo antes del vencimiento del anterior,
si aún no alcanzó el límite por hora. Los intentos rechazados también cuentan
para ese límite. No se reintenta automáticamente el envío.

`UNKNOWN` conserva la operación: una pérdida de respuesta no demuestra que el
proveedor haya rechazado el correo. `ACCEPTED` conserva el enlace hasta su consumo
o vencimiento. La respuesta pública sigue siendo el mismo 202 genérico y se
emite antes de consultar la cuenta o enviar; nunca informa existencia de cuenta
ni resultado del proveedor.

La regresión con rol limitado comprueba rechazo, nueva solicitud con token
distinto, consumo del nuevo enlace, rechazo del anterior, entrega incierta y
límite por hora. El plan Preview conserva conjuntamente la inserción de
`password_resets` y los permisos de `venue_loans` integrados en develop.


Validación de esta corrección (18/11/2026): integración PostgreSQL 15.19 y
17.11, 2/2 casos por versión con RLS y rol limitado; pruebas de política 2/2,
transporte simulado 7/7, controles de pipeline 91/91, tipado y lint aprobados.
No se contactó al proveedor real durante estas pruebas. La validación en
Preview continúa pendiente; no se aplicaron permisos ni cambios en producción.


## Corrección posterior al merge: política y abuso público

La activación exige TTL, frecuencia y todas las cuotas públicas explícitas.
No hay valores de producción implícitos: una configuración incompleta o una
fuente de IP no admitida deja la recuperación deshabilitada. El perfil de
las pruebas (15 minutos, 2 solicitudes/hora, ventana de 60 segundos) es una
fixture sintética, no una política aprobada para producción.

Antes de consultar cuentas, encolar trabajo o calcular una contraseña, se
consumen cuotas atómicas en PostgreSQL compartidas entre instancias: global,
origen y destinatario/token. Los intentos denegados de solicitud reciben el
mismo 202 y no encolan envíos. La confirmación responde 429 cuando agota su
cuota y conserva el formulario. Un fallo del almacén impide continuar.
Los contadores guardan HMAC con clave privada, nunca IP, correo o token en
claro; una limpieza acotada retira contadores antiguos. El límite de frecuencia
por destinatario cuenta también los intentos sin cuenta y los rechazados;
además se conserva el límite de emisión por cuenta ya existente.

Las cuotas usan ventanas fijas: pueden admitirse hasta dos ventanas de tráfico
junto a su frontera. El presupuesto global limita también el crecimiento de
claves frente a direcciones o destinatarios rotatorios. No sustituye una
protección de infraestructura frente a ataques volumétricos.

En Vercel solo se acepta `x-vercel-forwarded-for` y `VERCEL=1`; no se confía
en cabeceras alternativas. IPv6 se agrupa por /64. El modo `local` ignora
cabeceras de IP y comparte una cuota local: solo se permite en loopback,
fuera de producción y fuera de Vercel. Otros despliegues requieren integrar
una fuente confiable antes de habilitar la recuperación.
Fuente del contrato de cabecera: https://vercel.com/docs/headers/request-headers.

La migración nueva crea exclusivamente `password_recovery_budgets`. Preview
mantiene RLS y concede lectura, inserción y actualización de contadores;
la eliminación se limita a esa tabla auxiliar. No amplía la modificación de
`password_resets` ni los permisos de préstamos de cancha.

### Registro necesario antes de activar en el entorno de pruebas

Documentar entorno, responsable, fecha y valores elegidos para:

- `PASSWORD_RECOVERY_TTL_MINUTES` (1..60) y `PASSWORD_RECOVERY_MAX_PER_HOUR` (1..99).
- `PASSWORD_RECOVERY_RATE_WINDOW_SECONDS` (60..3600).
- `PASSWORD_RECOVERY_REQUESTS_PER_IP` y `PASSWORD_RECOVERY_COMPLETIONS_PER_IP`.
- `PASSWORD_RECOVERY_REQUESTS_GLOBAL` y `PASSWORD_RECOVERY_COMPLETIONS_GLOBAL`
  (1..10000 y no inferiores a sus respectivas cuotas por IP).
- `PASSWORD_RECOVERY_CLIENT_IP_MODE`; generar una clave privada aleatoria
  de al menos 32 caracteres para `PASSWORD_RECOVERY_RATE_SECRET` sin copiarla
  a evidencias ni al repositorio.

Aplicar las migraciones y el plan de permisos mediante el procedimiento del
entorno. Conservar `PASSWORD_RECOVERY_ENABLED=false` hasta completar esa
configuración y el transporte existente. Con un buzón controlado, repetir:
recepción, cambio, acceso con contraseña nueva, reutilización rechazada y
revocación de sesión previa. Comprobar además la cuota pública y que cuentas
existentes e inexistentes reciben la misma respuesta; adjuntar evidencia sin
claves ni enlaces de recuperación. No cerrar Jira únicamente por el merge.

### Evidencia de esta rama

Integración ejecutada en PostgreSQL 15.19 y 17.11: tres casos principales por
versión con RLS y rol limitado, incluido consumo concurrente, cuotas globales,
por origen y destinatario, limpieza, contrato público, rechazo de envío,
incertidumbre y revocación. El transporte es simulado. Los handlers se prueban
con Request/Response reales y la base limitada; esto no acredita un recorrido
Chrome ni entrega real de esta revisión en Preview. La habilitación y la
validación del entorno de destino siguen pendientes.
