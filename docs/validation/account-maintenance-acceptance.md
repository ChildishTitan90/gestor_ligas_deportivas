# PDGLD-120 — matriz de aceptación y operación

Revisión del 7 de noviembre de 2026 de Jira PDGLD-120, historia padre PDGLD-117 y
navegación PDGLD-110. Estado Jira conservado: Por hacer; no se declara Hecha.

Base publicada: [PR #43](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/43),
Draft, sin integrar; SHA `3a3fc91a571b1d1f06cc41ce7866119947367608`.
[CI #146](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42404743255)
aprobó Aplicación, PostgreSQL 15/17 y CI listo para integrar; Supabase omitido.
Esta entrega agrega guía/trazabilidad y una prueba focalizada. CI #146 corresponde
a la base anterior; el SHA y CI de publicación de PDGLD-120 se registran en el PR
y Jira. La ejecución local .240 no se presenta como un job de CI.

## Criterio → evidencia → resultado → pendiente

| Criterio vigente | Prueba o documento | Resultado | Pendiente |
| --- | --- | --- | --- |
| Navegación compartida PDGLD-110, acceso por capacidad y URL directa | `getManagementNavigation`, `ManagementShell`; prueba focalizada `tests/e2e/account-navigation-browser.mjs`, perfil `--account-navigation` | Integración estática presente; ejecución puntual .240 PG15/17 aprobada | Revisión del equipo. No acredita toda la historia PDGLD-110 |
| Lista, búsqueda, paginación y detalle de cuentas | [UI .221/.230](account-maintenance-ui.md); `account-maintenance-browser.mjs`, `account-maintenance.test.mjs` | PG15: API .221/UI .230; PG17: API/UI .230 aprobados; DTO mínimo | Revisión humana; consulta de personas sin cuenta no implementada |
| Reutilizar alta existente y separar persona/cuenta/cargo/rol | Suite HTTP conserva GET del alta y persona/asignaciones; [contrato](../architecture/account-maintenance.md) | Aprobado en mantenimiento PG15/17; no añade gestión de roles | Coordinación con PDGLD-36 y aprobación del alcance por el equipo |
| Edición de identificador y persistencia | .230 Chrome: username + recarga; [contrato vigente](../architecture/account-identifier-maintenance.md) | PG15/17 aprobados; motivo/confirmación y revocación | No atribuir a la UI edición directa de email retirada |
| Duplicados, normalización y concurrencia | `tests/integration/account-identifiers.mjs`; .221/.230 API; [correo .203/.204](account-email-change.md), [confirmación .236](account-email-confirmation-ui.md) | Unicidad en base, colisión y carrera cubiertas; correo vigente hasta confirmar | Entrega real de correo; no repetir PATCH email histórico como prueba vigente |
| Corrección de identidad deportiva, referencias y CURP única (padre) | [Decisiones vigentes](../architecture/account-maintenance-decisions.md) | Campos de persona/deportivos rechazados; conservación de referencias probada | Flujo de corrección con evidencia/aprobación, invalidación y reevaluación no implementado; criterio del padre abierto, no se resuelve con otra prueba |
| Baja/reactivación con motivo y confirmación, baja lógica | .221/.230 HTTP/Chrome; [integración](account-maintenance-integration.md) | PG15/17 aprobados; persona/historial/asignaciones conservados, sin borrado definitivo | Revisión; política de eliminación definitiva fuera de la interfaz |
| Restablecimiento con identidad explícita y entrega privada | [PDGLD-119 .237](administrative-reset.md), `account-administrative-reset-browser.mjs` | PG15/17 HTTP/SQL y Chrome aprobados con transporte simulado; sin proveedor, sin mutación ni afirmación de envío | Proveedor/remitente verificado, validación real y adopción humana del procedimiento (PDGLD-119) |
| Permisos y ámbitos; sin escalamiento | .221/.230 HTTP: sin autoridad/global parcial; .237: propio/inactivo/canal no verificado; [Preview/RLS .204](account-maintenance-preview.md) | Rechazos y validaciones de servidor aprobados; UI sin permiso denegada | No acredita Supabase real; revisión del equipo |
| Último SUPERADMIN activo/efectivo/operativo y concurrencia | .221/.230: bajas concurrentes y respaldo bloqueado/restringido; .237: reset sin respaldo | PG15/17 aprobados bajo bloqueo RF22 | PDGLD-36: retirada de roles/permisos y periodos; no garantía universal ante otros escritores |
| Revocación de sesiones y credenciales anteriores | .230 username/baja/reactivación; .237 reset y reemplazo; .238 cambio concurrente | PG15/17 aprobados; reactivar no recupera cookies; temporal anterior inutilizable | Entrega real no acreditada; revisión |
| Cambio obligatorio, caducidad, uso único e intentos | .237: login temporal, gestión rechazada, contraseña nueva funcional, expiración y login concurrente; CI #146 suites de autenticación | PG15/17 aprobados; versión privada en servidor, sesión pública mínima | Revisión; recuperación autoservicio PDGLD-32 independiente |
| Dos cambios de contraseña concurrentes | [Regresión .238](administrative-reset.md), `password-change-version.mjs` | PG15/17: solapamiento real bajo bloqueo, un 200/un 401, una versión/un evento, sesiones revocadas | Sin pendiente técnico observado en este caso |
| Rollback y auditoría sin secretos | .221/.230 fallo de auditoría; .237 rollback sin entrega/auditoría saneada | PG15/17 aprobados, sin secretos en respuestas o auditoría | Operación/observabilidad del proveedor real |
| Formularios, teclado, foco y errores recuperables | .230 y .237 Chrome, controlador UI, capturas 1280/390 claro/oscuro | Aprobados conflictos y consulta sin replay; cierre/reapertura, Tab/Escape/Enter y foco | Revisión humana y accesibilidad completa no acreditadas |
| Evidencia aislada, CI y limpieza | [UI](account-maintenance-ui.md), [reset y concurrencia](administrative-reset.md), CI #146 | .221/.230 y .237/.238 aprobadas según sus etapas; limpieza propia verificada, cuatro puertos libres | CI del commit PDGLD-120 informado por SHA en PR/Jira; revisión e integración del equipo |
| Documentación de operación | [Guía operativa PDGLD-120](../operations/account-maintenance.md) | Completada con consulta, edición, estado, identidad/reset, canal verificado, conflictos e incertidumbre | Validación y adopción del equipo; proveedor y entrega real en PDGLD-119 |

## Interpretación de la evidencia

`.221` de interfaz es `118e2026-1106-4a18-8a15-000000000221`: aprobó HTTP/SQL
PG15, pero falló la preparación UI. `.230` es `118e2026-1106-4a18-8a15-000000000230`:
UI PG15 y API/UI PG17 aprobadas. No confundirlo con el run-id histórico de
identificadores `118a2026-1105-4e18-8a15-000000000221`, que incluye PATCH email
retirado. El flujo vigente de email se acredita por .203/.204/.236.

`.237` (`119e2026-1107-4a18-8a15-000000000237`) acredita reset integrado con
transporte simulado en copia desechable; `.238` (mismo prefijo terminado en 238)
solo acredita la regresión concurrente del cambio de contraseña. Ambas versiones
aprobaron y limpiaron; ninguna demuestra correo real. CI #144 falló por contrato
HTTP de concurrencia y #145 por activación inmediata de Chrome; fueron corregidos,
sin debilitar las pruebas, antes del CI #146 aprobado.

No se repiten las matrices completas. No hay consultas reales CURP/INE, correo
real ni acceso a base habitual/Supabase en esta revisión. Los artefactos originales
permanecen fuera de Git; solo se documentan resultados saneados.

## Prueba faltante ejecutada: navegación .240

Comando: `node scripts/test-delegate-isolated.mjs --account-navigation --run-id
120e2026-1107-4a18-8a15-000000000240 --execute`.

| Versión | Prueba focalizada Chrome + NextAuth/backend/base reales | Limpieza |
| --- | --- | --- |
| PG15 | Aprobada | Verificada antes de iniciar PG17 |
| PG17 | Aprobada | Verificada al terminar |

Se comprobó enlace autorizado de Administración, `aria-current`, un único main,
URL directa, historial atrás/adelante, menú de 390 px, cierre al navegar,
Tab/Escape/Enter nativos y retorno de foco. Una cuenta sin permiso no ve el
enlace y la URL directa no presenta búsqueda. Escritorio: 1280 px. Identidades
sintéticas; ningún transporte ni envío de correo. No se pretende acreditar la
regresión completa de PDGLD-110 ni sus otros módulos.

El intento .239 (`120e2026-1107-4a18-8a15-000000000239`) falló al asignar el rol
del fixture sin contexto de actor/motivo exigido por auditoría; no alcanzó Chrome
ni inició PG17. Se corrigió solo el fixture y se usó el run-id nuevo .240.
El supervisor comprobó identidad nueva y puertos libres antes de iniciar;
servicios solo en loopback, tmpfs y copias/dependencias propias sin .env.
Limpieza independiente de ambos intentos: contenedores, redes, copias,
dependencias, perfiles y procesos propios ausentes; bind exclusivo en
55415/55417/56515/56517 disponible. Registros y booleanos originales fuera de Git,
en `/private/tmp/pdgld106-<run-id>/`; no se publican logs ni credenciales.

Controles complementarios: aislamiento/diagnóstico 40/40; lint de los archivos
afectados, sintaxis y `git diff --check` aprobados. No se modificó código de
aplicación ni se repitieron .221/.230, .236 o .237/.238. La publicación de esta entrega incluye únicamente la guía, esta matriz, la prueba
y los ajustes necesarios del perfil aislado. No incluye artefactos, documentos
internos, secretos ni configuración local. La selección y el CI del nuevo SHA
se registran en el PR #43 y Jira PDGLD-120.
