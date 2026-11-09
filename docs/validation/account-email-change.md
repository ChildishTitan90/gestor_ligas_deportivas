# PDGLD-118 — validación local de correo pendiente

Implementación local del 5 de noviembre de 2026. Contrato vigente:
[correo pendiente](../architecture/account-email-change.md). No staging, commit,
push, despliegue ni mensajes remotos.

## Matriz actual y clasificación de resultados

Revisión del 6 de noviembre de 2026, sin repetir servicios:

| Perfil / intento | PostgreSQL 15 | PostgreSQL 17 | Naturaleza del resultado |
| --- | --- | --- | --- |
| Mantenimiento `.201` | Bloqueo de acceso al socket Docker; sin pruebas | No iniciado | Entorno; limpieza recuperada y verificada |
| Preview/RLS `.202` | ETIMEDOUT de npm antes de pruebas funcionales/RLS | No iniciado | Preparación/red; limpieza verificada |
| Mantenimiento `.203` | Aprobado | Aprobado | Funcional; limpieza verificada |
| Preview/RLS `.204` | Aprobado con solicitudes concurrentes nuevas | Aprobado con solicitudes concurrentes nuevas | Funcional/ACL/RLS; limpieza verificada |

No se observaron fallos funcionales en las suites ejecutadas. Los intentos de
entorno se conservan como tales, sin transformarlos en aprobaciones o fallos del
producto. Transporte real, remitente verificado, plantillas y pantalla de
confirmación siguen pendientes. Los mensajes de prueba fueron simulados y no
acreditan entrega real.

## Preview/RLS `.204`: resultados actuales

Se ejecutó únicamente `account-maintenance-preview` con run-id nuevo, tras
comprobar que su raíz no existía. No se relanzó el perfil de mantenimiento `.203`.
La suite compartida de cuentas se ejecutó dentro de Preview/RLS con el caso
adicional de solicitudes concurrentes, sin otra matriz o recursos adicionales.

```sh
node scripts/test-delegate-isolated.mjs --account-maintenance-preview --execute --run-id 118e2026-1105-4a18-8a15-000000000204
```

| Perfil | PostgreSQL | Resultado | Limpieza |
| --- | --- | --- | --- |
| Preview/RLS `.204` | 15 | Aprobado, incluido el caso concurrente nuevo | Aprobada antes de iniciar 17; inspección independiente final aprobada |
| Preview/RLS `.204` | 17 | Aprobado, incluido el caso concurrente nuevo | Runner e inspección independiente aprobados |
| Mantenimiento `.203` | 15/17 | Aprobación anterior conservada | No repetido; evidencia intacta |

Next y el servicio SQL de prueba operaron con `gestor_ligas_preview`, RLS activo,
sin atributos privilegiados o membresías. Se verificaron ACL por columna,
denegaciones sobre columnas ajenas y tablas protegidas, aislamiento público,
reprovisión idempotente y conservación de RF22. La instalación independiente
usó `npm ci` con el lockfile, registro npm, versiones y controles de integridad
existentes, sin cambios para evitar ETIMEDOUT.

El [caso integrado de solicitudes concurrentes](account-email-request-concurrency.md)
aprobó en ambas versiones: dos conexiones esperando RF22, un éxito y un 409
ACCOUNT_CHANGED con la misma revisión; ningún residuo/aviso del perdedor;
reemplazo con la revisión vigente y solo el token nuevo capaz de confirmar.
La espera de un minuto se atraviesa envejeciendo `created_at` únicamente en el
fixture aislado, sin modificar el reloj de aplicación o sus límites.

También aprobaron los casos compartidos de correo/login, tokens inválidos,
confirmaciones concurrentes, unicidad, rollback, auditoría, sesiones, resets,
NOT_CONFIGURED y ausencia de secreto en respuestas. El transporte sigue siendo
sintético: comprobar avisos al anterior y confirmación al nuevo no acredita
entrega real ni configura un proveedor.

Comprobaciones locales tras preparar el caso: sintaxis, lint, 74 controles de
infraestructura y `git diff --check` aprobados. Solo se amplió la suite integrada,
su metadato de resultado y documentación; no cambió el código de aplicación.

Limpieza independiente `.204`: dos contenedores y dos redes ausentes, puertos
55415/55417/56515/56517 sin listeners y copias app/npm/Chrome retiradas. Quedaron
11 archivos de evidencia privada en su raíz temporal autorizada, con manifiesto
SHA-256 `a71dcb68a0913aaa8b805f6601447d128f2bd4a5792d12a02c59588f77552932`.
Incluyen fuente/lockfile identificados por hash, resultados por versión y
comprobación saneada de limpieza, sin tokens o enlaces secretos. Los manifiestos
y evidencia de `.203` y `.202` se conservaron sin cambios. `.204` quedó consumido.

Sin bases habituales, Supabase real, correo real, staging, commit o push. Las
pruebas Preview/RLS temporales no validan Supabase real ni autorizan producción.
Los intentos anteriores se conservan abajo como cronología, sin reemplazar sus
fallos por aprobaciones posteriores.

## Antecedente: mantenimiento `.203` y fallo de instalación Preview `.202`

Mantenimiento se ejecutó fuera del sandbox con el run-id nuevo
`118e2026-1105-4a18-8a15-000000000203`. Se conservó el socket sin cambiar permisos,
sin sudo, chmod ni contenedores privilegiados. El acceso a Docker funcionó.

| Perfil | PostgreSQL | Resultado | Limpieza |
| --- | --- | --- | --- |
| Mantenimiento `.203` | 15 | Aprobado: suite HTTP/SQL completa actual | Runner e inspección independiente aprobados antes de continuar |
| Mantenimiento `.203` | 17 | Aprobado: suite HTTP/SQL completa actual | Runner e inspección independiente aprobados |
| Preview/RLS `.202` | 15 | Fallo de preparación: npm terminó con `ETIMEDOUT` | Runner e inspección independiente aprobados |
| Preview/RLS `.202` | 17 | No iniciado por fallo de la versión anterior | Ausencia de recursos verificada |

Antes de ejecutar `.202` se confirmó que su raíz no existía, que `.203` tenía
ambas versiones `passed=true`/`cleaned=true`, que sus recursos ya no existían y
que los cuatro puertos estaban libres. Solo entonces se inició Preview/RLS.
En Preview 15 se preparó la base temporal y sus migraciones, pero falló la
instalación independiente antes de iniciar Next, provisionar el runtime limitado
u operar las rutas. Diagnóstico saneado: `dependency-installation`, etapa
`application-copy`, `ERR_ASSERTION` en
`scripts/verification/account-independent-dependencies.mjs:75:12`; el stderr
privado de npm confirma `ETIMEDOUT`. No es un fallo funcional del producto ni
una aprobación o rechazo de sus ACL/RLS. No se reintentó ni se inició Preview 17.
Los run-id `.203` y `.202` quedaron consumidos.

Cobertura observada en ese momento, antes de `.204`:

| Comprobación | Evidencia de `.203` y del intento `.202` |
| --- | --- |
| Correo anterior permite login mientras está pendiente; nuevo rechazado hasta confirmar | HTTP y PostgreSQL 15/17 aprobados |
| Tokens vencidos, usados o reemplazados no confirman; autoridad revalidada | Servicio SQL real en 15/17 aprobado |
| Confirmaciones concurrentes del mismo token y disputa de destino entre dos cuentas | Servicio SQL real en 15/17 aprobado |
| Solicitudes concurrentes por la misma cuenta/revisión | 25 pruebas sin servicios repetidas y aprobadas; este caso solo está en memoria, no se afirma probado concurrentemente en PostgreSQL |
| Unicidad, auditoría, revisión, versión, revocación, rollback y resets anteriores | Servicio SQL real en 15/17 aprobado; trigger de fallo solo en base desechable |
| Sin proveedor: NOT_CONFIGURED y DTO sin secreto | HTTP/SQL 15/17 aprobados |
| Aviso al correo anterior sin secreto; confirmación al nuevo | Transporte sintético del mismo caso de uso; destinatarios comprobados en pruebas sin servicios; no acredita entrega real |
| ACL por columna y RLS del flujo actual | Pendiente: Preview no alcanzó la ejecución de estas comprobaciones |

Limpieza final independiente: ocho recursos Docker ausentes (contenedor/red,
dos perfiles y dos versiones), ningún listener en 55415/55417/56515/56517 y
ninguna copia app/npm/Chrome de ambos run-id. Se conservaron registros, evidencia
privada y comprobaciones saneadas en las raíces temporales autorizadas, con
manifiestos SHA-256 (10 archivos de `.203` y 5 de `.202`). No se trasladaron
artefactos a ubicaciones fuera de los recursos documentados. El
[resultado estructurado](account-email-change-isolated-results.json) conserva
los hashes de manifiesto y el intento histórico `.201` por separado.

No se modificaron código, pruebas, límites ni expectativas para conseguir estos
resultados. `compose.yml`, los tres documentos internos y los nueve stashes
conservan los hashes/identificadores iniciales. Sin bases habituales, Supabase
real, correo real, staging, commit o push.

## Antecedente: intento `.201` detenido por acceso a Docker

Se intentó el primer comando autorizado con run-id
`118e2026-1105-4a18-8a15-000000000201`. Terminó con código 1 durante la creación
de recursos de PostgreSQL 15: el sandbox denegó acceso al socket Docker. No se
llegó a instalar dependencias, iniciar Next ni ejecutar SQL o pruebas del producto.
La denegación se confirmó con una comprobación de Docker de solo lectura que
conservó únicamente categoría de fallo, sin salida interna.

| Perfil | PostgreSQL | Resultado | Limpieza / ausencia |
| --- | --- | --- | --- |
| Mantenimiento `.201` | 15 | Fallo de entorno antes de las pruebas; no aprobado | Recuperada y verificada fuera del sandbox |
| Mantenimiento `.201` | 17 | No iniciado por fallo anterior | Contenedor/red ausentes |
| Preview/RLS `.202` | 15 | No iniciado: condición del perfil previo incumplida | Contenedor/red/copia/registro ausentes |
| Preview/RLS `.202` | 17 | No iniciado | Contenedor/red/copia/registro ausentes |

El primer intento tampoco pudo verificar limpieza dentro del sandbox. Se ejecutó
exitosamente su recuperación autorizada, sin repetir la suite:

```sh
node scripts/test-delegate-isolated.mjs --account-maintenance --cleanup --run-id 118e2026-1105-4a18-8a15-000000000201
```

Una comprobación independiente confirmó ausencia de los ocho recursos Docker
exactos (contenedor y red, dos versiones, dos perfiles), ningún listener en
55415/55417/56515/56517 y ninguna copia app/npm/Chrome de esos run-id. El registro
original `.201` se conserva como evidencia; su `pending` histórico no se reescribió
para simular el resultado de la recuperación. `.202` no tiene registro.
El run-id `.201` ya está consumido y no se debe reutilizar. No se reinició la
secuencia ni se cambió un run-id por iniciativa propia.

En este intento histórico `.201`, las comprobaciones de login, tokens, concurrencia, atomicidad,
rollback, resets, NOT_CONFIGURED, avisos y Preview/RLS **no se ejecutaron en base**
en este intento. Las pruebas sin servicios de abajo conservan su alcance previo.
No hay evidencia nueva de aceptación del producto ni entrega real de correo.
Diagnóstico estructurado: [resultado saneado](account-email-change-isolated-results.json).

## Ejecutado sin servicios

- `npm run test:account-maintenance`: 25/25, contratos y caso de uso con almacén
  transaccional en memoria y transporte sintético. Expiración, formato/propósito,
  uso único, reemplazo, duplicados, concurrencia, autorización revalidada, rollback,
  idempotencia, acuses inciertos, ausencia de proveedor y límites de frecuencia.
- `npm run test:ci`: 74/74 controles puros de infraestructura y ACL Preview; el script
  no ejecuta las suites HTTP/SQL. El workflow ya llama `test:account-maintenance`,
  que ahora incluye las pruebas nuevas.
- Lint, sintaxis de suites `.mjs` y `git diff --check`.
- Tipado completo y Prisma validate/generate con rutas regeneradas en copia
  temporal sin `.env` ni conexión a base. El workspace tiene cliente/tipos de rutas
  antiguos y carece de `react-signature-canvas` instalado; su typecheck directo
  falla por ese entorno. La copia usa Prisma 7.10.1, el esquema actual y los tipos
  exactos de firma del lockfile, sin actualizar dependencias del proyecto.
  Se confirmó después en una copia con dependencias independientes, configuración
  TypeScript original, Prisma generado en su propio `node_modules` y rutas actuales:
  typecheck completo aprobado. Las dos dependencias de firma recuperadas solo en
  temporal se verificaron contra la integridad SHA-512 del lockfile.
- Importación del adaptador SQL bajo condiciones de servidor, sin conectar servicios.

`origin/develop` se actualizó antes y después y permanece en `53c2628`, ancestro
de la rama. Se revisaron cambios de rama/locales e índice contra esa referencia;
no hubo avances que integrar y el índice está vacío. Los hashes de `compose.yml`
y los tres documentos internos, y los identificadores de los nueve stashes,
coinciden con la comprobación inicial. No se modificaron migraciones publicadas,
el lockfile o las dependencias del workspace.

Las pruebas en memoria no demuestran bloqueos/rollback de PostgreSQL ni RLS.
Se añadió `tests/integration/account-email-change.mjs` al perfil de mantenimiento:
usa el adaptador SQL real, fixtures nuevos y transporte sintético en proceso
separado de servidor. El proceso valida destino aislado antes de conectar y
comunica únicamente aprobación/fallo por IPC, sin tokens, direcciones o stacks.
Incluye HTTP sin/con sesión, permiso parcial, origen, ausencia de entrega real,
login anterior mientras espera, GET sin consumo, unicidad/alias, expiración,
reemplazo, autoridad perdida, carreras y fallo real del trigger de auditoría.
La edición directa de correo se reemplazó por rechazo en la suite de identificadores;
se conserva regresión de username, sesión propia y carrera de login.

## Plan original revisado antes del intento

Ambos comandos sin `--execute` se ejecutaron y devolvieron `mode: plan`, sin
crear recursos. Para una futura validación autorizada, ejecutar **secuencialmente**:

```sh
node scripts/test-delegate-isolated.mjs --account-maintenance --execute --run-id 118e2026-1105-4a18-8a15-000000000201
node scripts/test-delegate-isolated.mjs --account-maintenance-preview --execute --run-id 118e2026-1105-4a18-8a15-000000000202
```

Cada comando crea PostgreSQL 15 y luego 17 solo tras aprobar y limpiar el anterior.
No iniciar el segundo perfil hasta que el primero termine y limpie correctamente.

| Recurso | Identidad / límite |
| --- | --- |
| Imágenes | `postgres:15-bookworm`, `postgres:17-bookworm` |
| Contenedor | `pdgld106-<run-id>-pg15` / `-pg17`, etiquetas de propiedad del runner |
| Red | Nombre del contenedor + `-net`, exclusiva por versión |
| PostgreSQL | Loopback `127.0.0.1:55415` / `:55417` |
| Next/Turbopack | Loopback `127.0.0.1:56515` / `:56517` |
| Recursos | tmpfs, sin volumen persistente ni montaje del repositorio; 768 MiB y 2 CPU |
| Base | `pdgld48_test_118e202611054a15` / `...4a17`; reserva `pdgld106_model_118e202611054a15` / `...4a17` |
| Copias/evidencia | `/private/tmp/pdgld106-<run-id>/app-pg15/17`, `evidence-pg15/17`, caché propia de npm |
| Instalación | `npm ci` independiente con lockfile, Prisma generado solo en copia, migraciones solo en base desechable |
| Conexión Preview | Next y adaptador SQL como `gestor_ligas_preview`, RLS activo, propietario separado para fixtures/observación |
| Transporte | Sintético solo en la suite; Next mantiene proveedor no configurado |

En Linux la raíz es `/tmp`. Los dos perfiles reutilizan los mismos puertos y
nombres de base derivados, por eso deben ejecutarse de forma secuencial y con
limpieza verificada. Cada run-id aún no consumido debe utilizarse una sola vez
al ejecutar. El runner retira sus bases/procesos/copias/cachés/contenedores/redes;
fallo de prueba o limpieza detiene la secuencia. La evidencia se conserva privada
sin secretos; no reutilizar aprobaciones históricas para declarar esta suite aprobada.

Los resultados posteriores y sus limpiezas se describen al comienzo del informe.
Mantenimiento `.203` y Preview/RLS `.204` aprobaron PostgreSQL 15/17; el fallo
preparatorio de npm de `.202` permanece registrado como antecedente. Las migraciones y servicios se ejecutaron únicamente en los
recursos temporales autorizados. Sin Supabase real, bases habituales, APIs CURP/INE
ni proveedor de correo. La migración nueva no queda autorizada para producción
por estas pruebas.
