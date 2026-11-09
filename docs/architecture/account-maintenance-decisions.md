# PDGLD-118 — decisiones de Sergio y matriz de pendientes

Actualizado el 7 de noviembre de 2026 para las entregas de
[PR #43](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/43).
Las cuatro decisiones de negocio se confirmaron por instrucción humana de Sergio;
el usuario autorizó después conservar el correo anterior para login hasta confirmar
el nuevo. Esta regla ya no se presenta como propuesta pendiente.

## Decisiones confirmadas y estado de implementación

| Área | Decisión confirmada | Implementación y validación | Pendiente |
| --- | --- | --- | --- |
| SUPERADMIN | Solo respalda otro administrador que pueda operar; bloqueo temporal o cambio obligatorio no cuentan | Protección conservada; código/mensaje `LAST_OPERATIONAL_SUPERADMIN`; mantenimiento `.203` y Preview/RLS `.204` aprobados en 15/17 | Coordinar con PDGLD-36 cambios de roles/permisos/vigencias y revisar escritores ajenos al bloqueo RF22 |
| Cambio de correo | Nuevo pendiente hasta probar propiedad mediante enlace/código con vencimiento; no recuperación ni entrega de credenciales antes de verificar; aviso al anterior | Solicitud y confirmación por token aleatorio independiente, hash, uso único, reemplazo, auditoría y revocación atómicos; PATCH directo retirado; `.203` y `.204` aprobados en 15/17 | Transporte real, remitente verificado y plantillas; pantalla pública validada en `.236` |
| Login durante espera | Conservar el correo anterior hasta confirmar el nuevo, regla técnica autorizada por el usuario | HTTP/SQL 15/17 aprobados; confirmar no crea sesión ni modifica contraseña | Proveedor real; interfaz de gestión y confirmación ya integrada |
| Restablecimiento administrativo | Verificar solicitante por identidad o canal previamente registrado; registrar responsable/motivo; contraseña temporal por canal privado verificado; exigir cambio e invalidar sesiones; nunca entregar a correo nuevo sin verificar | Servicio/UI de PDGLD-119 con atestación explícita, credencial de un uso, versión privada, auditoría y ciclo `.237` aprobado en PG15/17 | Proveedor/remitente verificados, adopción humana del procedimiento y cuentas sin correo vigente verificado |
| Corrección de identidad | Solicitud del delegado con evidencia y aprobación administrativa; historial, CURP única, invalidación dependiente y reevaluación de habilitación | Decisión confirmada; identidad sigue rechazada por el PATCH de cuentas | Implementar en jugadores/personas con alcance sobre persona compartida, historial privado y reevaluación de todos los registros afectados |

Las entregas posteriores están documentadas en [confirmación pública](../validation/account-email-confirmation-ui.md)
y [restablecimiento administrativo](../validation/administrative-reset.md). No se
atribuyen sus resultados a las matrices históricas siguientes.

## Matriz de ejecuciones: entorno y resultados funcionales

| Perfil / run-id | PostgreSQL 15 | PostgreSQL 17 | Clasificación y limpieza |
| --- | --- | --- | --- |
| Mantenimiento `.201` | Bloqueado al crear recursos por socket Docker dentro del sandbox; sin pruebas funcionales | No iniciado | Fallo de entorno; limpieza recuperada y verificada |
| Preview/RLS `.202` | `npm ci` falló con ETIMEDOUT antes de pruebas funcionales/ACL | No iniciado | Fallo de preparación/red; limpieza verificada |
| Mantenimiento `.203` | Aprobado | Aprobado | Resultado funcional; limpieza verificada; no repetido para añadir el caso nuevo |
| Preview/RLS `.204` | Aprobado, incluido el caso nuevo de solicitudes concurrentes | Aprobado, incluido el caso nuevo | Resultado funcional/ACL/RLS; limpieza verificada |

No se observaron fallos funcionales en las ejecuciones que alcanzaron las suites.
Los intentos bloqueados no cuentan como pruebas aprobadas ni como fallos del
producto. Los cuatro run-id quedaron consumidos. El transporte fue sintético;
ACCEPTED no acredita recepción o entrega real de correo.

Las pruebas locales sin servicios registradas son 25 de mantenimiento y 74 de
infraestructura. Lint y tipado completo aprobaron previamente; este último en
copia independiente sin `.env`, con Prisma y rutas regenerados y las dependencias
exactas del lockfile. El entorno original conserva sus tipos/dependencias previos.

## Contrato vigente y límites

Los contratos actuales están en [correo pendiente](account-email-change.md),
[identificadores](account-identifier-maintenance.md) y [estado de cuentas](account-maintenance.md).
Dos solicitudes con la misma revisión y claves distintas producen una aceptación
y un conflicto ACCOUNT_CHANGED. Reemplazar exige revisión actual y respetar el
límite temporal. El token sustituido no confirma; solo el vigente puede hacerlo.
El [caso integrado](../validation/account-email-request-concurrency.md) lo aprobó
con dos conexiones PostgreSQL realmente esperando RF22, bajo Preview/RLS 15/17.

La prueba de propiedad se persiste en la cuenta; los correos históricos no se
marcan verificados. El token EMAIL_CHANGE no autoriza login ni reset. Se reutilizan
primitivas de sesiones y hashes, no tokens/fila de password_resets para verificar
correo. La confirmación invalida resets anteriores sin usar. El adaptador de correo
es intercambiable y su conexión de aplicación permanece sin configurar: se devuelve
NOT_CONFIGURED y nunca el secreto al cliente.

Restablecimiento administrativo PDGLD-119, recuperación autoservicio PDGLD-32 y
corrección de identidad son contratos distintos. No basta users:UPDATE o editar
users.email para acreditar identidad o autorizar entrega. La corrección de identidad
debe conservar referencias y person_id, respetar unicidad PostgreSQL de CURP,
invalidar verificaciones CURP/INE/documentales por versión/fingerprint y reevaluar
habilitación; cambiar solo identity_version no implementa ese procedimiento.

También quedan fuera cancelación/reenvío explícitos, retención operativa de
solicitudes y tratamiento humano de entregas inciertas. La migración nueva no
queda autorizada para producción: requiere revisar su plan de seguridad. Las
pruebas temporales de Preview/RLS no acreditan Supabase real.

## Evidencia

[Resultados saneados y cronología](../validation/account-email-change.md),
[resultado estructurado](../validation/account-email-change-isolated-results.json)
y [solicitudes concurrentes](../validation/account-email-request-concurrency.md).
Los registros originales y manifiestos privados permanecen fuera de Git. La
publicación anterior incluyó código, migración nueva, pruebas, contratos,
resúmenes saneados y su [selección exacta](../validation/account-email-change-commit-plan.md).
