# Evidencia de PDGLD-29 / PDGLD-150

20 de noviembre de 2026. La evidencia inicial describe la implementación previa al commit. La actualización local y su revalidación se registran al final; sin push, PR, despliegue ni cambios en Jira.

## Aislamiento y base

- Clon solicitado: `/Users/nickserrato/Proyectos/gestor_ligas_pdgld32_recuperado`.
- Rama original: `fix/PDGLD-32-politica-abuso`, HEAD `c650a6c`. Estado de trabajo limpio al inicio y comprobación posterior; no se aplicaron stashes ni se cambiaron configuraciones. El inventario de stashes no devolvió entradas. Sus diferencias respecto a develop son propias de PDGLD-32 y no se trasladaron.
- Worktree: `/private/tmp/gestor-pdgld29`.
- Rama nueva: `feat/PDGLD-29-clasificacion-estadisticas`.
- Base y `origin/develop`: `821ac865b8be1d8705b46812fe789596c9987d66`, merge de PR #63 de PDGLD-16. Fetch inicial y posterior exitosos con permiso de acceso al clon fuera de los directorios de escritura ordinarios. El intento inicial sin escalación falló al abrir FETCH_HEAD; la consulta remota no escalada también encontró restricción DNS. Los fetch con permisos y la consulta final de ramas remotas sí se completaron.
- No había rama local/remota con PDGLD-29. GitHub no devolvió PR cuyo título contuviera PDGLD-29. La búsqueda amplia devolvió PR #44/#53/#56/#60 de otros tickets que lo mencionan; ninguno es un borrador propio de PDGLD-29. No se reutilizó la referencia stale de Jira como identidad de un PR.

## Archivos

- `src/features/standings/calculation.ts`: reglas puras de clasificación.
- `src/features/standings/event-statistics.ts`: indicadores por jugador y procedencia de eventos no atribuibles.
- `src/features/standings/server/service.ts`: autorización, consultas, snapshots y materialización transaccional.
- `src/features/standings/calculation.test.ts`: ocho pruebas unitarias de comportamiento.
- `tests/integration/standings.test.ts`: suite real con nueve subpruebas de PostgreSQL.
- `scripts/test-standings-isolated.mjs`: contenedor propio sin volúmenes ni bases heredadas, migraciones y eliminación de ese contenedor al finalizar.
- `prisma/schema.prisma` y nueva migración `20261120010000_standing_calculation_provenance/migration.sql`: rango pendiente, huella, snapshot y prohibición de validar posiciones pendientes.
- `package.json` y `.github/workflows/ci-cd.yml`: comandos y ejecución en CI de reglas y suites aisladas 15/17.
- `docs/architecture/standings-calculation.md` y este documento: contrato, trazabilidad, decisiones y dependencias.

## Validación

Node 24.22.0. Dependencias existentes reutilizadas mediante enlace a node_modules; no se instaló ni actualizó ningún paquete ni se regeneró el cliente compartido del clon original. El servidor usa consultas parametrizadas con tipos explícitos para los nuevos campos. `next typegen` generó exclusivamente tipos locales de rutas del worktree antes de comprobar TypeScript.

- `npm run test:standings-integration`: PostgreSQL 15, **18/18** (8 unitarias, 9 subpruebas y su suite contenedora).
- `npm run test:standings-integration -- --postgres=17`: misma suite en PostgreSQL 17.
- `npm run test:ci`: **94/94** controles vigentes del pipeline.
- `npm run typecheck`: comprobación del proyecto después de generar tipos de rutas.
- ESLint de todos los archivos de código nuevos.
- `prisma validate`: esquema válido, usando URL sintética sin conexión.
- `ci:guard-migrations`: migraciones existentes intactas.
- `git diff --check`: sin errores de espacios.

Cobertura: victoria/empate/derrota, puntos configurados, default en ambas localías y marcador administrativo dentro de GF/GC; fuentes/estados excluidos, empate desconocido/final, orden de criterios, DG generado; eventos reales sintéticos con MOBILE/PAPER y origen de resultado, autogoles, doble amarilla y falta de atribución; corte por jornada, consulta del reglamento vinculado frente a un borrador nuevo; rechazo de reglas sin aprobar; autorización por liga y ausencia de permiso; reenvío, primera creación concurrente, corrección/reprocesamiento; rechazo de aislamiento insuficiente; rollback conjunto de resultado, versión, entradas y auditoría. La restricción diferida rechaza validar posiciones pendientes.

Durante el desarrollo falló primero un fixture que no producía un empate real; se corrigió. La prueba de primera creación concurrente descubrió un conflicto 40001 envuelto en P2010/DriverAdapterError.cause por Prisma 7; se corrigió el reconocimiento y el reintento completo. No se ocultaron esos fallos con fixtures serializados. La primera comprobación de tipos también necesitó generar LayoutProps de Next; no se cambió el layout para eludirlo.

No se ejecutó UI ni recorrido real de confirmación; no hay pantalla nueva en esta fase. CI remoto, build de producción, aceptación funcional y revisión por otra persona no se declaran ejecutados. No se accedió a proveedores CURP/INE, Supabase ni bases existentes.

## Dependencias concretas

El motor y la materialización independiente son utilizables por el servidor. La historia completa sigue pendiente de la pantalla PDGLD-151 y de la integración PDGLD-152. El cierre oficial de cédulas continúa bloqueado en el código existente: PDGLD-85 debe aportar la transición/historial, disciplina su receptor y PDGLD-18 debe confirmar la cédula antes del cálculo en la misma transacción SERIALIZABLE. El efecto derivado necesita autorización acorde al capturista/árbitro sin concederle edición general de competencia. No se reemplazó ese acuerdo por un bypass.

PV-06 debe resolver significado/algoritmo/orden de gol average y empate definitivo, además de efectos retroactivos de bajas. Hasta entonces los subconjuntos no resolubles llevan rank null y no pueden validarse. Se requiere el PDF vigente completo del ERS para contrastar RF07–09: la única versión accesible en Drive fue preliminar e insuficiente. Detalle y enlaces en el documento de arquitectura.

## Actualización local de base y revalidación

20 de noviembre de 2026. Trabajo ejecutado únicamente en `/private/tmp/gestor-pdgld29`.

- Inventario inicial: tres archivos modificados (workflow, package.json y esquema) y nueve archivos nuevos, todos de PDGLD-150. No había pantalla, navegación ni DTO de PDGLD-151. No se incluyeron credenciales, configuración local ni trabajo de PDGLD-32.
- Commit de recuperación anterior al rebase: `ceae5b5965e2edc7240f12854c2feff4df098d91`.
- La consulta remota no encontró publicada la rama PDGLD-29. Se reaplicó el único commit local con `git rebase develop`, sin conflictos. Commit reaplicado: `ed28f39f5cb9b06bc2cef679303e759f8f7e2db1`.
- Base nueva: `6139dba88ed2b75a7b4f380dff7bf95db4263c0f`. Fetch antes del commit y al terminar confirmó ese mismo origin/develop. `git merge-base --is-ancestor develop HEAD` finalizó correctamente.
- El diff contra develop conserva sus migraciones, programación, contratos offline y Next.js 16.4.6; solo incorpora los doce archivos del ticket. No se tocaron las ramas ni archivos de PDGLD-32. Sin push, PR ni cambios en Jira.

El primer intento no encontró npm en PATH; se seleccionó el Node 24.22.0 instalado. La primera comprobación de tipos con el enlace heredado a node_modules del clon original falló por cliente Prisma desactualizado para programación; ese entorno tenía Next.js 16.4.3. Se retiró únicamente el enlace del worktree y se ejecutó `npm ci` según su lockfile, con dependencias propias y generación local del cliente Prisma 7.10.1. No se alteró el destino del enlace ni se instalaron paquetes en PDGLD-32. La caché temporal de esta instalación y los logs temporales de clasificación se eliminaron al terminar.

Resultados con dependencias propias (Next.js 16.4.6):

- `next typegen` y `npm run typecheck`: correctos.
- `npm run lint`: correcto, proyecto completo.
- `prisma validate`: correcto con conexión sintética, sin conexión a base real.
- `npm run ci:guard-migrations`: migraciones anteriores intactas.
- `npm run test:ci`: 96/96.
- `npm run test:standings-integration`: PostgreSQL 15, 18/18.
- `npm run test:standings-integration -- --postgres=17`: PostgreSQL 17, 18/18.
- Ambos runners aplicaron las 51 migraciones, incluidas las dos nuevas de develop y la de clasificación, en contenedores desechables propios eliminados al finalizar. Datos sintéticos; sin bases existentes ni proveedores externos.
- `git diff --check`: correcto.

La revisión del contrato de PDGLD-152 está en el apartado final de `docs/architecture/standings-calculation.md`, con referencias a los archivos de confirmación, sincronización, contrato y cola. El nuevo transporte no aporta los receptores oficiales. PDGLD-151 queda lista para empezar sobre el motor conservado, pendiente de su pantalla y DTO; las decisiones reglamentarias sin resolver continúan representadas como posiciones pendientes y no se habilita validación oficial. No se ejecutó recorrido UI ni confirmación real, build de producción o CI remoto.
