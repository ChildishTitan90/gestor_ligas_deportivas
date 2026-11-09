# PDGLD-117: corrección selectiva e historia protegida

Revisión local del 9 de noviembre de 2026, mismo worktree y PR #45.
HEAD publicado: `7ba6b35abd7fa5a695b630cd5386b0303a74cc47`.
`origin/develop` se actualizó antes y después: `780795e82d5075966fb9707d650fb9f7341da849`, sin avance.
Evidencia obtenida sobre el árbol local antes de preparar el commit del incremento.
El 9 de noviembre se autorizó staging, commit, push y actualización del mismo PR;
el resultado remoto se informa por separado.

## Comportamiento revisable

APPLY conserva `people.id`, CURP única en PostgreSQL, versión, autorización y auditoría.
Solo invalida y reevalúa inscripciones y participaciones de temporadas abiertas.
Las cerradas conservan hechos, resultados y sanciones. Los lectores existentes
usan captura histórica o indican información histórica no disponible: nunca
reconstruyen nacimiento, habilitación o documentos antiguos desde la persona vigente.
CURP/INE operativos están bloqueados para inscripciones cerradas. Las referencias
arbitrales cerradas conservan `HISTORICAL_REFEREE_UNPROTECTED`; la ausencia de
protección instalada también bloquea APPLY. No se da por validado ningún lector externo.

La nueva migración es aditiva y no rellena cierres antiguos. Captura para cierres
futuros nacimiento/versionado, contexto de política/regla, estados y referencias
a documentos/verificaciones/participaciones. No copia documentos privados ni sus rutas.
La identidad con historia requiere un trámite autorizado y finalizado, con auditoría
atómica; un identificador de trámite pendiente no permite eludir la protección SQL.
El inventario y la decisión por lector están en
[el diseño selectivo](../architecture/season-history-selective-correction.md).

## Resultados locales

| Comprobación | PostgreSQL 15 | PostgreSQL 17 |
| --- | --- | --- |
| Identidad integrada y Chrome real con datos sintéticos | 35 comprobaciones aprobadas | 35 comprobaciones aprobadas |
| Migraciones, drift, integridad y controles de seguridad sintéticos | Aprobados | Aprobados |
| Autenticación, equipos, jugadores, participaciones, competiciones, previews y seed | Aprobados | Aprobados |
| Captura futura, referencias sin duplicación, inmutabilidad y ausencia de backfill | Aprobados | Aprobados |
| SQL pendiente sin finalización/auditoría: rechazo y rollback | Aprobado | Aprobado |
| Limpieza antes de continuar/terminar | Verificada | Verificada |

Caso mixto: misma persona con temporada abierta, cerrada capturada y cerrada
legada sin datos. Incluye participaciones abiertas/cerradas, resultados 2–1 y
sanción no vacíos; se comparan antes/después sin cambios históricos. Incluye
permisos entre ligas, autoaprobación, CURP duplicada/concurrente, fallo de auditoría
con rollback y carreras reales en ambos órdenes cierre/corrección. Si gana cierre,
conserva la versión anterior; si gana corrección, el cierre captura la nueva versión.

Run-ids y evidencia saneada conservada fuera del repositorio:

- Identidad: `e1170004-0000-4000-8000-000000000117`,
  `/private/tmp/pdgld106-e1170004-0000-4000-8000-000000000117`.
- Matriz de aplicación: `e1170010-0000-4000-8000-000000000117`,
  `/private/tmp/pdgld117-selective-validation-20261109/database-results.json`.
  Su `source-manifest.json` identifica las copias ejecutadas. Dos skips previstos
  en preview por versión; no se cuentan como pruebas aprobadas.
- Historia SQL final: `ede0c6ac-5b84-40ed-9554-c793dd46fb3d`.
  Ejecución PG15 → limpieza → PG17 → limpieza, salida final aprobada.

También aprobaron tipado, lint afectado, build, reglas de identidad (6),
workspace con Chrome (6), controles `test:ci` (93) y `git diff --check`.
Dos ejecuciones preliminares detectaron errores de fixture (edad mínima y estado
de partido); se corrigieron los datos sintéticos sin debilitar reglas o aserciones.
No se contactaron proveedores CURP/INE ni correo. Solo bases desechables aisladas;
no se usaron producción, bases compartidas ni el compose original en 5434.

## Límites y revisión pendiente

Esta evidencia local no es un nuevo resultado de GitHub Actions. El fallo de
`test:browser-harness` del CI #159 sigue separado; no se modificaron sus tiempos,
aserciones ni workflow. El CI remoto del nuevo commit se comprueba tras publicar el incremento.

Antes de producción falta aprobación de ACL/RLS con el rol real de aplicación,
protección de evidencia privada, retención y respaldos. Los controles sintéticos
no acreditan Supabase productivo. La captura no acredita datos históricos ausentes
ni elimina el bloqueo específico arbitral. No se reconstruyen cierres antiguos.

Se conservaron el trabajo original de identidad/correo, compose, stashes y los
cuatro informes/inventario locales previamente excluidos. La descripción preparada
para el mismo #45 está en [pr-draft](pdgld117-selective-history-pr-draft.md).
