# Alta de cuentas — PDGLD-34 / PDGLD-52

Fecha de implementación: 16/10/2026. Rama: `feat/PDGLD-34-crear-cuentas`.

## Alcance y coordinación

Se implementa el servidor de [PDGLD-52](https://victoranhernandez.atlassian.net/browse/PDGLD-52), asignado a Sergio: provisión de cuentas propias, contexto inicial, autorización, auditoría y pruebas HTTP. [PDGLD-53](https://victoranhernandez.atlassian.net/browse/PDGLD-53), asignado a Nickte, conserva la interfaz. No se cambia su asignación ni el estado de Jira. La historia [HU22-01 / PDGLD-34](https://victoranhernandez.atlassian.net/browse/PDGLD-34) requiere integrar ambos trabajos y obtener revisión/aceptación.

No se crean identidades en Supabase Auth ni se añade autorregistro. No se cambian dependencias, esquema, baseline ni datos de Supabase. No se incorpora la matriz general de PDGLD-35: se aplica la regla explícita de este caso, solo SUPERADMIN global vigente.

Para usar el endpoint se requiere una cuenta SUPERADMIN existente, operativa y con concesión global vigente. No se elevan automáticamente las cuentas sintéticas de `seed:dev` ni se agrega una ruta pública para crear al primer administrador. El establecimiento inicial de esa autoridad corresponde al procedimiento autorizado de administración del entorno. Las pruebas crean su propio administrador sintético exclusivamente en la base temporal.

## Autorización y seguridad

- El servicio obtiene identidad desde NextAuth, sin aceptar actor ni rol autorizante del navegador. Una sesión anónima, vencida, revocada o con cambio obligatorio no permite el alta.
- Se consulta el SUPERADMIN vigente en `user_roles`: `starts_at <= ahora`, sin `ends_at` vencido y sin contexto de liga/club. Un SUPERADMIN guardado con alcance local no se interpreta como autoridad global.
- Se bloquean en lectura compartida la cuenta autorizante y su concesión durante la transacción; una revocación/deshabilitación concurrente debe esperar o ser observada antes de escribir. Las comprobaciones no dependen de roles en JWT ni de ocultar botones.
- La lectura de opciones y la escritura están protegidas. El servicio vuelve a autorizar después de calcular el hash y antes de realizar la transacción de alta.
- POST requiere JSON, `Origin` idéntico al origen público de `NEXTAUTH_URL` y no admite `Sec-Fetch-Site: cross-site`. Sin `NEXTAUTH_URL`, se compara contra el origen de la petición; la configuración de autenticación sigue requiriendo su URL correcta. No se usan encabezados Host/Forwarded del cliente como lista de orígenes confiables.
- Se limita el cuerpo a 16 KiB durante su lectura. Entradas estrictas con Zod: no se aceptan campos para cambiar `is_active`, `must_change_password`, hash, versión o actor.
- Respuestas privadas con `Cache-Control: private, no-store`. No se devuelve ni persiste la contraseña temporal en claro y no se envía correo automáticamente. El administrador suministra la clave y coordina su entrega por el canal acordado.

## Identidad, roles y contexto inicial

`person` permite crear una identidad mínima o reutilizar una persona conocida mediante UUID. Reutilizar no modifica sus datos; se bloquea la persona durante el alta y se rechaza si ya tiene cuenta. Crear una persona nueva no afirma que se haya verificado identidad gubernamental ni evita duplicados por nombres similares.

El correo se normaliza con trim/minúsculas, como en el login. El nombre de usuario permite letras ASCII, números, punto, guion y guion bajo, de 1 a 64 caracteres; se normaliza a minúsculas. Son límites técnicos del formulario/contrato, no una nueva política de la Liga. PostgreSQL conserva los índices únicos `lower(username)`, `lower(email)` y persona única para resolver carreras.

Roles iniciales admitidos: SUPERADMIN, EXECUTIVE_PRESIDENT, SECRETARY, TREASURER, DISCIPLINARY_BOARD, REFEREE_MANAGER, SCHEDULER, DATA_ENTRY y CLUB_DELEGATE. PLAYER, REFEREE y GUEST quedan fuera de este alta administrativa; GUEST continúa sin cuenta. Solo se admiten códigos existentes del catálogo y no se repiten roles.

- SUPERADMIN se provisiona como concesión global exclusiva en esta operación. Combinarlo con otros roles/contextos requiere el flujo general de administración de roles.
- Las cuentas de otros roles reciben una liga activa común. El delegado requiere también un club de esa liga; los demás roles reciben alcance de liga, incluso si la misma cuenta también es delegada.
- Se acepta un club existente ACTIVE o un registro inicial de club con nombre y referencia única generada en servidor. No se permite asociar un club de otra liga, suspendido o dado de baja.
- El registro inicial no crea `club_affiliations`, temporadas, equipos ni aprobaciones. `clubs.status=ACTIVE` es el valor operativo existente del esquema; **no equivale a afiliación aprobada**. La solicitud y su aprobación siguen en PDGLD-10/11 conforme a PV-02.

Se reutiliza la complejidad de contraseña de PDGLD-49. Se guarda Argon2id con el helper existente y `must_change_password=true`. El primer login queda restringido, el cambio de contraseña incrementa versión y exige un nuevo inicio de sesión antes de operar.

## Transacción y auditoría

Persona, club inicial cuando corresponde, cuenta, concesiones y auditoría se guardan en una única transacción. Un duplicado o fallo de auditoría revierte toda la operación, incluidos los registros iniciales de club/persona. El reenvío de la misma cuenta devuelve conflicto en lugar de duplicarla; el cliente no debe volver a enviar el alta ciegamente tras una respuesta de red incierta.

Se establecen `app.user_id` y `app.reason` con alcance transaccional. El trigger del baseline audita cada inserción en `user_roles`; no se añade un segundo evento manual para esa misma inserción. Como `users` y `clubs` no tienen ese trigger, se registra manualmente su alta con DTO mínimo y referencias UUID. No se copian correos, nombres de persona, hashes, contraseñas ni MFA al evento. La auditoría existente es de solo inserción.

## Contrato para PDGLD-53

### POST /api/accounts

Usar `fetch` desde el mismo origen, método POST y `Content-Type: application/json`. El navegador envía Origin y la cookie HttpOnly; no construir identidades ni roles autorizantes en la UI.

Campos:

| Campo | Contenido |
| --- | --- |
| username | Nombre de usuario único |
| email | Correo de acceso válido, máximo 254 caracteres |
| temporaryPassword | Clave temporal que el administrador escribe; complejidad compartida de PDGLD-49 |
| person | `{ firstName, paternalSurname, maternalSurname? }` o `{ id }`; no mezclar ambas variantes |
| roles | Lista de códigos permitidos, al menos uno, sin duplicados |
| leagueId | UUID requerido salvo SUPERADMIN |
| club | Solo si incluye CLUB_DELEGATE: `{ kind: "existing", id }` o `{ kind: "new", name }` |

No hay contraseña de ejemplo fija en este documento. La UI puede importar `createAccountSchema` y su tipo desde `features/accounts/schemas.ts` para validar sin importar Prisma ni módulos de servidor.

Respuesta 201: `{ id, personId, mustChangePassword: true, leagueId, clubId, assignments: [{ id, role }] }`. Los ámbitos globales se representan por null. No se devuelve la clave temporal ni la cuenta completa.

| Estado | code | Tratamiento de interfaz |
| --- | --- | --- |
| 400 | VALIDATION_ERROR / INVALID_PAYLOAD | Corregir los campos/JSON; el esquema compartido permite mostrar errores por campo |
| 400 | INVALID_CONTEXT | Volver a comprobar liga, club y catálogo |
| 401 | UNAUTHENTICATED | Volver al login |
| 403 | PASSWORD_CHANGE_REQUIRED | Completar cambio obligatorio |
| 403 | FORBIDDEN | Mostrar acceso denegado |
| 403 | INVALID_ORIGIN | Comprobar URL pública/configuración; no reintentar sin protección |
| 409 | DUPLICATE_ACCOUNT | Ya existe un identificador; no recrear persona o club por separado |
| 409 | PERSON_UNAVAILABLE | La persona no existe o ya tiene cuenta |
| 413 | PAYLOAD_TOO_LARGE | Respetar el tamaño del contrato |
| 503 | SERVICE_UNAVAILABLE | No mostrar éxito; comprobar si se recibió confirmación antes de reintentar |

### GET /api/accounts?leagueId=UUID

Devuelve `{ roles: [{code,name}], leagues: [{id,name}], clubs: [{id,name,reference_number}] }`, únicamente para el administrador autorizado. Sin liga elegida devuelve clubes vacíos. Solo muestra ligas activas y clubes ACTIVE de la liga elegida. No devuelve personas, cuentas ni credenciales. El listado inicial de clubes está limitado a 100; la UI debe respetar este alcance mientras se añade búsqueda/paginación si el padrón lo necesita. El servicio de alta admite un UUID válido conocido aunque no aparezca en esa primera lista.

## Pruebas y entrega

Las pruebas están en `tests/integration/accounts.test.mjs` y se ejecutan mediante `npm run test:auth`, después de la suite existente de autenticación, con el mismo servidor y PostgreSQL temporal. CI ya invoca ese comando en PostgreSQL 15/17. Las credenciales de provisión de esta suite se generan aleatoriamente durante su ejecución y no se imprimen.

Se verifican denegaciones, CSRF/origen, validaciones, ámbitos, hash y primer ingreso, concurrencia, reutilización de persona, auditoría sin secretos y rollback ante un fallo de auditoría inyectado en la base temporal. La prueba no modifica la base local persistente ni Supabase.

La pantalla de PDGLD-53, la revisión del PR, CI remoto y la aceptación integrada de la historia siguen pendientes. No se afirma que esas validaciones estén aprobadas por implementar el servidor.

Resultado local del 16/10/2026: `npm run test:auth` pasó 32 resultados (30 subcasos y sus dos contenedores), contra PostgreSQL temporal. Incluye el recorrido alta → login restringido → cambio de contraseña → nuevo login operativo y la revocación del permiso de alta conservando la misma cookie. El runner detuvo su servidor y eliminó su base temporal al terminar.

No se ejecutó un build de producción en esta revisión: permanece pendiente el fallo previo de IPC del loader CSS en Node 24.21 y el build limpio utiliza fuentes de Google. Las rutas nuevas sí se compilaron y ejercitaron en el servidor real de pruebas de Next.js. Se respetó la instrucción de usar paquetes ya descargados.
