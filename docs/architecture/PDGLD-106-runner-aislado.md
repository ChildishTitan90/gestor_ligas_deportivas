# PDGLD-106 — Runner PostgreSQL exclusivo

Implementado como entrada separada. PostgreSQL 15 y 17 se ejecutaron y aprobaron
en la ejecución autorizada 0829cdc5-5cb2-4df5-bbe3-c86c46af553c. Véase la
[evidencia de validación](../validation/PDGLD-106-postgresql-aislado.md). Cualquier
nueva ejecución requiere autorizar su plan concreto antes de --execute. El runner
habitual scripts/test-auth.mjs, compose.yml y las migraciones compartidas no se
modifican. No se usa gestor_ligas_dev ni se carga el .env del proyecto.

## Entradas

```sh
# Solo muestra el plan: no Docker, conexiones SQL ni escrituras de archivos.
npm run test:delegate-isolated -- --run-id UUID_V4

# Ejecutar únicamente después de autorizar el plan concreto.
npm run test:delegate-isolated -- --execute --run-id UUID_V4

# Recuperación de esa ejecución: también requiere autorizar sus efectos.
npm run test:delegate-isolated -- --cleanup --run-id UUID_V4

# Verificación pura: no Docker ni PostgreSQL.
npm run test:delegate-runner
```

Sin --execute/--cleanup siempre se utiliza modo plan. Requiere UUID v4 y rechaza
opciones desconocidas o ambiguas. La ejecución rechaza un directorio de registro
ya existente, para no adoptar recursos de una ejecución anterior.

## Destinos y efectos

El supervisor usa exclusivamente `unix:///var/run/docker.sock`. No elige contextos
Docker, hosts remotos ni arranca Docker Desktop automáticamente. Si ese socket no
está disponible, falla; no busca otra instancia.

Procesa secuencialmente:

| Versión | Imagen | Publicación |
| --- | --- | --- |
| 15 | postgres:15-bookworm | 127.0.0.1:55415 → 5432 |
| 17 | postgres:17-bookworm | 127.0.0.1:55417 → 5432 |

Los puertos son fijos, verificados mediante inspect. Si están ocupados se aborta,
sin detener al ocupante ni cambiar de puerto. Puede descargar las imágenes públicas
si faltan; las imágenes quedan en caché, sin ejecutar limpiezas globales de Docker.
Los tags fijan la versión mayor, no un digest: el hijo comprueba server_version_num.

Para cada versión crea una red bridge exclusiva y un contenedor propios con nombres
`pdgld106-<run-id>-pg15[-net]` y `...-pg17[-net]`. No comparte redes de Compose.
La instancia usa tmpfs en /var/lib/postgresql/data, sin bind mounts ni volúmenes
del proyecto o persistentes. Se limita a 768 MiB y 2 CPU por contenedor. 15 debe
aprobar y quedar eliminado antes de crear 17; cualquier fallo detiene la matriz.

Antes de conectar se comprueban ID, nombre, etiquetas de ejecución/propietario/
versión, imagen, modo no privilegiado, red única, ausencia de volúmenes/binds y
publicación exclusivamente en el puerto loopback esperado. Se comprueba que la
red contiene únicamente ese contenedor. La publicación se vuelve a verificar
inmediatamente antes de lanzar el hijo.

No se copia ni monta código dentro del contenedor. El hijo Node local ejecuta la
suite existente contra el PostgreSQL exclusivo. Usa entorno permitido explícitamente
(sin PG*, conexiones, NODE_OPTIONS ni cargadores .env). Las credenciales son
aleatorias y efímeras: viajan al CLI Docker por entorno y al hijo por IPC, nunca
por argv, salida o registro. La configuración Docker usa un directorio vacío
propio, sin heredar contextos/DOCKER_HOST ni credenciales de configuración del usuario.

## Bases y cobertura

Los dos nombres de base se asignan y registran **antes de crear recursos**; por eso
no se necesita descubrir la base interior después de un fallo del hijo. Para el
stem de 14 caracteres hexadecimales iniciales del run-id sin guiones:

- Padre: pdgld48_test_<stem>15 o <stem>17.
- Interior: pdgld106_model_<stem>15 o <stem>17.

El hijo verifica la versión mayor y crea la base padre desde /postgres. Reutiliza
verifyDelegatePositionMigration, que crea la interior, aplica allí el SQL anterior,
prepara datos sintéticos y aplica la migración nueva. No ejecuta seeds, Next.js,
Prisma migrate deploy ni escrituras sobre bases de aplicación.

La suite comprueba cupos, cuenta repetida en cargos distintos, prohibición de dos
cuentas para la misma persona, intervalos contiguos y solapados, fin abierto,
preservación de legados/duplicados, clasificación explícita y bloqueo ante legados.
Comprueba cierres concurrentes con commit/rollback y esperas reales, competencia
por cargo/cuenta, auditoría única y rollback atómico. Ejercita READ COMMITTED,
REPEATABLE READ y SERIALIZABLE sin imponer uno globalmente. También verifica la
identidad estable del perfil y guards de historial. Estas comprobaciones aprobaron en 15 y 17 durante la ejecución documentada;
las pruebas puras del runner no sustituyen esa evidencia PostgreSQL.

## Limpieza y fallos parciales

El registro atómico sin credenciales queda en
`/private/tmp/pdgld106-<run-id>/run.json`, con permisos restringidos. Contiene nombres,
IDs, etiquetas, puertos y bases antes de cada fase. Se conserva para diagnóstico;
no contiene inspecciones completas, contraseñas ni URLs de conexión.

En cierre normal la suite revierte/cierra conexiones y elimina su base interior.
El hijo intenta eliminar la padre y cerrar su conexión administrativa. El supervisor
espera al cierre del hijo y retira su contenedor y red, aun si falló la suite o un
DROP. Eliminar el contenedor descarta todas sus bases en tmpfs.

Ante SIGINT/SIGTERM, el supervisor cancela la ejecución, envía SIGTERM al hijo,
espera su cierre y usa SIGKILL después de 5 segundos si fuera necesario. Solo
entonces limpia Docker. La suite del hijo tiene un límite de 240 segundos. Nunca
inicia PostgreSQL 17 después de un fallo/cancelación de 15.

La limpieza verifica siempre nombre, etiquetas y el ID registrado. Si se perdió
la respuesta de creación, busca solo el nombre exacto con el token aleatorio del
registro. Nunca adopta recursos por prefijo. Una red con otros endpoints no se
elimina. Un error de inspección del daemon no se interpreta como recurso ausente.
No usa --volumes, docker compose down, prune ni elimina recursos de desarrollo.

Si falla una eliminación se intenta revisar los demás recursos y se informa fallo;
no se declara limpieza exitosa. SIGKILL del supervisor, caída del host/daemon o
pérdida del socket pueden dejar recursos. La recuperación --cleanup valida todo
el registro antes de consultar Docker y solo elimina sus recursos identificados.
Si los nombres, IDs o etiquetas no coinciden, se detiene sin apropiarse de ellos.
Se conserva el registro local y el pequeño directorio Docker vacío de esa ejecución;
no son almacenamiento de datos PostgreSQL.

## Verificación disponible

Las pruebas puras inyectan Docker, worker y registro simulados. Cubren orden 15→17,
limpieza antes de avanzar, destino loopback, montajes/identidad ajenos, argumentos y
entorno, fallos de suite/readiness/registro, respuesta de creación perdida,
cancelación y limpieza fallida. También comprueban modo plan sin Docker disponible,
sin escribir archivos ni conectar servicios. Están incorporadas a test:ci.

Arranque, inspect, SQL y limpieza normal se verificaron en los contenedores
exclusivos documentados. Las señales/fallos parciales tienen cobertura pura,
pero no se inyectaron en contenedores reales durante esta ejecución.

## Perfiles de cuentas aprobados posteriormente

El 30 de octubre de 2026 account-browser-isolated y account-preview-isolated
aprobaron en PostgreSQL 15 y 17 y su limpieza quedó verificada. Estos perfiles
usan npm ci independiente y Turbopack, no el enlace/arranque HTTP histórico.
El detalle y los límites están en la
[matriz por criterio](../validation/account-delegate-acceptance-matrix.md).
No se inyectaron fallos reales ni se ejecutaron nuevas pruebas para documentarlo.
