# PDGLD-93 — CI #116, fixture corregido y temporadas aprobadas

Validación aislada autorizada del 2 de noviembre de 2026, rama del PR #37
feat/PDGLD-106-cargos-representantes. Se probó HEAD cea7bb3 más el fixture y
soporte del runner descritos abajo, antes de crear su commit. La ejecución
70cc8172-5ce8-4262-90c0-efea6b79e9af aprobó en PG15 y PG17. Esta actualización
documental no repite operaciones de base ni servicios.

## Causa comprobada y corrección

Run 41579907539: PG15 y PG17 aprobaron autenticación/cuentas e inscripciones;
fallaron en temporadas. Aplicación/build y migraciones aprobaron; Preview/RLS,
competencias con rol limitado y seed posteriores quedaron omitidos.
Ambos logs registran SQLSTATE 23514, user_roles_delegate_position_required,
en competition-general-table.test.mjs:37, guard_delegate_assignment().

La asignación sintética crea un CLUB_DELEGATE para users.idle en un club recién
creado, sin cargo. El escenario solo tiene ese representante: se añade PRIMARY
explícito a INSERT/SELECT. Se conservan cuenta, club, liga, valores predeterminados
de inicio actual y fin abierto; no aparece otro ocupante ni se promueve a nadie.
No se cambian expectativas, permisos, restricciones, negocio o migraciones.

## Revisión de fixtures recibidos de develop

Se revisaron las asignaciones y llamadas de fixtures en tests/integration,
las suites de competencias/temporadas, los casos de autorización y los seeds.

| Fuente | Hallazgo y tratamiento |
| --- | --- |
| competition-general-table.test.mjs | Única alta válida de delegado sin cargo encontrada en las nuevas suites de competencias; corregida PRIMARY |
| competition-distribution.test.mjs | Reutiliza el delegado/club de tabla general; no inserta otra asignación. La suite completa cubre su uso posterior |
| seasons.test.mjs | Crea SUPERADMIN y SECRETARY; no requieren cargo. La asignación posterior de users.underscore también es SUPERADMIN |
| competition-categories/groups/rules/rule-approval/maintenance/lifecycle | No se encontró otra inserción de CLUB_DELEGATE; conservar escenarios y permisos existentes |
| authorization-player-registration/public-navigation | Asignaciones PLAYER/SECRETARY/SUPERADMIN, sin cargo por diseño; no convertirlas en delegado |
| accounts.test.mjs | Positivos PRIMARY/DEPUTY explícitos tras CI115; conservar negativos de cargo ausente/inválido |
| afiliaciones, inscripciones, catálogo y autorización de firmas | Positivos de delegado ya llevan cargo explícito; los helpers reciben PRIMARY/DEPUTY según escenario y club |
| account-delegates-http.mjs | El legado sin cargo se inserta antes de la migración PDGLD-106 a propósito; no corregirlo ni clasificarlo automáticamente |
| delegate-positions-migration.mjs y contratos puros | Conservar preparación de legado y rechazos intencionales por cargo ausente/inválido |
| seed-demo-data.ts / seed-demo.ts | Titulares explícitos por club; instalación conservada, sin ejecutar seeds |

No se encontró otro fixture válido que necesite cambiar su cargo. Esto es una
revisión de código; no atribuye una nueva aprobación de base a suites no ejecutadas.
Las cuentas ya aprobadas en CI116/E9 no se repiten para validar este fixture.

## Perfil ejecutado y aprobado

Se reutilizan supervisor Docker, worker, instalador independiente, copiador y
puente IPC existentes. --competition-seasons selecciona runSeasonIntegrationSuite
completa en vez de las suites de cuentas. No duplica implementación de temporadas
ni llama al runner habitual que carga .env. El proceso de suites debe terminar
con código 0; solo entonces se guarda seasons-suite.json saneado.

La suite completa incluye: temporadas, reglas/versiones, categorías, aprobación
de reglas, grupos, tabla general, distribución pendiente/automática, mantenimiento,
política de jugadores, ciclo de vida y edición/cierre según los casos existentes.
No se filtran subtests ni se relajan asserts para saltar el fallo.

Plan histórico sin servicios, comprobado (run-id consumido):

```sh
node scripts/test-delegate-isolated.mjs --competition-seasons --run-id 70cc8172-5ce8-4262-90c0-efea6b79e9af
```

Comando autorizado y ejecutado; run-id consumido, no reutilizar:

```sh
node scripts/test-delegate-isolated.mjs --competition-seasons --execute --run-id 70cc8172-5ce8-4262-90c0-efea6b79e9af
```

| Recurso | PG15 | PG17 |
| --- | --- | --- |
| PostgreSQL loopback | 127.0.0.1:55415 | 127.0.0.1:55417 |
| Next/Turbopack loopback | 127.0.0.1:56515 | 127.0.0.1:56517 |
| Base de la suite | pdgld48_test_70cc81725ce84215 | pdgld48_test_70cc81725ce84217 |
| Base interior reservada | pdgld106_model_70cc81725ce84215 | pdgld106_model_70cc81725ce84217 |

Contenedores pdgld106-<UUID>-pg15/17 y redes con sufijo -net; imágenes
postgres:15/17-bookworm, tmpfs, 768 MiB/2 CPU, sin montajes del repositorio ni
volúmenes persistentes. Raíz propia /private/tmp/pdgld106-<UUID> en macOS
(/tmp en Linux), app-pgN y npm-work-pgN independientes, evidencia en evidence-pgN.

Efectos: descarga de imágenes si faltan, npm ci por copia con versiones/lockfile
existentes y scripts revisados, incluido prisma generate local; SQL publicado
aplicado y fixtures de temporadas solo en estas bases. La suite administra sus
concesiones sintéticas existentes dentro de la base desechable, sin cambiar el
catálogo o privilegios del proyecto. No seed:dev/demo, bases habituales, .env,
Supabase real, Chrome, Preview/RLS, suite SQL de cargos o cuentas.

Secuencia PG15 → aprobación y limpieza verificada → PG17 → limpieza final.
Fallo de prueba o limpieza detiene la secuencia. Se cierran procesos propios,
conexiones, bases y copias/npm-work; se inspeccionan y eliminan solo contenedores
y redes propios. Se conserva registro privado, instalación, resultado saneado
y diagnóstico en caso de fallo; después se verifican puertos, procesos y hashes.

## Comprobaciones sin base

Pipeline 67/67, formulario de cuentas 24/24, conexión 6/6, entradas de afiliación
15/15, revisión de afiliación 31/31 y política de jugadores 3/3: 146 pruebas puras
aprobadas. Lint, sintaxis y diff sin errores. El nuevo selector y modo plan se
verificaron sin Docker, instalación o conexiones. Esas pruebas puras se distinguen
de la ejecución PostgreSQL posterior, que sí aprobó la suite completa en PG15/17.

## Resultado de la ejecución y limpieza verificada

| Verificación | PostgreSQL 15 | PostgreSQL 17 |
| --- | --- | --- |
| Instalación independiente y versiones del lockfile | Verificadas | Verificadas |
| seasons.test.mjs completa | Aprobada | Aprobada |
| Tabla general y distribución con delegado PRIMARY explícito | Aprobadas | Aprobadas |
| Registro final | passed=true, cleaned=true, pending=false | passed=true, cleaned=true, pending=false |

PG15 aprobó y el supervisor verificó su limpieza antes de iniciar PG17. Después
se comprobó por inspección la ausencia de ambos contenedores y redes propios,
procesos de Next/worker/suites, copias app-pgN, npm-work-pgN y cachés de instalación.
Los listeners 55415/55417/56515/56517 estaban libres. Se conservan registro y
evidencias, no cachés o copias de aplicación. Los hashes de compose.yml y los tres
documentos internos coinciden con el inventario anterior a la ejecución; siguen
fuera del índice y del commit. No se relajaron comprobaciones para aprobar.

La validación local aprobada no equivale a una nueva ejecución remota de CI116;
los resultados de GitHub tras publicar deben verificarse por separado. No se
repitieron navegador, Preview/RLS, cuentas o la suite SQL independiente.

## Evidencia privada duradera y saneamiento

Copia fuera del repositorio:
Documents/PDGLD-93-CI116-evidencia-70cc8172-20261102. Diez archivos originales
(registro, limpieza, resultados seasons-suite.json, metadatos y salida privada
de instalación), más manifest-private.json. SHA-256 verificados contra los
originales de /private/tmp; directorios 0700 y archivos 0600. Ambas copias se
conservan. El manifiesto y los originales, incluidos los logs npm, no se versionan.

Este documento incorpora solo resultados saneados: identificación de la suite,
versiones mayores, aprobación, limpieza y referencias de código. No contiene
conexiones con contraseña, cookies, tokens, logs originales ni datos de fixtures.
