# PDGLD-106 — Validación PostgreSQL aislada

Fecha: 28 de octubre de 2026. Ejecución autorizada expresamente por la persona
responsable, sin staging, commit ni push.

```sh
npm run test:delegate-isolated -- --execute --run-id 0829cdc5-5cb2-4df5-bbe3-c86c46af553c
```

## Resultados reales

| Orden | PostgreSQL | Imagen | Destino | Suite | Limpieza |
| --- | --- | --- | --- | --- | --- |
| 1 | 15 | postgres:15-bookworm | 127.0.0.1:55415 | Aprobada | Completada |
| 2 | 17 | postgres:17-bookworm | 127.0.0.1:55417 | Aprobada | Completada |

El proceso terminó con exit code 0. Se comprobó la versión mayor mediante
server_version_num. No se registra aquí una versión menor ni digest de imagen
que no se hayan capturado. PostgreSQL 17 se inició después de aprobar y limpiar 15.

La suite existente comprobó cupos, una cuenta en cargos distintos y rechazo de
una segunda cuenta para la misma persona; intervalos contiguos/solapados y fin
abierto; preservación de legados ambiguos/duplicados y clasificación explícita;
conflictos concurrentes por cargo/cuenta y esperas ante cierres de legado con
COMMIT/ROLLBACK; rollback atómico y auditoría única. También verificó guards de
historial/identidad del perfil y operaciones en READ COMMITTED, REPEATABLE READ y
SERIALIZABLE. No hubo fallo de suite ni se relajaron restricciones SQL.

## Bases y recursos exclusivos

- PG15: pdgld48_test_0829cdc55cb24d15 y pdgld106_model_0829cdc55cb24d15.
- PG17: pdgld48_test_0829cdc55cb24d17 y pdgld106_model_0829cdc55cb24d17.

Las bases padre/interior se crearon y eliminaron en sus contenedores exclusivos,
con datos PostgreSQL en tmpfs. No se cargó el .env del proyecto ni se ejecutaron
operaciones contra gestor_ligas_dev. No hubo montajes del proyecto ni volúmenes
persistentes de datos. compose.yml conserva el SHA-256 previo:
`5f1a9e074a84033b821e8f24485155cd5fc7c23bb606022f22ff58d02e8dc11c`.
Las migraciones compartidas no se modificaron.

El registro sin credenciales permanece en:
`/private/tmp/pdgld106-0829cdc5-5cb2-4df5-bbe3-c86c46af553c/run.json`.
Para ambas versiones indica passed=true, cleaned=true y pending=false.

Se verificó independientemente mediante Docker inspect por nombre exacto que
ya no existen estos cuatro recursos:

- pdgld106-0829cdc5-5cb2-4df5-bbe3-c86c46af553c-pg15
- pdgld106-0829cdc5-5cb2-4df5-bbe3-c86c46af553c-pg15-net
- pdgld106-0829cdc5-5cb2-4df5-bbe3-c86c46af553c-pg17
- pdgld106-0829cdc5-5cb2-4df5-bbe3-c86c46af553c-pg17-net

Las respuestas No such container / network ... not found de estas verificaciones
son la evidencia de ausencia, no fallos de las suites. Quedan únicamente metadatos
locales de ejecución y las imágenes en caché, conforme al plan autorizado.

## Incidencia inicial del runner

El primer intento dentro del sandbox no pudo acceder al socket Docker y no llegó
a SQL. La comprobación fuera del sandbox encontró ausentes el contenedor y la red
de 15. El cleanup inicialmente no reconocía la variante exacta de Docker
`network <nombre> not found`, por lo que informaba una limpieza incompleta.

Se corrigió solo ese reconocimiento: exige exit code 1 y el nombre exacto, sin
ocultar errores de permisos o del daemon ni aceptar recursos ajenos. Pasaron las
13 pruebas puras del runner, y el registro de ese intento se conservó en el
directorio de ejecución con sufijo -sandbox-attempt. Tras verificar su limpieza,
se repitió el mismo comando autorizado con acceso al socket. No se modificó SQL,
migración, restricciones, seeds ni fixtures para obtener las aprobaciones.

Comprobaciones posteriores: test:ci 41/41, typecheck, lint y diff --check aprobados.

## Límite de la evidencia y actualización del 30 de octubre

La ejecución SQL del 28 de octubre valida el modelo y su ciclo de vida aislado;
no ejecutó HTTP, Chrome o Preview. Posteriormente esos perfiles aprobaron también
en 15/17 y su limpieza quedó verificada. Se conserva esta procedencia separada:
no se repitió la matriz SQL ni se atribuyen sus aserciones a los nuevos perfiles.

La [matriz por criterio](account-delegate-acceptance-matrix.md) precisa el alcance:
no hay caso explícito de dos DEPUTY distintos rechazados por cupo; un rollback SQL
de cierre/alta fallida no demuestra reemplazo atómico autorizado; conservar filas
no demuestra un historial consultable por un usuario autorizado. PDGLD-108 sigue
incompleto. Originales privados y hashes se archivaron fuera del repositorio.
