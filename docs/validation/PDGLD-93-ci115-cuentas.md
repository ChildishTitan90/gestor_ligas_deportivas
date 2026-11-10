# PDGLD-93 — Corrección del CI #115 y validación aislada aprobada

Validación del 2 de noviembre de 2026. Rama del PR #37:
feat/PDGLD-106-cargos-representantes. Se validó HEAD 3e60d87 más la integración
de origin/develop 2f87af8 mediante --no-commit --no-ff y las dos correcciones de
fixtures descritas abajo. La integración no tuvo conflictos textuales.
La ejecución aislada E9 fue autorizada expresamente y aprobó en PG15/17;
esta actualización documental no repite servicios ni operaciones de base.

## Diagnóstico y corrección de fixtures

El CI probó el merge temporal 0767865. En PG15 y PG17 el alta del operador de
liga recibía 400 porque el nuevo payload de develop omitía delegatePosition.
El subtest terminaba antes de crear el PRIMARY posterior; el caso de conflicto
presuponía esa plaza ocupada y recibía 201 en vez de 409. No se relajan las
expectativas ni las validaciones: se añade DEPUTY al primer alta y se conserva
el PRIMARY posterior y el rechazo 409 DELEGATE_POSITION_OCCUPIED.

Otro caso posterior también creaba DEPUTY en clubs[0]. Para no disputar ahora
el mismo cupo, crea su DEPUTY en created.clubId, el club con PRIMARY que ese
mismo caso acaba de crear. Conserva el 201 y la prueba de vinculación al club
existente. El negativo que omite cargo sigue esperando 400.

Permisos, catálogo, restricciones, autorización y migraciones publicadas no se
editan por esta corrección. La integración conserva los cambios de competencias,
inscripciones y Preview de develop y los cargos/vigencias de PDGLD-106/107.

## Perfil de verificación ejecutado y aprobado

El perfil HTTP anterior verifica account-delegates-http.mjs; no basta para
validar accounts.test.mjs. Se añade --account-provisioning al supervisor ya
existente, sin cambiar su perfil por defecto. Selecciona exactamente:

1. runCatalogAccountIntegrationSuite, preparación y limpieza RF22 existentes de
   CI, incluidos sus instaladores de permisos aprobados en la base desechable.
2. runAccountIntegrationSuite, la suite completa afectada, sin filtrar casos ni
   sustituir respuestas o modificar sus expectativas.

No se llama al runner habitual que carga .env. Las suites se copian con scripts,
src y prisma; npm ci genera el cliente correcto dentro de node_modules propio.
Así, tanto Next como los fixtures usan la misma copia y esquema integrado,
sin depender del cliente Prisma antiguo de las dependencias originales.
El proceso de suites debe terminar con código 0: await test() por sí solo no
acredita éxito. Solo después se guarda accounts-suite.json saneado.

Plan histórico sin servicios (comprobado; ID consumido):

```sh
node scripts/test-delegate-isolated.mjs --account-provisioning --run-id 4a69fa41-74a6-4f7c-ae1a-5cf49a7e5172
```

Comando autorizado y ejecutado; run-id consumido, no reutilizar:

```sh
node scripts/test-delegate-isolated.mjs --account-provisioning --execute --run-id 4a69fa41-74a6-4f7c-ae1a-5cf49a7e5172
```

| Recurso | PG15 | PG17 |
| --- | --- | --- |
| PostgreSQL loopback | 127.0.0.1:55415 | 127.0.0.1:55417 |
| Next/Turbopack loopback | 127.0.0.1:56515 | 127.0.0.1:56517 |
| Base de la suite | pdgld48_test_4a69fa4174a64f15 | pdgld48_test_4a69fa4174a64f17 |
| Base interior reservada por el supervisor | pdgld106_model_4a69fa4174a64f15 | pdgld106_model_4a69fa4174a64f17 |

Contenedores pdgld106-<run-id>-pg15/17 y redes con sufijo -net;
postgres:15/17-bookworm, tmpfs, 768 MiB/2 CPU por contenedor, sin bind mounts ni
volúmenes persistentes. Directorio propio /private/tmp/pdgld106-<run-id> en
macOS (/tmp en Linux); copias app-pgN y npm-work-pgN independientes.

Efectos: puede descargar imágenes; npm ci por copia con lockfile/versiones del
proyecto, caché/configuración propias y scripts revisados (postinstall Prisma
generate). Aplica SQL publicado y fixtures solo en esas bases. No modifica
permisos de otras bases ni ejecuta seed:dev o el seed demo. No usa .env habitual,
gestor_ligas_dev, Supabase, Chrome, Preview/RLS o la suite SQL de delegados.

PG15 aprobó y sus recursos quedaron eliminados antes de iniciar PG17, que
aprobó también y quedó limpio. El supervisor detiene ante fallo de prueba/limpieza. Se cierran los procesos hijos, Next y conexiones; se eliminan bases,
copias, npm-work y solo contenedores/redes propios inspeccionados. Se conservan
run.json privado, instalación y accounts-suite.json saneado. Tras la ejecución
se verificaron recursos ausentes, puertos libres, procesos y hashes originales.

## Comprobaciones sin base

234 pruebas sin base aprobadas: 66 controles del pipeline, 24 formulario de
cuentas, 6 conexión, 15 entradas de afiliación, 31 revisión de afiliación,
3 política de jugadores, 77 inscripción/sesión y 12 recuperación de inscripciones.
Lint, sintaxis y diff aprobados; el modo plan se comprobó sin Docker ni conexiones. El tipado con el cliente instalado antiguo detectó
campos de competencias ausentes. Prisma generate a una salida propia de una
copia temporal, Next typegen y tsc aprobaron sin base, .env ni cambios a las
dependencias originales. La copia estática se eliminó. E9 acredita además la
suite de cuentas completa en PG15/17 sobre la combinación integrada y corregida;
no acredita una nueva ejecución remota de CI tras publicar el commit.

## Resultados E9 y conservación privada

| Verificación | PostgreSQL 15 | PostgreSQL 17 |
| --- | --- | --- |
| Catálogo existente y accounts.test.mjs completos | Aprobados | Aprobados |
| Alta DEPUTY del operador | 201 | 201 |
| Alta PRIMARY posterior | 201 | 201 |
| PRIMARY ocupado | 409 DELEGATE_POSITION_OCCUPIED | 409 DELEGATE_POSITION_OCCUPIED |
| Subdelegado del club creado por su propio caso | 201 | 201 |
| Limpieza registrada | cleaned=true, pending=false | cleaned=true, pending=false |

Se verificó ausencia de contenedores y redes propios, procesos Next/worker/suites,
copias app-pgN/npm-work-pgN y listeners 55415/55417/56515/56517. Los cuatro hashes
de compose.yml y documentos internos coinciden con su respaldo anterior al merge;
ninguno se incorpora al índice ni al commit. No se alteraron expectativas,
permisos, restricciones o migraciones para aprobar las pruebas.

Archivo privado duradero fuera del repositorio:
Documents/PDGLD-93-CI115-evidencia-4a69fa41-20261102. Diez archivos originales
(registro, limpieza, resultados de cuentas, metadatos y salida privada npm), más
manifest-private.json; SHA-256 verificados contra /private/tmp, directorios 0700
y archivos 0600. Se conservan las dos copias. Los originales y su manifiesto
privado permanecen fuera de Git, incluidos los logs de instalación.

Solo este documento y la entrada E9 del
[resumen estructurado saneado](account-delegate-approved-results.json) incorporan
los nuevos resultados al repositorio: versiones mayores, estados, booleanos y
referencias de código. Sin conexiones, cookies, contraseñas, tokens o logs.
