# PDGLD-64 — despliegue y runtime de Preview

Fecha: 27/10/2026. Rama: `fix/PDGLD-64-despliegue-supabase`.

## Cambios preparados

- Plan exacto por nombre y checksum para la migración original PDGLD-64;
  PDGLD-57 y el rechazo de SQL sin revisión permanecen activos.
- Preflight de marcadores y defaults efectivos, incluidas ACL globales/de
  esquema, PUBLIC y herencia; postflight de RLS y grants de tabla/columna,
  también en tablas ya aplicadas y ejecuciones sin pendientes.
- Manifiesto reproducible de permisos/políticas privados de Preview por
  operación y columnas; reparación de FOR SHARE sin autorizar UPDATE real de
  las tablas de lectura. Provisión repetible sin contraseñas y sin escribir RF22.
- Comando protegido separado para check, migraciones originales y provisión,
  fijado al proyecto de pruebas y su propietario, con CA/hostname/TLS estrictos.
- Pruebas del runner y matriz PostgreSQL 15/17 ampliadas para usar la aplicación
  con rol limitado y RLS. No cambia el disparador manual de producción.

Implementación: scripts/ci/production-plans.mjs, deploy-supabase.mjs,
verify-production-security.mjs; scripts/preview/{connection,maintain,runtime-plan}.mjs;
scripts/test-auth.mjs y tests/integration/preview-*. Las suites de catálogo y
equipos solo reciben opciones de prueba; no se modifica código de aplicación.

## Evidencia local

Se usó una instancia **nueva y desechable de PostgreSQL 17.6** en loopback,
independiente de Docker y las bases personales. Docker Desktop no estaba
disponible. Las conexiones del rol gestor_ligas_preview se comprobaron además
con autenticación SCRAM-SHA-256 y una contraseña aleatoria exclusiva del fixture.
El plan de mantenimiento de ambientes no contiene ni cambia contraseñas.

| Control | Resultado |
| --- | --- |
| npm run test:ci | 24 pruebas correctas |
| verify-production-security.mjs | PDGLD-57 y PDGLD-64 correctos; SQL original, Docker, marcadores parciales, defaults, PUBLIC, herencia, tabla/columna y reintento aplicado |
| npm run test:preview-runtime | 64 correctas, 0 fallos; 2 casos Docker omitidos solo en esta variante con RLS |
| Autorizador real bajo rol limitado | 1 prueba adicional correcta: 28 concesiones de SUPERADMIN y 28 acciones en el resumen real, con RLS activo |
| npm run test:team-enrollments | 30 correctas, ninguna omitida; incluye backfill legado y simulación de seguridad Docker/Supabase |
| npm run lint | Correcto |
| npm run typecheck | Correcto |
| npm run build | Correcto, Next.js 16.4.3 |
| Prisma migrate deploy en base vacía temporal | 6 originales aplicados, 98 tablas |
| Prisma migrate status / migrate diff --exit-code | Actualizada / sin diferencias |
| verify-database.mjs | Objetos, CURP, restricciones y rollback correctos |
| git diff --check | Correcto |

El fixture reproduce 42501 con SELECT sin UPDATE, recupera FOR SHARE mediante el
mismo plan instalado dos veces y rechaza modificaciones reales de user_roles,
permissions y otras columnas inmutables. Verifica denegación al ledger y que
datos/RLS se conserven. También rechaza falta de marcador, RLS desactivado,
ledger expuesto, grants PUBLIC adicionales, membresías y una política conocida
alterada, sin sobrescribirla.

Los recorridos HTTP usan NextAuth, consultas/servicios, transacciones y
restricciones reales: cuentas/RF22, alta, aprobación, correcciones, selección de
categorías/grupos, inscripción, recuperación y cancelación. Incluyen otro club,
otra liga/usuario, revocación con la misma sesión, concurrencia, rollback e
idempotencia. El propietario solo prepara fixtures; las peticiones del backend
se ejecutan con gestor_ligas_preview, no como postgres.

La instancia temporal se ajustó a UTC, igual que el entorno CI, después de
detectar una comparación de timestamps con desplazamiento al inicializarla en
hora local. No se cambió el tratamiento de fechas de la aplicación ni Supabase.
Windows bloqueó inicialmente un enlace interno de Turbopack; repetir la
compilación con el permiso necesario terminó correctamente.

## Conservación del trabajo integrado

Se ejecutó git fetch origin develop antes de editar y al finalizar. Ambas
revisiones devolvieron `285f1485d1a091dd0cc5cdee911d2ee781af3f97` (PR #30,
PDGLD-63; PR #31 ya incluido). Se revisaron sus últimos commits y los diffs
locales/preparados contra origin/develop; no avanzó durante el trabajo y no
requirió integración local adicional. No hay cambios preparados para commit.

Se conservan intactos src/, prisma/, AGENTS.md, package-lock.json y el parche
local ajeno `docs/validation/PDGLD-63-borrador-integracion.patch`.
No se hicieron commits, push, merge ni cambios en secretos/Vercel/Jira.

## Pendientes por ambiente

- **CI:** publicar los cambios por el flujo de revisión del equipo y ejecutar la
  matriz completa PostgreSQL 15/17 con el check CI listo para integrar. La
  ejecución local de PostgreSQL 17 no acredita PostgreSQL 15 ni GitHub Actions.
- **Supabase de pruebas:** no se ejecutaron migraciones ni GRANT. El
  administrador debe suministrar la conexión propietaria autorizada a
  PREVIEW_OWNER_URL y seguir check → migrate → provision → check en
  [el procedimiento](../architecture/preview-runtime.md). El rol runtime y las
  credenciales de producción no sirven como alternativa. No se cargaron
  fixtures, SQL de limpieza/datos, ni se restauraron cuentas o RF22 remotos.
- **Supabase producción:** integrar/revisar, liberar a main y arrancar una
  ejecución **nueva** con deploy_production y supabase-production. Reejecutar #92
  conserva el código antiguo. No se disparó ningún workflow de despliegue.
- **Navegador real:** falta el recorrido de Preview publicado con clics,
  hidratación, foco y conectividad real. Los recorridos HTTP y el markup de
  páginas no sustituyen esa aceptación ni verifican el Storage remoto.

Las pruebas locales acreditan el cambio de código; el ambiente remoto sigue
pendiente de aplicación y comprobación por su administrador.
