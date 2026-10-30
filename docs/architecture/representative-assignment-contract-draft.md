# PDGLD-108 — Contrato de representantes pendiente de validación

Estado: **propuesta conservada, no aprobada y no implementada**. No autoriza
crear rutas, columna de versión, función SQL privilegiada, permisos o concesiones.
La implementación se mantiene bloqueada hasta resolver las decisiones señaladas.
No incluye la desactivación de cuentas de PDGLD-117.

## Alcance mínimo propuesto

- Consultar historial de representantes del club con autorización.
- Cerrar una asignación vigente y, opcionalmente, insertar un sucesor en la misma
  transacción, preservando cargo, ámbito y fecha final de la asignación original.
- Detectar cambios concurrentes, conservar actor/motivo/vigencias y correlacionar
  eventos de auditoría; cerrar sin promover automáticamente al subdelegado.
- Primera versión inmediata, con corte tomado de PostgreSQL; programación futura,
  corrección retroactiva y promociones compuestas requieren otro acuerdo.

Cerrar user_roles.ends_at no desactiva users.is_active, no cambia contraseña,
versión de cuenta o sesiones, y conserva los demás roles. Al corte deja de aportar
permisos esa asignación. Las referencias de solicitudes y firmas se conservan.

## Autoridad propuesta, no nuevas concesiones

| Operación | Comprobación propuesta |
| --- | --- |
| Historial detallado con actor/motivo | users:READ y audit:READ cubriendo club/liga; ratificar exposición de esos datos |
| Cierre | users:READ y users:UPDATE sobre el ámbito real de la asignación; decidir si UPDATE debe ser sin caducidad |
| Reemplazo | Lo anterior y assertCanGrantRole de CLUB_DELEGATE; conservar su exigencia actual de UPDATE sin caducidad y cobertura de facultades |
| Selección de cuenta entrante | Propuesta inicial: users:READ global mientras no exista una política validada de candidatos para administradores acotados |

El catálogo inicial concede users:READ/CREATE/UPDATE/APPROVE solo a SUPERADMIN.
El servicio debe comprobar concesiones vigentes en PostgreSQL, no el nombre del
rol ni la matriz inicial como fallback. Presidencia/Secretaría con audit:READ no
obtienen administración por ello. Titular, subdelegado o autoría de una solicitud
no conceden administración de asignaciones. No se amplían facultades pendientes.

## Rutas y cuerpos propuestos

| Entrada | Finalidad |
| --- | --- |
| GET /api/clubs/{clubId}/representatives/history | Historial paginado con campos mínimos |
| POST /api/clubs/{clubId}/representatives/{assignmentId}/replace | Cerrar e insertar sucesor |
| POST /api/clubs/{clubId}/representatives/{assignmentId}/close | Cerrar sin sucesor |

Reemplazo:

```json
{
  "expectedVersion": 3,
  "replacementUserId": "<uuid>",
  "reason": "Cambio autorizado de representante del club"
}
```

Cierre: expectedVersion y reason. Objetos estrictos; motivo de 10–500 caracteres.
Actor, cargo, liga y corte proceden del servidor. Escrituras con sesión operativa,
JSON, límite de tamaño y comprobación de origen. Respuestas private/no-store.

El historial propuesto contiene asOf, items y nextCursor; cada asignación incluye
ID, revisión, cargo, identidad mínima, vigencias, estado y eventos proyectados
(actor/motivo/fecha/correlación). Sin snapshots JSON completos, correo, CURP o
archivos. Los nombres serían etiquetas actuales; los IDs preservan identidad.
No se reconstruyen actores/motivos desconocidos de legados.

Reemplazo devolvería 201 con operationId, asignación cerrada y nueva asignación;
cierre devolvería 200 con operationId y asignación actualizada. Mostrar únicamente
las versiones y vigencias realmente persistidas. Todo esto sigue sin endpoint.

## Reglas y mecanismos sujetos a validación

- Cuenta entrante existente y distinta. Conservar cargo, club/liga y fin original;
  no extender automáticamente una vigencia finita.
- Rechazar origen futuro/vencido para estas operaciones inmediatas. Permitir cierre
  de legado conservando NULL; reemplazo ambiguo requiere regularización explícita.
- No cerrar el otro cargo del entrante para evitar un conflicto. Un DEPUTY vigente
  no pasa automáticamente a PRIMARY: siguen aplicando las exclusiones existentes.
- user_roles todavía no tiene versión. Se propuso añadir version con incremento
  ante UPDATE, mediante una migración nueva. **No se añadió columna ni trigger.**
- Reutilizar lockAuthorization exclusivo antes de guards compartidos, reautorizar
  y bloquear filas, comprobar revisión, elegir corte único y escribir en una
  transacción. Reutilizar el invariante del último gestor sin duplicar su lógica.
- Usar app.user_id, app.reason y app.correlation_id y los triggers de auditoría
  actuales: dos eventos por reemplazo y uno por cierre, sin duplicados manuales.
- Preview no permite hoy UPDATE de ends_at. La función SQL estrecha considerada
  requiere una revisión de propietario, search_path, EXECUTE y RLS. **No está
  autorizada ni implementada**, y no se amplía UPDATE general.

Errores propuestos: VALIDATION_ERROR/INVALID_PAYLOAD (400), códigos de sesión
existentes (401/403), FORBIDDEN/INVALID_ORIGIN (403), asignación no visible (404),
STALE_REPRESENTATIVE_ASSIGNMENT, ASSIGNMENT_NOT_CURRENT,
REPLACEMENT_ACCOUNT_UNAVAILABLE, LEGACY_CLASSIFICATION_REQUIRED,
LAST_PERMISSION_MANAGER y conflictos DELEGATE_* (409), SERVICE_UNAVAILABLE (503).
Los nuevos códigos tampoco constituyen un contrato implementado.

## Bloqueo de la cuenta entrante

Hay dos asuntos diferentes, ambos pendientes de resolver:

1. **Cuenta nueva cuando el cargo está ocupado.** POST /api/accounts crea cuenta
   y asignación juntas. No es un alta de cuenta vacía y puede fallar por el cupo
   ocupado antes del reemplazo. La propuesta mínima admite solo cuenta existente.
   Crear cuenta + cerrar + reemplazar atómicamente necesita un contrato adicional;
   no se asignará un rol provisional ni se cerrará primero la representación para
   sortear la restricción. La selección de cuentas ajenas con ámbito local requiere
   una política autorizada; conocer un UUID no autoriza reutilizarlo.
2. **Estado de seguridad del entrante.** La admisión de cuentas inactivas,
   locked_until vigente o must_change_password sigue siendo decisión pendiente.
   Los guards actuales del actor no definen automáticamente la elegibilidad del
   destinatario. Esta propuesta no reactiva, desbloquea, cambia contraseñas ni
   elimina la obligación de cambio del entrante; tampoco asegura que una
   asignación permita operar mientras la cuenta esté restringida.

## Recuperación de una respuesta incierta

- En el alta implementada actualmente, el formulario se detiene ante UNCONFIRMED;
  la disponibilidad de un cargo no prueba si se creó una cuenta concreta. No se
  debe prometer una consulta de estado ni un reintento idempotente inexistentes.
- El reemplazo/cierre propuesto aún no puede ejecutarse. expectedVersion sería
  control de concurrencia, **no garantía de recuperar la misma respuesta**.
- Cuando exista un contrato validado, tras timeout se consultaría estado/historial
  autorizado y se identificaría la operación confirmada antes de decidir un nuevo
  envío. No se actualizaría automáticamente expectedVersion para repetir una
  decisión obsoleta. Si no se puede determinar el resultado, mantenerlo incierto
  y escalar al responsable autorizado, sin declarar fallo ni éxito definitivo.
- Un mecanismo de reenvío idempotente y de consulta por clave estable necesita
  definición y persistencia propias. No se añade una tabla, ruta o facultad para
  resolverlo en esta tarea. Las recuperaciones ya existentes de afiliaciones con
  submissionKey no se generalizan a representantes.

## Decisiones abiertas y trabajo posterior

Ratificar autoridad temporal para cierre, lectura de motivos, candidatos en
ámbito local, estado admisible del entrante, alta de una persona nueva, herencia
de vigencia y recuperación idempotente. Después revisar seguridad de runtime,
contratos y pruebas de servicio/concurrencia/historial. Las facultades sobre
solicitudes y firmas conservan su comportamiento actual hasta decisión explícita.

Las [regresiones de reglas acordadas](../validation/representative-agreed-rule-tests.md)
son trabajo separado: no validan ni implementan este contrato pendiente.
