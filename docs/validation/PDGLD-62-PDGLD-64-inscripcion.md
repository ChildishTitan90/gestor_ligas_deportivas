# Evidencia local — PDGLD-62 / PDGLD-64

**Actualización 25/10/2026:** la integración de PDGLD-60 desde el PR #28 y sus
comprobaciones actuales se documentan en
[integración de develop](PDGLD-62-PDGLD-64-integracion-pr28.md). Los resultados
del 24/10 siguientes se conservan como evidencia histórica de la primera entrega.

Sesión del 24/10/2026 (America/Mexico_City). Rama
`feat/PDGLD-62-PDGLD-64-inscripcion-equipos`. Referencia inicial y final revisada:
`origin/develop` en `1d732d6`, PR #26. Se ejecutó fetch remoto antes de modificar
archivos y al terminar; la rama comenzó sin cambios locales ni diferencias con
develop. No se eliminaron funcionalidades integradas ni migraciones compartidas.

## Implementado

- GET de opciones autorizadas, GET de consulta paginada con historial y POST de
  inscripción, documentados en [contrato para Nick](../architecture/team-enrollment.md).
- Modalidades excluyentes de equipo existente/nuevo. Alta nueva, inscripción y
  auditoría atómicas; clave de reintento persistente y unicidad equipo/temporada.
- Sesión operativa, permisos actuales y alcance por asignación; validación de
  club, liga, equipo, temporada, categoría y grupo en servidor.
- Separación de categorías solicitadas y expresamente autorizadas, sin backfill
  automático. Afiliación aprobada y categoría autorizada son prerrequisitos.
- Inscripción inicial REGISTERED; sin ruta a ACTIVE. Auditoría mínima mediante
  trigger, sin claves/huellas/nombres y sin evento manual duplicado.
- Nueva migración aditiva; seguridad Supabase/RLS y baseline conservados.

## Resultados ejecutados

Windows, Node 24.9.0, npm 11.19.0 utilizado para sincronizar el lockfile, Prisma
7.10.1, Next 16.4.3 y PostgreSQL 15 local temporal. El npm predeterminado del equipo
es 11.17.0 y no satisface engines; se usó la versión declarada mediante npx,
conservando la política de scripts. Por instrucción posterior del usuario se
integraron en esta misma rama Next y eslint-config-next 16.4.3 y su lockfile,
inicialmente verificados en una copia aislada.

| Comprobación | Resultado |
| --- | --- |
| Prisma validate / generate | Correctos |
| Reconstrucción y migrate diff en base temporal | Sin diferencias |
| `test:team-enrollments` | 17 pruebas aprobadas: 16 escenarios y agrupadora |
| `test:auth` | Políticas 6 + 3, autorización TypeScript 39 y HTTP 81 aprobadas |
| `test:seed` | 19 + 7 aprobadas; contenedor desechable detenido |
| `test:ci` | 18 aprobadas |
| `test:database-config` | 6 aprobadas |
| `test:affiliation-input` | 13 aprobadas |
| `test:signatures` | 39 aprobadas |
| typecheck / lint | Correctos |
| build | Correcto; incluye las dos rutas nuevas |
| guard de migraciones / diff check | Correctos; migraciones previas intactas |

Los escenarios nuevos verifican: solicitud real PENDING sin inscripción ni
autorización automática; anónimo/cambio obligatorio/sin permiso/club ajeno;
rechazo de ACTIVE y autoridad; categorías/grupos/temporadas inconsistentes;
creación atómica con auditoría inmutable; reintentos normalizados; varios equipos
por club; duplicados en distintos grupos y categorías; reutilización anual sin
sobrescribir historial; cuatro peticiones concurrentes con la misma clave (un 201,
tres 200, un equipo/evento); claves distintas concurrentes para equipo existente
(un 201 y un 409); opciones/listados privados y paginados; revocaciones/vigencias;
rollback por fallo real de auditoría y posterior reintento; FK/CHECK de PostgreSQL;
temporada cerrada con lectura/recuperación sin nuevas escrituras.

El runner crea/elimina únicamente su base aleatoria `pdgld48_test_*`; no aplicó
migraciones a la base habitual ni a Supabase. El test de seed administra un
contenedor propio sin volúmenes. CI ejecutará la suite nueva en PostgreSQL 15/17;
**solo 15 se ejecutó localmente**, sin atribuir resultados a CI remoto.

## Incidencias resueltas

Se sincronizó node_modules con el lockfile: faltaban dependencias ya integradas
en develop. El sandbox impedía PostgreSQL y junctions de Turbopack; las
comprobaciones correspondientes se ejecutaron fuera del sandbox.

Next 16.4.0 detiene el primer arranque de un agente para comunicar una alerta de
seguridad. El runner detecta específicamente ese aviso y repite una sola vez el
mismo comando, conforme a la documentación instalada. No desactiva la política,
no considera un arranque fallido como aprobado y no imprime salidas/secretos de
Next. Así pasaron también las pruebas que reinician el servidor. El build se
completó tras el reintento documentado y mantiene la recomendación de actualizar.
La actualización se preparó primero en un worktree independiente y después el
usuario pidió aplicarla en esta misma rama. Next y eslint-config-next quedaron
en **16.4.3**, con `agentUpgrade: "security"`. Se volvieron a comprobar aquí
tipos, lint, build, inscripción, políticas y la regresión completa de acceso y
afiliación con la versión actualizada, sin aviso de Next. La tabla de resultados
corresponde al conjunto final, salvo seed, ejecutado antes sobre la misma
migración y versiones Prisma/PostgreSQL sin cambios posteriores.

Una reinstalación local se interrumpió porque el servidor dev retenía el binario
SWC en Windows. Se identificaron sus procesos por el módulo cargado y se detuvo
solo ese servidor del proyecto antes de completar npm ci. La ausencia temporal
de dependencias causó errores JSX en cascada en VS Code; la instalación se reparó,
TypeScript pasó y el usuario confirmó que desaparecieron los problemas del editor.

Durante el trabajo aparecieron cambios externos en `affiliation-form.tsx` y
`affiliation-review-list.tsx`; se conservaron y no se atribuyen a este ticket.

## Pendientes separados

**PDGLD-62:** Checo debe integrar la autorización individual por categoría. La
aprobación real ya llegó mediante PR #28, pero no escribe authorized_by/authorized_at.
Se conserva CATEGORY_NOT_AUTHORIZED y no se autoriza ninguna fila automáticamente.
Validar con profesor/Liga la transición a ACTIVO,
autoridad, pago/mínimo de jugadores y requisitos finales. La propuesta está
documentada y la transición no está habilitada. Requiere revisión humana, CI
remoto e integración revisada antes de cierre.

**PDGLD-64:** el 25/10 se ejecutaron solicitud y aprobación reales con la versión
leída del detalle y la sesión de Secretaría. El recorrido termina correctamente
en CATEGORY_NOT_AUTHORIZED: falta autorización individual real para completar
la inscripción positiva. Los positivos aislados conservan fixtures explícitos
en otra temporada y no demuestran esa autorización. Completar el recorrido visual
al integrar PDGLD-63, siguiendo
[aceptación pendiente](../../tests/integration/team-enrollment-acceptance.md).

No se declaran completas las subtareas. No se hicieron commits, push, merge,
despliegues ni cambios en Jira. La convocatoria 2024–2025 se consultó como
referencia histórica; no se universalizaron sus fechas/cuotas/restricciones ni se
implementaron finanzas, jugadores o franquicias.
