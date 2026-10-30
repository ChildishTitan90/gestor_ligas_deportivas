# PDGLD-106 — Cargos de representantes (parte de PDGLD-93)

Estado actualizado al 30 de octubre de 2026: SQL, alta HTTP/SSR, navegador real
y runtime Preview/RLS temporal aprobaron en PostgreSQL 15/17. La limpieza fue
verificada y las evidencias originales se archivaron privadamente fuera del repo.
El formulario PDGLD-107 está conciliado con develop/PDGLD-110. **PDGLD-108 sigue
incompleto**: no existe todavía reemplazo atómico autorizado, concurrencia de
reemplazos ni consulta de historial; quedan casos de prueba y decisiones de
facultades. Véase la [matriz por criterio](../validation/account-delegate-acceptance-matrix.md).
La migración solo se ejecutó en bases temporales exclusivas en estas validaciones.
La persona responsable confirmó que la migración nueva no se aplicó ni compartió;
solo se reescribe `20261028010000_pdgld106_delegate_positions`, aún sin seguimiento.
Las migraciones compartidas permanecen intactas.

## Restricciones y motivo

| Regla | Protección | Motivo |
| --- | --- | --- |
| Máximo un titular y un subdelegado simultáneos por club | Exclusión GiST club/cargo/intervalo | Cupos también en periodos futuros o finitos |
| Una cuenta no ocupa ambos cargos simultáneamente | Exclusión GiST club/cuenta/intervalo | Evita duplicados y cargos simultáneos de la misma cuenta |
| Cargo PRIMARY/DEPUTY solo en CLUB_DELEGATE con club/liga | CHECK y FK existentes | Perfil y ámbito coherentes; no crea roles ni permisos |
| Nuevas asignaciones explícitas | Trigger rechaza INSERT de delegado sin cargo y conocido→NULL | Impide nueva ambigüedad sin inferencias |
| Un legado no puede competir con una designación conocida | Tercera exclusión GiST | Regularización conservadora, incluso con concurrencia |

`user_roles.delegate_position` es `String?` en Prisma y texto con CHECK en SQL.
PRIMARY se presenta como Titular; DEPUTY como Subdelegado. NULL significa cargo
no identificado solo en delegados preexistentes; para otros perfiles no aplica.
No hay DEFAULT ni backfill. `users.person_id UNIQUE` se conserva; no se añade una
política de edición de personas. Generar el cliente Prisma es requisito normal
antes de ejecutar el backend/seed con el esquema nuevo. Se validó el esquema y se
generó el cliente con una configuración temporal sin datasource ni carga de .env;
esas operaciones fueron locales y no conectaron una base.

Los tres índices usan `tstzrange(starts_at, ends_at, '[)')`: inicio incluido,
fin excluido y NULL como fin abierto. Se mantiene el CHECK de fin mayor al inicio.

## Legados y concurrencia declarativa

La tercera exclusión compara club con `=`, periodo con `&&` y la expresión
`CASE WHEN delegate_position IS NULL THEN 0 ELSE 1 END` con `<>`. Se limita al
UUID real de CLUB_DELEGATE, resuelto durante la instalación e incorporado como
literal al predicado. No consulta roles mediante una función marcada IMMUTABLE.
`btree_gist` ya está previsto en el baseline y [admite el operador
<>](https://www.postgresql.org/docs/15/btree-gist.html).

- Legado/legado: se conservan incluso duplicados históricos solapados.
- Legado/conocido: se rechaza cualquier solapamiento en el mismo club.
- Conocido/conocido: aplican las otras dos exclusiones.

La migración no infiere cargos por fechas ni modifica periodos/auditoría previos.
El motor de permisos mantiene sus lecturas, facultades y propiedad de solicitudes.
Los legados continúan autorizando con las reglas actuales hasta una decisión
explícita; NULL no les concede ni retira permisos adicionales.

No hay trigger de bloqueo global ni aislamiento obligatorio sobre user_roles.
La consulta de legados y la función SECURITY DEFINER anteriores se retiraron.
Las exclusiones son la protección final ante SQL directo y snapshots concurrentes.
Si A cierra un legado sin confirmar y B intenta ocupar ese periodo, B espera la
resolución del conflicto de índice. Con rollback de A, el legado sigue bloqueando;
con commit, B puede continuar si ya no se solapa. Una transacción con aislamiento
fuerte puede necesitar retry por serialización; jamás debe ignorarse el conflicto.

La suite aprobó en PostgreSQL 15/17 con READ COMMITTED, REPEATABLE READ y
SERIALIZABLE durante la ejecución aislada documentada.

## Identidad estable del perfil

El UUID del catálogo varía entre instalaciones. La migración lo lee bajo bloqueo
de instalación y lo fija en CHECK, predicado y argumentos constantes de triggers.
Un guard rechaza renombrar su código, cambiar su UUID o eliminar esa fila, incluso
si no tiene asignaciones. También impide TRUNCATE de roles: este borraría la
identidad fijada omitiendo los guards de fila. Es una protección del catálogo
necesaria para la validez de los predicados, no una prohibición general de editar
roles. Se permite cambiar su nombre visible y editar otros perfiles.

Los bloqueos advisory y de tablas de la migración existen solo durante su
instalación. No se añaden a cada sentencia ordinaria de la aplicación.

## Historial acotado y regularización

Se usa transaction_timestamp como instante estable para decidir si la asignación
ya tuvo efecto. No se decide el cargo por ese instante.

| Operación | Tratamiento |
| --- | --- |
| Corregir/cancelar una asignación futura | Permitido con auditoría; no moverla al pasado ni dejar un delegado ambiguo |
| Cambiar identidad, club, perfil, inicio o cargo conocido de una asignación efectiva | Rechazado: un reemplazo debe conservar la fila anterior |
| Cerrar una vigencia activa | Permitido desde el instante de la transacción en adelante |
| Extender/reabrir el fin de una asignación todavía activa | Permitido si las exclusiones lo permiten; no se prohíbe por defecto |
| Reabrir o cambiar el fin de una asignación ya vencida | Rechazado en el flujo ordinario: alteraría un periodo ya ocurrido |
| Borrar una asignación ya efectiva | Rechazado: cerrar y conservar; no se añade una prohibición general sobre otros perfiles |
| Clasificar un legado NULL | Permitido explícitamente si todo su intervalo satisface las exclusiones |
| Mantener NULL en un legado | Solo misma identidad/inicio y sin extender el periodo desconocido |

No se añade un bloqueo general de TRUNCATE a user_roles; los runtimes siguen sin
ese privilegio. Los cambios de filas reutilizan record_audit y exigen app.user_id
/app.reason. No hay doble auditoría. Una clasificación necesita evidencia sobre
todo el intervalo; si solo se conoce desde cierta fecha, cerrar el legado y crear
una fila nueva en una transacción. No promover al subdelegado ante una vacante.
Una corrección retrospectiva excepcional requiere un contrato posterior; no se
inventa una excepción administrativa dentro de este ticket.

## Contrato exacto para PDGLD-107

`POST /api/accounts` conserva su contrato y añade **delegatePosition en la raíz**:

```json
{
  "username": "representante.fixture",
  "email": "representante@example.test",
  "temporaryPassword": "Clave-Sintetica-48!",
  "person": { "firstName": "Persona", "paternalSurname": "Sintética" },
  "roles": ["CLUB_DELEGATE"],
  "leagueId": "11111111-1111-4111-8111-111111111111",
  "club": { "kind": "existing", "id": "22222222-2222-4222-8222-222222222222" },
  "delegatePosition": "DEPUTY"
}
```

El campo admite exclusivamente PRIMARY/DEPUTY. Obligatorio si roles contiene
CLUB_DELEGATE, prohibido si no lo contiene. No se admite NULL, valor vacío,
traducciones ni defaults. También se admite el club nuevo existente en el
contrato; el campo de cargo se mantiene en la raíz. Las vigencias del alta
conservan su semántica existente: desde ahora y sin fin. No se abre un contrato
de reemplazos o edición de vigencias con este endpoint.

El servicio conserva la autorización y transacción existentes, persiste el campo
y devuelve `assignments[].delegatePosition` (NULL para otros perfiles). No cambia
facultades del subdelegado ni propietario de solicitudes. PDGLD-107 ya implementa
la selección inicialmente vacía, errores y consulta de disponibilidad; su ampliación
opcional delegatePeriod se documenta en
[account-delegate-provisioning.md](account-delegate-provisioning.md). El recorrido
HTTP/SSR de esta ampliación aprobó en 15/17 durante su ejecución aislada autorizada. Se tratan los siguientes códigos. No integrar/desplegar el modelo aislado dejando
el formulario actual de delegados habilitado e incompatible.

| HTTP | Código |
| --- | --- |
| 400 | DELEGATE_POSITION_REQUIRED: falta selección |
| 400 | INVALID_DELEGATE_POSITION: valor o perfil incompatible |
| 400 | INVALID_CONTEXT / VALIDATION_ERROR: resto de validaciones |
| 409 | DELEGATE_POSITION_OCCUPIED |
| 409 | DELEGATE_ACCOUNT_OVERLAP |
| 409 | DELEGATE_LEGACY_OVERLAP |

La traducción SQL exige SQLSTATE y constraint identificados; no convierte todo
error en duplicado de cuenta ni expone SQL/details. Incluye pg, meta de consultas
raw y causas del adaptador Prisma 7. El error P2002 de identificadores de cuenta
mantiene su tratamiento previo. La integración del adaptador para el alta fue verificada por HTTP/Prisma
en PostgreSQL 15/17 y nuevamente bajo runtime limitado. Las pruebas puras cubren
las formas de error previstas; no acreditan los servicios de reemplazo ausentes. La suite SQL aislada usa pg directamente.

## Orden de bloqueos y retries

El alta sigue tomando primero lockAuthorization exclusivo; después reautoriza,
bloquea identidades/contextos y escribe. Lecturas normales conservan el bloqueo
compartido. No elevar compartido a exclusivo después de bloquear filas. Las
escrituras de autoridad usan primero el exclusivo, luego filas en orden estable
y finalmente las escrituras sujetas a exclusiones. SQL directo no sustituye el
protocolo de autorización de los servicios, aunque las exclusiones sí mantienen
la integridad del modelo sin cooperación del llamador.

Un orden inverso de filas o de advisory/fila puede producir deadlock. PostgreSQL
revierte una transacción; un retry autorizado debe rehacerla completa y revalidar
permisos. Los conflictos 23P01 son conflictos de negocio, no motivos para reintentar
indefinidamente. Esta entrega no añade retries automáticos al alta no idempotente.

## Seeds, fixtures y Preview

Los cargos sintéticos están declarados explícitamente en seed-demo-data y se
persisten al crear. El marcador existente del seed evita reclasificar instalaciones
anteriores. Los fixtures de cuentas/afiliaciones/inscripciones/firmas incluyen cargo;
los dos representantes del mismo club usan PRIMARY/DEPUTY y una cuenta restringida
adicional usa otro club. Los fixtures de vigencia cierran y crean filas separadas
sin reescribir periodos efectivos. La limpieza de catálogo y la prueba de repetición
del seed cierran asignaciones en lugar de borrar el historial.

PDGLD-106 añadió solo `delegate_position` a INSERT de user_roles. PDGLD-107 añade
además INSERT de ends_at para su contrato explícito de periodos finitos; no se añade
UPDATE ni DELETE. Las pruebas puras fijan esa lista cerrada. Si más adelante
se habilitan reemplazos, sus privilegios requerirán justificación independiente.

## Comprobaciones y entrega

Pruebas puras: `npm run test:ci`, `npm run test:account-form`.
Estáticas: `npm run typecheck`, `npm run lint`, comprobación de sintaxis de fixtures
y diff. Estas comprobaciones estáticas/puras no ejecutan seeds/migraciones. La
validación PostgreSQL se ejecutó posteriormente solo en contenedores exclusivos.

`npm run test:delegate-model` es una entrada PostgreSQL **separada**, protegida por
PDGLD106_EXCLUSIVE_TEST_RUN=1 y PDGLD106_TEST_DATABASE_URL hacia una base padre
pdgld48_test_<16hex> en loopback 5432/5433. Estos valores deben suministrarse desde
un supervisor exclusivo; por sí solos no prueban aislamiento de la instancia.
No carga .env ni inicia Next.js, y no se descubre en el runner habitual. La suite
compartida se ejecutó desde el supervisor exclusivo, no desde esta entrada manual. `scripts/test-auth.mjs` conserva exactamente su funcionamiento anterior.

El supervisor separado ya está implementado como `npm run test:delegate-isolated`.
Su modo plan no accede a Docker; --execute requiere autorización previa de la
ejecución concreta. El flujo habitual permanece sin cambios. Destinos, efectos,
limpieza y recuperación se detallan en
[PDGLD-106-runner-aislado.md](PDGLD-106-runner-aislado.md). PostgreSQL 15/17 aprobados;
La integración HTTP/SSR, Chrome y runtime RLS/Preview temporal de PDGLD-107
aprobaron en 15/17. Pendientes: criterios abiertos de PDGLD-108, revisión humana
visual/accesible, revisión independiente y CI remoto; véase la matriz citada.
