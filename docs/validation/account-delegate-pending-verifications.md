# PDGLD-106/107/108 — Resultados aprobados y pendientes reales

Actualizado el 30 de octubre de 2026. Navegador y Preview/RLS temporal **ya no
están pendientes de ejecución**: aprobaron en PostgreSQL 15 y 17, con limpieza
verificada. Los run-id que siguen están consumidos y no deben reutilizarse.

La referencia vigente es la [matriz criterio → implementación → prueba → resultado](account-delegate-acceptance-matrix.md).
No se declara completo PDGLD-108/93 ni se acredita revisión independiente o CI
remoto. Esta actualización inspeccionó registros y código; no repitió servicios.

## Resultados

| Perfil | Run-id | PG15 | PG17 | Limpieza |
| --- | --- | --- | --- | --- |
| Navegador | c2bf8520-6197-4fae-8a60-4b0e6d2b0729 | Aprobado | Aprobado | Verificada en ambas versiones |
| Regresiones SQL E6 | 8f6e123a-9241-4afc-a9ad-c8c91e3be7d2 | Aprobado | Aprobado | Verificada entre versiones y al terminar |
| Preview/RLS temporal | e8d3af10-f264-48b2-9fae-b90bb865630d | Aprobado | Aprobado | Verificada en ambas versiones |

Preview se inició únicamente después de aprobar navegador y verificar su
limpieza. Cada perfil ejecutó PG15 → limpieza → PG17 → limpieza. No se accedió
a gestor_ligas_dev, .env habitual o Supabase real; no se ejecutaron seeds.

Las cuatro copias instalaron con npm ci y ejecutaron su propio Next/Turbopack,
sin installedDependencies o enlaces externos a node_modules. El helper común
verificó hashes de manifiestos, versiones y resolución dentro de la copia.

Se verificó ausencia de contenedores/redes, app-pgN, chrome-pgN y npm-work-pgN,
procesos de ambas ejecuciones y listeners en 55415/55417/56515/56517. Se conservan
registros y evidencias privadas. El proyecto mantiene lockfile, compose.yml y
archivos de control de dependencias originales sin cambios de hash.

[Resultados estructurados saneados](account-delegate-approved-results.json).

## Lo que las aserciones sí comprobaron

- Chrome/NextAuth/PostgreSQL reales: selección inicial vacía, cambio de club y
  vigencia borra la selección; conflicto por PRIMARY ocupado entre lectura y
  envío conserva captura, borra contraseña y no deja cuenta residual.
- Opciones bloqueadas por legado; teclado/foco visible y error ARIA; viewport
  390×844 sin desbordamiento; alta DEPUTY persistida y presentada; legado sigue
  NULL y muestra Cargo no identificado. Hay capturas privadas de escritorio/móvil.
- HTTP bajo runtime limitado: opciones private/no-store; anónimo/sin permiso/
  contexto ajeno denegados; altas PRIMARY/DEPUTY; cargo obligatorio; conflicto,
  rollback sin residuos, contigüidad e intervalos inválidos; revocación efectiva
  con la misma sesión y restauración del permiso solo en el fixture temporal.
- Runtime Preview sin SUPERUSER/BYPASSRLS/membresías; RLS efectivo; INSERT limitado
  a siete columnas de user_roles; UPDATE/DELETE e INSERT(id) denegados, ledger
  privado y sin exposición de user_roles a roles API sintéticos.
- Auditoría obligatoria: sin actor/motivo falla; inserción autorizada auditada una
  vez, rollback restaura conteos; cuatro altas HTTP generan cuatro eventos con
  cargo explícito. Aprovisionamiento conserva role_permissions.
- Actor SUPERADMIN acotado a club: opciones propias 200 y ajenas/alta ajena 403.
  No es una prueba de facultades de un DEPUTY sobre solicitudes o firmas.

## Pendientes de PDGLD-108

| Criterio | Implementación/prueba que falta |
| --- | --- |
| Dos DEPUTY distintos | Cerrado por E6 en SQL 15/17: dos cuentas/personas, conflicto de cargo y ausencia de residuos. |
| Reemplazo atómico autorizado | Contrato y servicio que cierren/creen en una transacción con permiso/ámbito, instante de corte y auditoría; éxito y rollback integral. SQL directo no acredita ese servicio. |
| Reemplazos concurrentes | Dos intentos sobre la misma asignación, versión/ganador/conflicto, reintento autorizado y conservación del historial; las altas concurrentes existentes no cubren esto. |
| Historial consultable | Consulta autorizada y DTO/recorrido con ambas identidades, corte, actor/motivo/correlación y conservación de cuentas, solicitudes y firmas. Los triggers protegen filas pero no implementan esa consulta. |
| Baja sin promoción | Entrada autorizada y recorrido de baja/cierre, vacante real y permanencia de DEPUTY sin promoción; la aserción SQL actual solo lee su cargo después de programar otro PRIMARY contiguo. |
| Límites de vigencia | E6 aprueba antes/en inicio y antes/en fin exclusivo para ambos cargos con reloj SQL controlado. Quedan recorrido HTTP y vencimiento/baja real. |
| Propiedad y firmas | Matriz de ambos cargos operativos, solicitudes propias/ajenas, correcciones y carga/descarga de firmas, ámbito y vigencia; decisiones explícitas donde las facultades estén pendientes. Mantener requested_by y reglas actuales, sin transferencias automáticas. |
| Integración final | Revisión independiente, CI remoto y revisión visual/accesible del equipo; no confundir Chrome emulado con dispositivo físico o lector de pantalla. |

La matriz principal enlaza cada implementación y aserción inspeccionada. Las
suites de afiliaciones/autorización/firmas citadas allí **no fueron ejecutadas**
por los perfiles nuevos: se usan para identificar código y brechas, no para
atribuir resultados aprobados.

## Archivo privado y procedencia histórica

Archivo duradero fuera del repositorio:
`Documents/PDGLD-106-107-108-evidencias-20261030`, 37 archivos de seis ejecuciones,
con manifest-v2.json (se conserva manifest.json original) y SHA-256 verificados, directorios 0700 y archivos 0600.
Contiene registros/evidencias SQL, HTTP, probe exitoso, navegador y Preview; los
originales permanecen en /private/tmp. Ningún log o registro original se copia a
Git. El diagnóstico anterior de Turbopack tiene además su archivo privado separado.

La [evidencia SQL](PDGLD-106-postgresql-aislado.md) y la
[evidencia HTTP histórica](account-delegate-http-isolated.md) conservan las
aprobaciones del 28 de octubre. El [diagnóstico de arranque](account-startup-probe.md)
conserva fallos y comparación controlada; su preparación culminó en HTTP 200 con
el run d47db239-b3fe-4e0a-a210-867dd42c604b. Los fallos anteriores ocurrieron antes
de Chrome y no invalidan las ejecuciones posteriores aprobadas.

No se reutilizan aquí los comandos antiguos con IDs consumidos. Una ejecución
futura necesita run-id nuevo y el alcance autorizado correspondiente. Recovery
no debe matar procesos por puerto ni eliminar recursos por prefijo; tras una
caída abrupta se inspeccionan identidad, rutas y procesos propios primero.

## Regresiones añadidas después de las aprobaciones

Se prepararon tres casos para reglas ya acordadas: dos DEPUTY distintos,
inicio incluido/fin excluido y autoría persistente de solicitudes/firmas al cambiar
representantes. Están **aprobados en E6, PostgreSQL 15 y 17, con limpieza verificada**; no se atribuyen
a los runs aprobados anteriores. El cambio SQL solo acredita conservación de autoría
y referencias, no un servicio autorizado de reemplazo. El [plan aislado](representative-agreed-rule-tests.md)
reutiliza el runner SQL, sin Next/Chrome/Preview ni instalación npm.
El [contrato de historial/cierre/reemplazo](../architecture/representative-assignment-contract-draft.md)
permanece pendiente, incluidas elegibilidad de la cuenta entrante y recuperación
de respuestas inciertas. No se implementaron rutas, versión o función privilegiada.
