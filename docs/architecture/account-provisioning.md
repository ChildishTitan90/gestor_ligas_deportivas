# Alta de cuentas — PDGLD-34 / PDGLD-52 / PDGLD-54

Implementación original: 16/10/2026, rama `feat/PDGLD-34-crear-cuentas`. Autorización compartida adaptada en PDGLD-54.

## Alcance y coordinación

Se implementa el servidor de [PDGLD-52](https://victoranhernandez.atlassian.net/browse/PDGLD-52), asignado a Sergio: provisión de cuentas propias, contexto inicial, autorización, auditoría y pruebas HTTP. [PDGLD-53](https://victoranhernandez.atlassian.net/browse/PDGLD-53), asignado a Nickte, conserva la interfaz. No se cambia su asignación ni el estado de Jira. La historia [HU22-01 / PDGLD-34](https://victoranhernandez.atlassian.net/browse/PDGLD-34) requiere integrar ambos trabajos y obtener revisión/aceptación.

No se crean identidades en Supabase Auth ni se añade autorregistro. No se cambian dependencias, esquema, baseline ni datos de Supabase. PDGLD-54 sustituye la comprobación fija de SUPERADMIN por el [guard compartido de servidor](authorization.md), que consulta los permisos y asignaciones vigentes. No hay bypass por nombre de rol, incluido SUPERADMIN.

Para usar el endpoint se requiere una cuenta operativa con los permisos explícitos y ámbitos descritos abajo. La instalación inicial de RF22 procede únicamente de `INITIAL_PERMISSION_GRANTS` de Sergio, PDGLD-55, integrado mediante PR #12; véanse los [perfiles locales de seed](../seed.md). No existe una ruta pública para crear autoridad inicial. Las pruebas HTTP con el catálogo real complementan los fixtures aislados existentes.

## Autorización y seguridad

- El servicio obtiene identidad desde NextAuth, sin aceptar actor ni rol autorizante del navegador. Una sesión anónima, vencida, revocada o con cambio obligatorio no permite el alta.
- GET exige `users / READ`; POST exige `users / CREATE` en el contexto de cada asignación solicitada. `roles`, `permissions`, `role_permissions` y `user_roles` se consultan en servidor en cada petición, comprobando vigencias, estado operativo y relaciones reales. El guard no combina el permiso de una asignación con el ámbito de otra ni confía en roles/permisos del JWT. Una revocación se observa en la siguiente petición con la misma sesión.
- Conceder roles requiere además `users / UPDATE` en cada contexto. Para permisos operativos del rol que el actor no posee, se exige también `users / APPROVE`, explícito y en el mismo ámbito. Esto permite administrar una función sin ejecutarla: RF22 no concede al administrador todas las acciones operativas del programador. Los permisos de autoridad de `users` siempre deben estar dentro de las facultades actuales del actor; APPROVE no permite obtenerlos. Como este contrato crea asignaciones sin fecha de fin, las capacidades de delegación/aprobación y las concesiones que respaldan la autoridad deben tener vigencia sin término. Crear cuentas por sí solo no permite conceder roles ni convertir autoridad temporal en permanente.
- Crear el registro inicial de un club exige también `clubs / CREATE` en su liga. Reutilizar `person: { id }` exige `users / CREATE` global, porque una persona sin cuenta no necesariamente tiene una relación de club que permita comprobar un alcance local.
- Se bloquean en lectura compartida la cuenta, las asignaciones y las concesiones consultadas; la escritura toma además el bloqueo transaccional exclusivo de autorización `(54,2026)`. Una revocación/deshabilitación concurrente se observa antes de escribir o espera a que termine la operación autorizada. El servicio vuelve a comprobar permisos/contextos después de calcular el hash, dentro de la misma transacción que crea la cuenta.
- GET filtra ligas, clubes y roles delegables conforme a las concesiones del actor. Un operador local no obtiene el catálogo completo de ámbitos ni puede solicitar una liga ajena. La UI utiliza estas opciones, pero POST vuelve a validar todos los permisos y relaciones.
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

Devuelve `{ roles: [{code,name}], leagues: [{id,name}], clubs: [{id,name,reference_number}] }`, con `users / READ` vigente. Las ligas y clubes están filtrados por los ámbitos de esa capacidad: un actor de club ve sus clubes y un actor de liga los clubes de su liga. Un `leagueId` fuera de su alcance produce 403. Sin liga elegida devuelve clubes vacíos. Solo muestra ligas activas y clubes ACTIVE de la liga elegida. `roles` contiene únicamente los roles que puede provisionar según `users / CREATE`, `users / UPDATE` y la comprobación de cada permiso del rol; puede estar vacío para un actor que solo tiene lectura. No devuelve personas, cuentas ni credenciales. El listado inicial de clubes está limitado a 100; la UI debe respetar este alcance mientras se añade búsqueda/paginación si el padrón lo necesita. El servicio de alta admite un UUID válido conocido aunque no aparezca en esa primera lista y vuelve a comprobar su relación y alcance.

## Pruebas y entrega

Las pruebas aisladas están en `tests/integration/accounts.test.mjs` y se ejecutan mediante `npm run test:auth`, después de autenticación, motor de autorización y administración de permisos, con el mismo servidor y PostgreSQL temporal. Antes de esos fixtures, `catalog-accounts.test.mjs` instala las 127 concesiones reales de `INITIAL_PERMISSION_GRANTS` y verifica opciones, altas y revocación inmediata con la misma sesión, sin conceder permisos por analogía. `npm run test:authorization` ejecuta el subconjunto de catálogo, autorización, administración y cuentas. El workflow invoca `test:auth` en sus bases temporales PostgreSQL 15/17; esto describe su configuración, no afirma una ejecución remota de estos cambios. Las credenciales de provisión de estas suites se generan aleatoriamente durante su ejecución y no se imprimen.

Las regresiones preparan permisos explícitos y verifican denegaciones, CSRF/origen, validaciones, ámbitos, hash y primer ingreso, concurrencia, reutilización de persona, auditoría sin secretos y rollback ante un fallo de auditoría inyectado en la base temporal. PDGLD-54 añade lectura/escritura separadas, filtrado local, denegación de concesiones que exceden la autoridad del actor y revocación efectiva con la misma sesión. La prueba no modifica la base local persistente ni Supabase.

La pantalla de PDGLD-53, la revisión del PR, CI remoto y la aceptación integrada de la historia siguen pendientes. No se afirma que esas validaciones estén aprobadas por implementar el servidor.

**Evidencia histórica del 16/10/2026, anterior a PDGLD-54:** `npm run test:auth` pasó 32 resultados (30 subcasos y sus dos contenedores), contra PostgreSQL temporal. Incluyó el recorrido alta → login restringido → cambio de contraseña → nuevo login operativo y la revocación del permiso de alta conservando la misma cookie. El runner detuvo su servidor y eliminó su base temporal al terminar. Esta evidencia no sustituye la ejecución de las nuevas pruebas de autorización dinámica.

En esa revisión histórica no se ejecutó un build de producción: se documentó un fallo previo de IPC del loader CSS en Node 24.21 y el uso de fuentes de Google en el build limpio. Las rutas se compilaron y ejercitaron en su servidor real de pruebas de Next.js. Las comprobaciones y límites actuales deben reportarse con los resultados reales de PDGLD-54.
