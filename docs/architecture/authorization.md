# Autorización compartida en servidor — PDGLD-54

Actualización de validación, 21/10/2026: `develop` en `a7396c3` ya incluye PR #11 y las suites independientes de Karol. La comprobación con inscripciones reales, preparación determinista del reloj SQL y límites de aceptación se documenta en [cierre PDGLD-54](../validation/PDGLD-54-cierre-autorizacion.md). Las menciones posteriores a dependencias ausentes o al jugador pendiente pertenecen a la evidencia histórica fechada.

El motor consulta `users`, `user_roles`, `roles`, `role_permissions` y `permissions` en PostgreSQL en cada operación. El JWT aporta identidad y la sesión vigente mediante los helpers existentes de NextAuth 4; no aporta permisos. No se compara un nombre/código de rol para autorizar y SUPERADMIN necesita las mismas concesiones explícitas que cualquier otro rol. No se modifican los doce códigos oficiales ni el baseline.

## Matriz aprobada y catálogo de Sergio

La matriz RF22 del ERS sigue siendo la referencia aprobada. El PR #12 de PDGLD-55 está integrado en `origin/develop` (`872b42a`): aporta `prisma/permissions-data.ts` y `docs/architecture/permissions.md`. El cargador consume explícitamente `INITIAL_PERMISSION_GRANTS`, sus 127 concesiones y los 12 códigos oficiales, conservando acciones, contexto y referencias al ERS. El motor **no contiene una segunda matriz** y no instala concesiones al atender peticiones. Su fuente operativa son las asignaciones actuales de la base, incluidas sus modificaciones posteriores para SUPERADMIN.

El módulo canónico de «Usuarios y roles» es `users`. `accounts`, `user_roles` y `role_permissions` siguen siendo nombres de rutas/tablas/responsabilidades, pero dejan de ser módulos de permisos. No se crean aliases ni concesiones adicionales:

| Operación | Acción de `users` |
| --- | --- |
| Consultar opciones de cuentas y catálogo/asignaciones de permisos | `READ` |
| Crear una cuenta | `CREATE` |
| Asignar sus roles iniciales; conceder, ajustar o revocar permisos de un rol | `UPDATE`, además de las garantías de delegación |
| Aprobar facultades operativas que el administrador no ejecuta | `APPROVE`, además de `UPDATE` y el ámbito permanente necesario |

`CREATE` por sí solo no habilita asignar autoridad. `APPROVE` no sustituye los permisos administrativos de `users`: cada acción administrativa transferida debe estar ya respaldada por la misma facultad vigente del actor. Los permisos `fixture.engine.*` de pruebas son exclusivamente fixtures de una base desechable; no describen RF22 ni se cargan en los perfiles de datos reales.

## Contrato de servidor

`src/server/auth/authorization.ts` está marcado con `server-only`:

```ts
type AuthorizationContext = {
  leagueId?: string;
  clubId?: string;
  seasonId?: string;
  teamId?: string; // UUID de teams, no de season_teams
  matchId?: string;
};

type PermissionRequest = {
  module: string;
  action: "CREATE" | "READ" | "UPDATE" | "APPROVE" | "PUBLISH" | "IMPORT";
  context: AuthorizationContext; // {} expresa una operación global
};
```

- `requirePermission(request)` obtiene la identidad operativa con `requireOperationalUser()`, comprueba el permiso y devuelve esa identidad. Sirve para una entrada/lectura; no conserva una autorización para escrituras posteriores.
- `assertPermission(tx, actor.id, request)` vuelve a comprobar todo dentro de la transacción de negocio. `actor.id` solo procede del servidor. Devuelve las concesiones completas que cubren esa petición, para uso interno del servicio.
- `getPermissionGrants(tx, actor.id, module, action)` devuelve concesiones vigentes sin mezclar sus ámbitos. Sirve para filtrar opciones antes de seleccionar datos. No demuestra que una fila concreta esté autorizada: hay que resolver su contexto y aplicar `grantCoversContext`, o llamar a `assertPermission`.
- `resolveAuthorizationContext(tx, context)` obtiene las relaciones reales. `grantCoversContext(grant, resolved)` comprueba una concesión individual contra esas relaciones.
- `assertCanGrantRole(tx, actor.id, roleId, context)` exige `users/UPDATE`; no basta `users/CREATE`. Para cada permiso operativo del rol solicitado exige que el actor lo posea en ese ámbito, o que tenga además `users/APPROVE` cubriendo ese mismo ámbito. Aprobar asignaciones de un programador no exige que el administrador pueda ejecutar la programación: son capacidades distintas expresadas por permisos vigentes, sin nombres de rol. El contrato actual crea asignaciones sin fecha final, por lo que UPDATE y cada permiso/autoridad de aprobación utilizados deben proceder de concesiones sin `ends_at`.
- `isAuthorityPermissionModule(module)` identifica `users` como límite de autoridad compartido. Es una salvaguarda común del motor y la administración, no una matriz de roles. Sus permisos **siempre** deben estar ya concedidos al actor para poder transferirlos; `APPROVE` no sustituye esa comprobación. Nuevas entradas administrativas deben registrar deliberadamente su módulo antes de utilizar el mecanismo de aprobación operativa.

La ausencia de sesión produce `AuthAccessError("UNAUTHENTICATED")`, HTTP 401. Una sesión con cambio obligatorio conserva su error 403 existente. Falta de permiso, contexto incoherente o actor no operativo producen `AuthorizationError`, con `code = "FORBIDDEN"` y `status = 403`. Los servicios pueden validar antes un contrato/contexto y devolver su 400 específico sin revelar datos no autorizados. No deben convertir fallos de autorización en éxito, ni devolver las pruebas internas de permisos al navegador.

## Ámbitos, vigencias y revocación

Una concesión siempre une **la misma** `user_roles` con su rol, permiso y `context_only`. Tener un permiso en liga A y otro rol en liga B no permite utilizar el primero en B. Se suman concesiones completas de los roles múltiples; un rol sin ese permiso no aporta alcance al permiso ajeno.

Se exige cuenta activa, sin cambio obligatorio ni bloqueo vigente. Las asignaciones cumplen `starts_at <= clock_timestamp()` y `ends_at IS NULL OR ends_at > clock_timestamp()`. Liga y club deben existir, estar activos y guardar su relación real. No se mantienen permisos en caché, JWT, sesión, React cache ni memoria entre peticiones: retirar una fila `role_permissions` o vencer/eliminar una asignación deniega la siguiente operación con la misma sesión.

`context_only = false` no borra el ámbito de `user_roles`. Una asignación de liga/club conserva ese límite. Una operación global (`context: {}`) exige una asignación sin liga ni club y un permiso no contextual. Una asignación global con permiso contextual se deniega: no demuestra por sí sola qué contexto es propio. Esta decisión conservadora evita interpretar un asterisco RF22 como autoridad sobre todos los recursos.

La aprobación de concesiones respeta los mismos límites: un `users/APPROVE` de club A no autoriza una asignación de liga completa, otro club ni una asignación global. Un permiso de actualización en A y una aprobación solamente en B no se combinan para ampliar el ámbito. Retirar `APPROVE` hace fallar la siguiente provisión de roles operativos que el actor no pueda respaldar con permisos propios, incluso con la misma sesión. Tener aprobación operativa tampoco habilita por sí mismo la ejecución de esas operaciones: el guard de cada módulo exige su permiso directo.

Los UUID de temporada, equipo y partido se resuelven contra la base. Se comprueba la liga real, club del equipo, pertenencia del equipo a la temporada cuando se proporcionan ambos, participantes y temporada del partido, afiliación de club/temporada cuando se proporcionan ambos. Un partido borrado no concede contexto. Si un partido implica dos clubes, el ámbito de un club solo sirve cuando participa; un club/equipo explícito adicional restringe el contexto a ese participante.

Los ámbitos generales no sustituyen reglas de negocio. Por ejemplo, participar con un club en un partido no autoriza editar la cédula oficial ni aprobar la propia propuesta. El servicio debe comprobar además asignación arbitral, estado y separación de funciones.

## Propiedad y separación de funciones

`src/server/auth/authorization-domain.ts` ofrece comprobaciones adicionales sin nombres de rol:

- `assertOwnRefereeAssignment(tx, actor.id, matchId)` comprueba `users.person_id → referees.person_id → referee_assignments`, árbitro activo y asignación `APPROVED` sobre ese partido.
- `assertOwnPlayerRegistration(tx, actor.id, registrationId)` comprueba la identidad real contra `player_registrations.person_id`.
- `assertSeparationOfDuties(tx, actor.id, request)` rechaza al autor de una propuesta de calendario que intenta publicarla (`schedule-publication/proposalId`) y al capturista de una cédula que intenta resolver su disciplina (`disciplinary-resolution/caseId`), comparando `person_id` contra los autores obtenidos de PostgreSQL. Los UUID inexistentes se deniegan. Para disciplina resuelve `disciplinary_cases → match_events → match_reports`; un caso sin esa relación se deniega.
- Para `charge-approval/chargeId`, RF22.6 exige un registro real de pago antes de aprobar como pagado un cobro: el helper exige evidencia de `payments` no anulada mediante `payment_voids`. No prohíbe categóricamente que intervenga el creador o capturista cuando esa evidencia existe, ni inventa reglas de liquidación, importes o estados de finanzas. El servicio financiero debe aplicar sus contratos específicos además de este prerrequisito.

Estas funciones restringen; **nunca conceden permiso**. Se llaman junto a `assertPermission` dentro de la misma transacción. El servicio obtiene el ID de propuesta/caso/cargo desde la operación real; no acepta un ID alternativo enviado por el navegador como prueba de independencia. El caso sin una relación verificable necesita una regla explícita y se deniega mientras no exista.

Los asteriscos de RF22 para información propia de jugador/asignación arbitral requieren estas relaciones adicionales. `context_only` no codifica por sí solo qué clase de propiedad representa un módulo. El catálogo PDGLD-55 documenta esas relaciones y las precisiones pendientes de los módulos futuros; sus servicios deberán aplicar esas restricciones, sin habilitar acceso general por liga copiando únicamente el booleano. No se implementa programación de partidos para demostrar un permiso.

## Transacciones, concurrencia y auditoría

Las lecturas autorizantes toman `pg_advisory_xact_lock_shared(54, 2026)` y bloqueos `FOR SHARE` sobre cuenta, asignación, rol, permiso, concesión y recursos comprobados hasta terminar la transacción. La administración de permisos toma primero el mismo bloqueo **exclusivo**, usando `lockAuthorization(tx, "exclusive")`. Evita que dos modificaciones autorizadas de la matriz pasen a la vez el control de último gestor, o cambien la autoridad mientras se valida/escribe otra operación protegida.

Todo nuevo escritor de `user_roles`/`role_permissions` o desactivación de gestores debe tomar primero ese bloqueo exclusivo y repetir los invariantes pertinentes dentro de la transacción. No se debe intentar subir de compartido a exclusivo después de autorizar: dos transacciones que hagan esa conversión podrían bloquearse mutuamente. Los cambios SQL administrativos fuera de estos servicios conservan sus restricciones y bloqueos de fila, pero no deben utilizarse como flujo de administración del producto.

El baseline ya audita `user_roles` y `role_permissions`: las escrituras establecen `app.user_id` y `app.reason` con alcance transaccional y no crean un segundo evento manual para esas filas. La administración conserva atomicidad y rechaza dejar sin gestor operativo global. Cambios futuros de cuentas, roles y vigencias deben mantener el mismo invariante; este ticket no crea sus endpoints.

## Integración del equipo

El catálogo único de Sergio ya está integrado; sus precisiones sobre políticas de módulos futuros siguen documentadas en `permissions.md`. La instalación inicial de permisos es distinta de volver a ejecutar un seed. Karol puede añadir archivos independientes bajo `tests/integration`, invocando los helpers/entradas reales y registrándolos en el runner; las pruebas de esta integración no sustituyen su validación independiente. Nickte conserva los contratos HTTP de cuentas: la UI no decide la autoridad del actor, oculta opciones según la respuesta filtrada y trata 401/403 por separado. No se añaden pantallas de administración de permisos.

`tests/integration/authorization-engine.test.ts` comprueba con PostgreSQL real denegación por defecto, revocaciones, roles múltiples sin mezcla, vigencias/cuentas restringidas, contexto cruzado, ausencia de bypass, límites globales y delegación temporal. Exige una base local desechable creada por el runner; no se ejecuta contra Supabase ni una base de desarrollo persistente. Las comprobaciones HTTP y de administración complementan esta suite. La terminación de HU18-01/HU22-02 requiere su revisión y aceptación, no se infiere del resultado técnico de estas pruebas.

## Evidencia local de PDGLD-54 — 17/10/2026

- `npm run test:auth`: 57 resultados aprobados, cero fallos u omisiones (12 del proceso del motor y 45 del proceso HTTP). Incluye sesiones previas, concesión/revocación con la misma cookie, opciones y altas locales, no bypass de SUPERADMIN, concurrencia del último gestor, actor/motivo de auditoría y rollback. Verifica también aprobación explícita de autoridad operativa y su revocación, sin adquirir facultades administrativas.
- `npm run test:authorization`: 34 resultados aprobados en la ejecución inicial acotada. La ejecución completa anterior se repitió después de los ajustes del prerrequisito de pagos y de aprobación de concesiones operativas.
- `npm run test:seed`: 25 resultados aprobados (19 base y 6 demo), con fixtures de catálogo aislados. Incluye rechazo de historial de revocaciones sin marcador, instalación concurrente y conservación de contraseña, estados, vigencias y concesiones retiradas.
- `npm run test:ci`: 12 resultados aprobados. `npm run lint`, `tsc --noEmit --incremental false`, `npm run build` y `git diff --check` completaron correctamente. El build necesitó ejecutarse fuera del aislamiento para crear el enlace de Argon2 que Turbopack requiere en Windows.

Las bases utilizadas fueron desechables en contenedores propios PostgreSQL 15 con tmpfs y publicación loopback; las migraciones se aplicaron mediante `migrate deploy`. No se modificó el esquema ni se creó migración. No se ejecutaron estas pruebas contra Supabase o una base persistente del equipo. PostgreSQL 17 y CI remoto conservan su paso configurado y requieren su ejecución posterior; no se atribuye ese resultado a la prueba local.

En esa evidencia histórica todavía faltaba el catálogo de Sergio. La integración del 18/10/2026 ya consume el catálogo real y concilia `users`; sus resultados se documentan por separado al verificar esta entrega. La prueba positiva de registro propio de jugador sigue fuera de esta integración: el trigger existente limita altas a lunes–miércoles; se conserva la denegación de registros inexistentes sin debilitarlo. La suite independiente de Karol no estaba presente. Su integración está preparada con archivos `tests/integration/authorization-*.test.ts`, descubiertos secuencialmente por el runner y ejecutados por el paso de CI existente.

## Integración local verificada — 18/10/2026

Se continuó el merge ya existente: HEAD `b97fd172f2335eae7e9d15f9061474b566e36cb1`, segundo padre `872b42a17cd34dffb3ac4e60d2f609a55f5baf79` de `origin/develop`. El respaldo `backup/PDGLD-54-autorizacion-antes-integracion-51` sigue apuntando a HEAD. Se resolvieron solamente los dos conflictos reales, `package.json` y `scripts/test-auth.mjs`, conservando `test:session-policy`, autenticación y ciclo de sesiones de develop, además de las suites de autorización, administración y cuentas. No se creó commit de merge.

Las implementaciones de credenciales, sesiones, cambio de contraseña, handler NextAuth y monitor de actividad se conservan como en develop, incluido `users.version`. Los contratos HTTP de cuentas tampoco cambian. El catálogo y su documentación se conservan íntegros como en PR #12; únicamente cambia su consumidor y la correspondencia administrativa con `users`.

Resultados reales en Node.js 24.9.0 / Windows:

| Comprobación | Resultado |
| --- | --- |
| `npm run lint` | Correcto |
| `npx --no-install tsc --noEmit --incremental false` | Correcto |
| `npm run test:ci` | 12/12 |
| `npm run test:session-policy` | 6/6 |
| `node scripts/test-auth.mjs`, cuerpo del harness de `test:auth` | 73/73: 12 del motor y 61 HTTP, sin fallos ni omisiones |
| `npm run test:seed` | 26/26: 19 base y 7 de perfiles/catálogo real |
| `npm run ci:guard-migrations` y comparación directa con develop | Migraciones intactas |
| `npm run build` | Correcto fuera del sandbox; dentro, Windows denegó crear un junction de `pg` |
| `git diff --check` | Correcto |

La invocación inicial de `npm run test:auth` pasó sus 6 pruebas puras y se detuvo al conectar con el PostgreSQL local configurado. Para completar las pruebas se ejecutó su mismo harness con variables de proceso efímeras, PostgreSQL 15 en un contenedor propio con tmpfs y puerto loopback 5433, sin montar volúmenes. El runner creó y eliminó su base `pdgld48_test_<aleatorio>` y detuvo su servidor; el contenedor también se detuvo al terminar. `test:seed` utilizó su propio contenedor desechable. No se aplicaron perfiles a la base persistente del equipo ni se accedió a Supabase. No se ejecutaron PostgreSQL 17 ni CI remoto.

`tests/integration/catalog-accounts.test.mjs` instala el catálogo real **antes** de los fixtures aislados. Compara las 127 concesiones y contextos exactos, los 12 códigos (GUEST sin concesiones), opciones privadas, alta de SCHEDULER, cambio obligatorio y versión, cierre, límites de liga/club, CREATE insuficiente sin UPDATE, revocación con la misma sesión SUPERADMIN y repetición de permissions sin restaurarla. También comprueba administración de programación sin adquirir CREATE de programación, auditoría única por cambio y rollback al retirar el último gestor. Al terminar retira solo sus concesiones/asignaciones sintéticas para que las suites aisladas conserven sus escenarios; la auditoría y los marcadores permanecen hasta eliminar la base temporal.

### Recorrido con las entradas existentes

`npm run test:auth` reproduce automáticamente opciones → alta → login restringido → cambio de contraseña → nuevo login operativo → cierre, además de revocaciones y expiración. Requiere PostgreSQL local disponible en 5432/5433 con capacidad de crear bases; `npm run test:authorization` limita la ejecución al catálogo/cuentas/autorización/administración. Ninguno instala datos en la base persistente.

Para uso manual en una instalación local de demostración nueva y dedicada, `npm run seed:dev` sigue reutilizando el perfil `demo`; credenciales sintéticas y ámbitos están en [seed.md](../seed.md). Con `npm run dev`, iniciar sesión con la cuenta DEMO administrativa permite consultar `GET /api/accounts?leagueId=54000000-0000-4000-8000-000000000001` y `GET /api/permissions`. Enviar el contrato documentado de `POST /api/accounts` desde el mismo origen permite crear SCHEDULER en esa liga. `PATCH /api/permissions` permite revocar `users:CREATE` de SUPERADMIN usando el UUID de permiso obtenido por GET: la siguiente alta devuelve 403 con la misma sesión. Repetir `permissions` o `demo` conserva esa revocación. Esta verificación manual no se ejecutó sobre la base persistente del equipo.

### Dependencias que permanecen abiertas

La API de GitHub confirmó abiertos el PR #10 (`fix/PDGLD-51-monitor-actividad`) y el PR #11 (`feat/PDGLD-58-formulario-tarjeton`), ninguno integrado en el develop revisado. No se incorporaron por adelantado ni se modificó el monitor incidentalmente. El catálogo PR #12 sí está integrado. Permanecen la validación independiente de Karol/PDGLD-56, la interfaz y revisión de Nickte/PDGLD-53, CI remoto y los contratos específicos de módulos futuros. Esta integración no declara terminadas esas tareas ni las historias completas.
