# PDGLD-118 — primera entrega: consulta y estado de cuentas

Implementación de backend; pantallas, edición de identidad y restablecimiento no
forman parte de esta entrega. Complementa PDGLD-117 sin duplicar el alta,
PDGLD-36 (roles) ni PDGLD-93 (cargos y vigencias). No borra personas o referencias.

## Autorización y datos

Se exige identidad operativa del servidor y permiso existente `users:READ` para
consulta o `users:UPDATE` para estado, global, sin liga/club y no context_only.
No se agregan permisos ni basta una concesión parcial, aunque el destinatario
tenga alguna asignación en ese ámbito. DTO exclusivo: `id`, `username`,
`isActive`, `revision`. Sin correo, datos deportivos, nombres, roles, cargo,
contraseñas o sesiones. La búsqueda es por nombre de usuario, literal y sin
comodines, insensible a mayúsculas. No se exponen personas sin cuenta aquí.

## Contratos HTTP

Todas las respuestas usan `Cache-Control: private, no-store`.
El GET `/api/accounts` conserva exclusivamente las opciones del alta existente.

- GET `/api/account-maintenance?page=1&pageSize=20&search=texto`:
  `{items: Account[], page, pageSize, total}`. Página 1..100000, tamaño 1..50,
  búsqueda hasta 100 caracteres; orden estable por usuario e id. Rechaza
  parámetros desconocidos o duplicados. Lista y conteo comparten snapshot.
- GET `/api/account-maintenance/:accountId`: un Account o 404.
- PATCH `/api/account-maintenance/:accountId/status`, JSON del mismo origen:
  `{isActive: false, expectedRevision: 0, reason: "Motivo administrativo", confirmed: true}`.
  Devuelve Account con revisión incrementada. Motivo recortado de 10..300
  caracteres, sin datos sensibles; límite de cuerpo de 4096 bytes. No admite
  roles, cargo, contraseña, identidad ni versión de sesión en el cuerpo.

Errores: 400 VALIDATION_ERROR/INVALID_PAYLOAD; 401 UNAUTHENTICATED;
403 FORBIDDEN/INVALID_ORIGIN (o restricción de sesión existente);
404 ACCOUNT_NOT_FOUND; 409 ACCOUNT_CHANGED, ACCOUNT_STATE_UNCHANGED,
LAST_ACTIVE_SUPERADMIN, LAST_EFFECTIVE_SUPERADMIN o
SUPERADMIN_AVAILABILITY_DECISION_REQUIRED; 413 PAYLOAD_TOO_LARGE;
503 SERVICE_UNAVAILABLE. Un error inesperado no devuelve el diagnóstico interno.

## Concurrencia, auditoría y sesiones

La migración NUEVA `20261103010000_pdgld118_account_maintenance` añade
`users.maintenance_revision`, entero no negativo, NOT NULL, predeterminado 0.
No modifica migraciones publicadas ni datos de roles. Se necesita un token
persistente para detectar dos cambios sobre el mismo estado; `users.version`
es una generación de credenciales/sesiones y no debe reutilizarse para ello.

La escritura toma primero el bloqueo exclusivo de autorización RF22 existente,
autoriza dentro de la transacción y bloquea la cuenta. Comprueba revisión y
transición antes de escribir. Estado, revisión administrativa, incremento de
versión de sesión, revocación de TODAS las sesiones no revocadas y auditoría
se confirman o revierten juntos. La auditoría guarda actor, entidad, instante,
motivo y únicamente estado/revisión anterior/nueva. users no tiene trigger de
auditoría: se registra un evento explícito por transición exitosa.

También al reactivar se incrementa la versión y se revocan sesiones. No se
restauran cookies antiguas. No se borran ni editan persona, referencias,
solicitudes, firmas, asignaciones, cargos, vigencias o contraseñas.

Tras una respuesta incierta, consultar el detalle: una revisión distinta indica
que hubo un cambio, pero NO identifica por sí sola quién lo produjo. No mostrar
éxito atribuido ni reenviar automáticamente. No hay contrato de idempotencia o
recuperación por operación en esta entrega; requerir revisión humana si el estado
observado no permite resolver la incertidumbre.

## Último SUPERADMIN y decisión pendiente

Se distinguen:

1. Cuenta activa: users.is_active, independiente del bloqueo de acceso.
2. Asignación SUPERADMIN vigente: inicio incluido y fin excluido.
3. Autoridad de mantenimiento global efectiva del rol: READ y UPDATE de users,
   no context_only, en asignación global. El nombre del rol no concede permisos.
4. Disponibilidad operativa: sin bloqueo temporal ni cambio obligatorio.

Al desactivar una cuenta con SUPERADMIN vigente, debe quedar otra cuenta activa
con asignación vigente. Además debe quedar una con la autoridad global indicada.
Un SUPERADMIN limitado a una liga no es sustituto de autoridad global.

PENDIENTE de acuerdo humano: ¿un administrador temporalmente bloqueado o con
cambio obligatorio cuenta como alternativa suficiente para dar de baja al otro?
No se resuelve implícitamente: cuando solo quedan alternativas en esas condiciones,
se rechaza con SUPERADMIN_AVAILABILITY_DECISION_REQUIRED. Si hay otra alternativa
operativa, la operación independiente puede continuar. Es un cierre provisional
conservador, no una decisión final de negocio sobre esas dos condiciones.

Coordinación pendiente con PDGLD-36: aplicar la misma invariante a retirada/edición
de roles, permisos y periodos, y acordar vencimientos futuros que dejarían sin
administrador. Esta entrega serializa bajas concurrentes de ESTE servicio con el
bloqueo RF22; no promete protección universal ante SQL directo ni implementa un
trigger privilegiado para toda la gestión de roles. No hay eliminación definitiva.

## Pruebas y validación

El workflow de CI incluye `npm run test:account-maintenance` (sin servicios).
Pruebas puras de contratos, límites, revisión, estado repetido y distinción entre
actividad/asignación/autoridad/disponibilidad. Se amplía la prueba del supervisor
para el selector de mantenimiento, sin ejecutar Docker.

Suite integrada completa aprobada en PostgreSQL 15 y 17: lista/detalle mínimo, búsqueda literal,
GET del alta intacto, acceso sin permiso/parcial, motivo/confirmación, dos cambios
con la misma revisión, auditoría mínima, sesiones anteriores rechazadas incluso
tras reactivar, conservación de identidad/asignaciones, rollback provocado por
fallo de auditoría y bajas concurrentes de administradores.

La suite instala el catálogo existente mediante su instalador en la base vacía
desechable, sin seed dev/demo ni concesiones nuevas de producto. Los datos
sintéticos y la función/trigger de fallo solo viven en esa base. La destrucción
del contenedor es la limpieza final de fixtures y auditoría inmutable.

Comando de la ejecución aislada autorizada:

```sh
node scripts/test-delegate-isolated.mjs --account-maintenance --execute --run-id 118a2026-1105-4e18-8a15-000000000117
```

Reutiliza el supervisor existente: PG15 primero; PG17 solo tras aprobar y limpiar
PG15. Contenedores `pdgld106-<run-id>-pg15/17`, redes propias terminadas en `-net`,
postgres:15/17-bookworm, tmpfs sin volumen persistente ni montaje del repositorio,
768 MiB/2 CPU. PostgreSQL 127.0.0.1:55415/55417, Next/Turbopack
127.0.0.1:56515/56517. Bases `pdgld48_test_118a202611054e15/17` y reserva
`pdgld106_model_118a202611054e15/17`. Copias bajo `/private/tmp/pdgld106-<run-id>`
en macOS (`/tmp` en Linux), instalación independiente npm ci con lockfile existente,
scripts permitidos y prisma generate solo en la copia. Aplica migraciones SQL,
incluida la nueva, solo al PostgreSQL desechable.

Limpieza: detener procesos propios, cerrar conexiones, retirar bases/copias/cachés
npm de instalación y eliminar únicamente contenedores/redes identificados por
propiedad; conservar evidencia privada y resultado saneado maintenance-suite.json.
Verificar ausencia de procesos, listeners y recursos propios entre versiones y
al finalizar. Fallo de prueba o limpieza detiene la secuencia. Sin .env habitual,
Supabase, gestor_ligas_dev, Chrome o Preview/RLS.

## Integración posterior de pantallas y PDGLD-119

En PDGLD-120, añadir consulta a `(management)` y a getManagementNavigation usando
capacidad READ global del servidor, separada de Crear cuenta. Reutilizar
ManagementShell, SelectField y FormDialog, con estados de conflicto/confirmación
y recuperación incierta; cada entrada conserva su propia autorización.

PDGLD-119 requiere acordar quién verifica identidad, qué evidencia acepta, canal
y destinatario de entrega privada, caducidad, intentos y tratamiento de entregas
inciertas. No se emiten credenciales temporales ni se implementa recuperación
por correo (PDGLD-32) en este incremento.

## Comprobaciones locales de esta preparación

- Contratos puros de mantenimiento: 5/5; pipeline puro: 70/70; alta de cuentas:
  24/24; reglas de mantenimiento de clubes: 2/2. Lint y git diff --check aprobados.
- El plan del nuevo perfil se ejecutó sin --execute: no creó recursos.
- Typecheck completo aprobado en una copia temporal sin `.env`, con dependencias
  exactas del lockfile, Prisma 7.10.1 generado y rutas regeneradas mediante
  `next typegen`. Los 286 errores reproducidos en el workspace desaparecieron
  sin modificar código, versiones o tipos. El entorno original no se regeneró.
- Suite HTTP completa y migración nueva verificadas únicamente en PostgreSQL
  15/17 desechables. No se ejecutaron seeds dev/demo ni validación de Preview/RLS,
  Supabase o despliegue de producción. Se comprobaron la limpieza y los archivos
  protegidos. Véase el [informe saneado](../validation/account-maintenance-integration.md).
