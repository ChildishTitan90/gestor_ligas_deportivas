# PDGLD-38 — Permisos SQL de competencias en Preview

## Entrega local del 1 de noviembre de 2026

- Rama aislada: `fix/PDGLD-38-permisos-preview`.
- Base: cabeza remota del PR #38, `1a16f8657fcf81af6cea0a2c73d148fa9995452f`.
  Incluye `origin/develop` en `fb64b4f068b6121063475333320524725436e0c0`.
- El trabajo de PDGLD-13/14 permanece en su rama y copia originales.
- Corrección preparada en código. **Permisos remotos sin aplicar; Vercel sin verificar.**
- No cambia migraciones, producción, matriz de permisos de negocio ni criterios
  de aprobación de reglas. Los ejemplos de política y puntuación en pruebas son
  sintéticos; no representan acuerdos oficiales de la Liga.

## Diagnóstico y alcance del plan

El PR añadió operaciones de competencias, pero el plan privado de Preview
seguía cubriendo principalmente cuentas, afiliaciones e inscripciones. Por
ejemplo, permitía bloquear `seasons`, pero no insertar temporadas ni actualizar
su versión. Con RLS y `gestor_ligas_preview`, la acción real de creación devolvió
`/competitions/seasons?error=UNAVAILABLE` y no insertó la temporada. El mismo
recorrido funcionaba al usar el propietario; eso no verificaba Preview.

`scripts/preview/runtime-plan.mjs` conserva una única lista explícita para
provisión y mantenimiento. Las ampliaciones corresponden a estas llamadas:

| Operación | Objetos necesarios | Escrituras nuevas del rol |
| --- | --- | --- |
| Crear liga (acción existente del PR) | `leagues`, autorización y auditoría | INSERT nombre, zona y default `is_active` |
| Consultar/crear/editar temporadas | `seasons`, `leagues`, `sports` | INSERT datos de alta y defaults; UPDATE nombre, fechas y versión |
| Guardar borradores versionados | `competition_rules`, `competition_rule_parameters`, `seasons` | INSERT borrador/parámetros y defaults; UPDATE versión de temporada |
| Catálogo y participación de categoría | `categories`, `season_categories`, reglas | INSERT catálogo/participación; UPDATE regla, orden y tipo |
| Formatos y políticas de jugadores | participación, grupos, afiliaciones, registros de jugadores | UPDATE formato, política, edades, corte y pendiente; INSERT grupo General |
| Crear/editar/retirar grupos vacíos | `groups`, equipos, partidos, `standing_versions` | INSERT grupo; UPDATE nombre; DELETE grupo |
| Inscribir y distribuir equipos | contratos existentes de afiliación/inscripción, grupos y participación | Conserva INSERT de inscripción/operación; añade solo UPDATE `season_teams.group_id` |
| Cerrar inscripciones/iniciar/cerrar temporada | temporada, equipos, partidos, `match_statuses`, `match_results` | UPDATE estado, marcas de cierre/inicio y versión |
| Mantenimiento vacío | relaciones `_count` de temporadas y participaciones | DELETE solo `seasons`/`season_categories`; las reglas de vacío y alcance siguen en el servicio |

Las dependencias `_count` incluyen `billing_plans`, `club_team_changes`,
`competition_stages`, `document_requirements`, `imports`, `matchdays`,
`official_documents`, `publications`, `season_awards`, `season_breaks` y
`venue_loans`, además de las tablas operativas ya autorizadas. Se concede
lectura de las columnas de identidad/contexto necesarias para esas consultas,
no del contenido completo de importaciones/documentos. El cierre solo necesita
identidad de resultado/partido y código de estado, no marcadores completos.

Se revisaron los triggers de cierre, auditoría, reglas versionadas, tabla General
y distribución. Las llamadas internas requieren las funciones ya contempladas:
`get_entity_season(text,uuid)` y `get_role_code(uuid)`. No se agregan concesiones
globales de funciones; la prueba revoca EXECUTE de PUBLIC en ese schema para
comprobar que no dependa de esa herencia. Los triggers existentes mantienen
sus definiciones y contexto de ejecución.

PostgreSQL exige algún permiso UPDATE para `FOR SHARE`/`FOR UPDATE`. En tablas
de solo bloqueo se conserva UPDATE de `id` con `WITH CHECK(false)`. En tablas
que ahora admiten modificaciones se retira ese permiso de `id` y se conceden
solo sus columnas editables, junto con la política UPDATE conocida. Las
políticas del backend se destinan exclusivamente a `gestor_ligas_preview`;
la identidad y el aislamiento entre ligas siguen verificados por el servidor.

Una política desconocida aplicable a ese rol o a PUBLIC aborta la transacción.
Las políticas conocidas con otra expresión, comando o destinatario también
se rechazan. Se conservan comprobaciones de proyecto, TLS, propietario, marca
de pruebas, RLS, membresías, ACL efectivas y ledger de Prisma. No se cambia
LOGIN, contraseña, atributos, RLS ni permisos de `anon`/`authenticated`.

## Pruebas reproducibles

Con dependencias del lockfile, npm 11.19 y DIRECT_URL local:

```powershell
npm run test:preview-competitions
npm run test:preview-runtime
npm run test:ci
npm run typecheck
npm run lint
```

`test:preview-competitions` crea una base `pdgld48_test_<aleatorio>` y aplica las
migraciones originales. Solo los fixtures usan el propietario. Activa RLS en
las tablas de esa base y crea el LOGIN limitado; Next recibe su conexión en
DATABASE_URL y DIRECT_URL. Comprueba también el usuario del pool de Next y una
conexión LOGIN real después del mantenimiento. Al terminar elimina únicamente
la base y los roles creados por la ejecución; rechaza roles homónimos existentes.

Reutiliza los recorridos reales de servicios, Server Actions y endpoints de
temporadas, reglas, categorías, formatos, grupos, inscripción/distribución,
políticas de jugadores, ciclo de vida y mantenimiento. Incluye usuarios sin
permiso, liga ajena, versión obsoleta, concurrencia, rollback de auditoría y
reintentos de inscripción. La página de configuración conserva las etiquetas
Borrador y Pendiente de validación.

También reproduce la transición desde las políticas anteriores de solo bloqueo,
ejecuta la provisión dos veces antes y después del recorrido y compara los datos
de las tablas gestionadas y los atributos del rol. Comprueba escrituras/lecturas
prohibidas, ledger, esquema, RLS, membresías, políticas alteradas/desconocidas y
ausencia de acceso público. `test:preview-runtime` conserva la regresión separada
de cuentas, afiliaciones e inscripción legada.

El job `database` del CI ejecuta ambas suites secuencialmente en PostgreSQL 15 y
17. No realizan consultas a las API de CURP/INE ni usan Supabase remoto.

Resultado local final: 54 pruebas de competencias/mantenimiento aprobadas;
regresión Preview con 67 aprobadas, cero fallos y dos omisiones explícitas del
runner (reconstrucción de migración legada y comprobación de Docker sin RLS,
reservadas a sus suites específicas). Los 27 controles de `test:ci`, TypeScript,
ESLint completo y `git diff --check` pasaron. Se usó una base temporal en el
PostgreSQL 15 local de Docker, puerto 5433, sin activar RLS en la base persistente.
No se ejecutó PostgreSQL 17 localmente ni el CI remoto, build de producción o
recorrido en navegador de Vercel. Tampoco se aplicaron permisos en Supabase.

## Procedimiento pendiente para Supabase de pruebas y Vercel

**Preparado para revisión; no ejecutado en esta entrega.** Solo continuar tras
la revisión humana. Usar la copia aprobada del PR con esta corrección, con su
historial completo. No trasladar archivos desde la rama de jugadores.

1. Confirmar en Vercel que se está revisando el Preview correcto, su commit y el
   proyecto de pruebas `loaztwwpwsaqzdtdtvvj`. Su conexión de aplicación debe
   conservar el LOGIN `gestor_ligas_preview`, certificado y transporte vigentes.
   No sustituirla por una conexión propietaria para probar el recorrido.
2. Preparar en la sesión local `PREVIEW_OWNER_URL` y `PREVIEW_CA_CERT_PATH` por
   el mecanismo privado habitual. No imprimir conexiones ni guardarlas en Git.
   La conexión propietaria se usa únicamente para la provisión DDL de permisos;
   no se instala en Vercel. El comando no carga `.env` ni secretos de producción.
3. Ejecutar `npm run preview:maintain -- check`. Verifica destino, TLS, marca de
   pruebas, historial/checksums, RLS y seguridad. Si hay migraciones pendientes,
   divergencia de otra rama o seguridad desconocida, detenerse y acordar su
   tratamiento por separado. Esta entrega no autoriza aplicar migraciones.
4. Revisar el diff de `runtime-plan.mjs`. Tras la autorización humana, aplicar
   exclusivamente las ACL/políticas con:

   ```powershell
   npm run preview:maintain -- provision --apply loaztwwpwsaqzdtdtvvj
   ```

   El comando hace la provisión transaccional y comprobaciones de esquema de
   lectura; no ejecuta `migrate deploy`, seed, cambios de credenciales ni deploy
   de aplicación. Ante una política desconocida, conservar el error y revisarla;
   no borrarla ni ampliar permisos para continuar.
5. Repetir `check`. Registrar commit, fecha, resultado y rol, sin credenciales.
   Marcar entonces **permisos aplicados en Supabase de pruebas**, sin afirmar
   todavía que el recorrido de Vercel funciona. La provisión es repetible si se
   acuerda comprobarla dos veces; no requiere redeploy por sí misma.
6. Con cuentas sintéticas ya autorizadas, verificar en Vercel las lecturas y
   escrituras de la tabla anterior, tanto General como fase de grupos. Comprobar
   cuenta sin permiso y liga ajena; mantener reglas como borradores pendientes.
   Usar temporadas desechables: inicio y cierre tienen barreras irreversibles de
   negocio y no se deben probar sobre temporadas que el equipo quiera conservar.
   Comprobar reintento de inscripción, distribución, versiones y rechazo de borrado
   con dependencias. No invocar APIs externas de identidad en este recorrido.
7. Registrar cada operación comprobada y los errores pendientes. Solo entonces
   marcar **recorrido comprobado en Vercel**. Si hace falta otro commit o Preview,
   su publicación/redespliegue requiere la siguiente entrega autorizada.
