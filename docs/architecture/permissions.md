# PDGLD-55: catálogo inicial RF22 y reglas de contexto

## Fuente y alcance

Fuente: **ERS PROYECTO LIGAS DEPORTIVAS.pdf**, versión 0.1, sección 3.2.22.
Páginas físicas del PDF: 40 (RF22.1-9, leyenda y encabezados), 41 (once filas), 42 (Auditoría).
El encabezado impreso repite «Pág. 3»; las referencias del catálogo usan el índice físico empezando en 1.
SHA-256 del archivo revisado: `f788025a94585e8ae9298ad01af133258fa97adc3baccd7bab9c5ca0818b810a`.

La matriz se considera **aprobada exactamente como aparece**, según la instrucción del equipo, aunque el PDF conserve la palabra «propuesta». No se plantea reemplazarla ni aprobarla nuevamente.
La indicación posterior del profesor permite administrar sus concesiones: son configuración inicial, no autoridad permanente.

Este documento y `prisma/permissions-data.ts` entregan PDGLD-55. El motor es PDGLD-54 (Víctor) y su validación es PDGLD-56 (Karol). No implementan autorización ni instalación de datos.

## Representación y contrato para Víctor

`INITIAL_PERMISSION_GRANTS` contiene **127 entradas**, una por combinación de `roleCode`, `module`, `action`.
Cada entrada incluye `contextOnly` y `ersReference` con página, fila, columna, contenido y nota de origen.
Los saltos de línea de las celdas se normalizan; se conserva la separación relevante en `C* R`, `C U*` y `C R*`.

- C → CREATE; R → READ; U → UPDATE; A → APPROVE; P → PUBLISH.
- Guion: no se genera entrada. Una lectura no se infiere de una escritura.
- PostgreSQL acepta también IMPORT, pero RF22 no lo concede: **cero concesiones IMPORT**.
- No hay DELETE, comodines, herencia de «CRUD completo» ni excepción universal por SUPERADMIN.
- `PERMISSION_ROLE_CODES` incluye los 12 códigos oficiales de RF22.2 y del baseline.
- `PERMISSION_MODULES` fija los nombres de módulo y `DATABASE_PERMISSION_ACTIONS` enumera las seis acciones admitidas por PostgreSQL.
- La clave técnica del permiso es **`${module}:${action}`**, por ejemplo `competitions:CREATE`.
  La identidad de una concesión añade el rol: `roleCode + module + action`. No persistir una fila de permiso por rol.

Correspondencia con las tablas existentes:

| Campo del catálogo | Destino o uso |
| --- | --- |
| roleCode | Resolver `roles.code` a `roles.id`; no crear otro código equivalente |
| module, action | Resolver/crear `permissions` por su UNIQUE(module, action) |
| rol + permiso | `role_permissions.role_id, permission_id`, combinación única |
| contextOnly | `role_permissions.context_only`, enviar el valor explícito; el default SQL es true |
| ersReference | Trazabilidad en código/documentación; el esquema actual no tiene una columna para esta referencia |

Los datos no importan Prisma, no se conectan a una base y no ejecutan un seed. Víctor puede importar el catálogo para la instalación inicial. Su motor deberá consultar **los permisos vigentes en la base**, junto con las asignaciones de rol y el contexto del recurso. No debe consultar este array como fallback cuando una concesión ya no exista.

## Correspondencia de filas y módulos

Se conserva **un módulo por fila aprobada**, incluso cuando abarca varios RF. No crear aliases como `matches` y `scheduling` para los mismos permisos de RF05/RF09.

| Fila del ERS | RF | module |
| --- | --- | --- |
| Temporadas, categorías, reglas | RF08 | `competitions` |
| Clubes y equipos | RF01, RF21 | `clubs` |
| Jugadores | RF02 | `players` |
| Canchas | RF04 | `venues` |
| Programación y partidos | RF05, RF09 | `scheduling` |
| Cédula | RF03 | `match-reports` |
| Disciplina, recursos, bajas | RF06, RF14, RF10 | `discipline` |
| Cobranza | RF12 | `billing` |
| Arbitraje | RF11 | `refereeing` |
| Publicar en portal | RF16 | `portal` |
| Usuarios y roles | RF22 | `users` |
| Auditoría | RF19 | `audit` |

Los nombres identifican capacidades de autorización; no obligan a renombrar carpetas, tablas o rutas.
Por ejemplo, `clubs` comprende clubes y equipos; `discipline` comprende sanciones, recursos y bajas, cuyas reglas particulares siguen siendo obligatorias.

## Transcripción de control

Orden de las columnas del PDF:
SA = SUPERADMIN; PE = EXECUTIVE_PRESIDENT; SE = SECRETARY; TE = TREASURER;
DI = DISCIPLINARY_BOARD; AR = REFEREE_MANAGER (comisión); PR = SCHEDULER;
DE = CLUB_DELEGATE; RE = REFEREE (árbitro); CA = DATA_ENTRY; JU = PLAYER.

| module | SA | PE | SE | TE | DI | AR | PR | DE | RE | CA | JU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `competitions` | CRUA | RA | R | R | R | R | R | R | - | - | - |
| `clubs` | CRUA | RA | CRUA | R | R | R | R | CRU\* | - | R | - |
| `players` | CRUA | R | RUA | R | R | R | R | CRU\* | - | R | R\* |
| `venues` | CRUA | A | R | - | - | - | CRU | C\* R | R | R | - |
| `scheduling` | RA | RA | R | - | R | R | CRU | R | R\* | R | - |
| `match-reports` | R | R | R | - | R | R | R | R\* | C U\* | CU | - |
| `discipline` | R | RA | R | - | CRUA | R | R | C R\* | - | - | R\* |
| `billing` | R | R | R | CRU | - | - | - | R\* | - | - | - |
| `refereeing` | R | R | R | - | - | CRUA | RU | - | R\* | - | - |
| `portal` | P | AP | P | - | C | - | C | - | - | - | - |
| `users` | CRUA | - | - | - | - | - | - | - | - | - | - |
| `audit` | R | R | R | - | - | - | - | - | - | - | - |

Notas que acompañan las letras, conservadas también en `ersReference`:

- `discipline / EXECUTIVE_PRESIDENT`: «R A (bajas)». APPROVE se limita a bajas, no a resolver sanciones o recursos.
- `refereeing / SCHEDULER`: «R U [PV]». Se conservan READ y UPDATE; [PV] no borra ni amplía esas asignaciones.
- `portal / SECRETARY`: «P (revisa)». Se conserva PUBLISH, **no se sustituye por APPROVE ni se añade READ**.
- `portal / DISCIPLINARY_BOARD`: «C (castigados)». CREATE se refiere a ese contenido.
- `portal / SCHEDULER`: «C (propone)». CREATE permite proponer, no publicar.

GUEST está en RF22.2, pero no tiene columna en la tabla. Se conserva el código con **cero concesiones administrativas**, coherente con RF18.8: acceso público sin cuenta. No se inventa READ sobre estos módulos para representar el portal público.

## Asteriscos y límites de asignación

`contextOnly` transcribe la marca del grupo de letras:
`CRU*` da true en CREATE, READ y UPDATE; `R*` da true en READ.
En celdas mixtas se conserva la posición visible:
`C* R` → CREATE true / READ false;
`C U*` → CREATE false / UPDATE true;
`C R*` → CREATE false / READ true.

Esta convención conserva la evidencia literal; **false nunca significa acceso global**.
RF22.5 impone contexto a CLUB_DELEGATE, REFEREE y PLAYER, también en sus letras sin asterisco.
Así, CREATE de cédula sigue exigiendo partido designado, y CREATE de recurso sigue limitado al club.
La leyenda no formaliza si un asterisco final afecta todas las letras separadas de una celda; esa precisión técnica queda registrada abajo, sin cambiar las acciones ni permitir acceso universal.

Todo permiso se intersecta con el alcance de la **misma asignación** vigente en `user_roles`.
No combinar el permiso de un rol en liga A con el contexto de otro rol en liga B.
Ausencia de asterisco tampoco elimina `league_id`, `club_id`, la vigencia, la relación con el recurso ni las reglas de negocio.
Una identidad con varios roles puede tener varias vías válidas de autorización; cada vía debe demostrar por sí sola permiso y contexto.

## Relaciones que debe comprobar el motor

Las relaciones se resuelven en servidor, nunca se aceptan como autorizadas por venir en el cuerpo de la petición.

| Contexto | Relación con el esquema actual |
| --- | --- |
| Liga | Comparar `user_roles.league_id` con la liga real del recurso: directa en `clubs`/`venues`, por `seasons.league_id` para recursos de temporada, o por el padre correspondiente. Verificar coherencia entre todos los padres. |
| Club del delegado | Comparar `user_roles.club_id` con el club del recurso y su liga. Equipos: `teams.club_id`; inscripciones: `player_registrations → season_teams → teams.club_id`; cobros: `charges.club_id`. Para partidos/cédulas, verificar participación de su equipo local o visitante mediante `season_teams`. El acceso al partido no abre los expedientes privados de todo el rival. |
| Cancha del delegado | CREATE en su liga y con `venues.owner_club_id` correspondiente a su club. Para una propuesta todavía sin fila, verificar el padre autorizado y fijar la relación desde servidor. La lectura de canchas compartidas requiere resolver el punto específico indicado abajo. |
| Partido designado del árbitro | `users.person_id → referees.person_id → referee_assignments.referee_id`, con el `match_id` del recurso/cédula y su liga. Comprobar vigencia efectiva de la designación; una fila revocada no habilita acceso. Tener REFEREE o conocer el UUID no es suficiente. |
| Información propia del jugador | `users.person_id = player_registrations.person_id`; documentos, sanciones y recursos deben enlazar a esa persona/inscripción. PLAYER no abre datos de otros jugadores del mismo club. |
| Disciplina del delegado/jugador | Seguir el vínculo real del expediente, sanción, recurso o baja a club/inscripción/persona, según el actor. No basta coincidir en liga. |
| Arbitraje del árbitro | Identidad `users.person_id = referees.person_id` y designación del partido cuando corresponda. Disponibilidad y otros datos personales se limitan a su propia identidad. |

Si un recurso no permite demostrar la relación requerida, no autorizarlo por defecto.
Una asignación sin liga/club no se convierte automáticamente en global para cualquier rol.
Para SUPERADMIN con asignación global, sigue siendo necesario el permiso vigente y las reglas de separación de funciones. Las operaciones globales de usuarios/auditoría deben distinguirse de datos acotados a una liga; el motor debe expresar ese alcance, no inferirlo de `contextOnly=false`.

## Vigencias y separación de funciones

RF22.3 y RF22.7: roles y cargos pueden tener periodos; el cargo no sustituye la comprobación del rol realmente asignado.
Contrato temporal: `starts_at <= ahora` y `ends_at IS NULL OR ahora < ends_at`, usando tiempo del servidor; fin exclusivo y sin asumir que una asignación futura ya habilita acceso.
También comprobar cuenta activa, sesión operativa y vigencia del vínculo específico (club, designación, etc.).

RF22.6 impone restricciones sobre la operación concreta aunque exista la concesión:

- DATA_ENTRY digitaliza cédulas y no resuelve sanciones; conservar esa separación al combinar roles.
- Quien propone una programación no la publica; comparar autor y actor de esa operación.
- Quien crea un cobro no lo aprueba como pagado sin registro de pago. No inventar APPROVE para TREASURER: la fila concede CRU.
- RF23.2 exige también que el redactor no publique su propio comunicado.
- RF03.8 limita correcciones de cédulas confirmadas al proceso autorizado, con motivo y auditoría: UPDATE no elimina esa condición.
- RF22.8 exige conservar al menos un SUPERADMIN activo; RF22.9 exige auditar cambios de roles y permisos.

La tabla plana `role_permissions` no expresa «solo bajas», «solo castigados» o autor distinto del publicador.
Víctor debe conservar esas condiciones en la política de la operación; un resultado favorable de la búsqueda rol/permiso es necesario, pero no suficiente.

## Instalación inicial y administración posterior

Ejemplo del profesor: SUPERADMIN empieza con CRUA en RF08 (`competitions`).
Si se retira `competitions:CREATE`, quedan READ, UPDATE y APPROVE para ese rol.
No mantener un bypass de SUPERADMIN ni restaurar CREATE desde el catálogo al resolver una petición.

El futuro instalador debe distinguir instalación inicial de repetición mediante **evidencia persistente de inicialización/versionado**.
No basta `upsert`/«crear si no existe» para cada concesión: una fila ausente puede haber sido retirada deliberadamente.
Tampoco basta detectar que la tabla está vacía: podría ser una decisión administrativa o un estado que requiere revisión.

En una instalación explícitamente nueva se podrán insertar las 127 concesiones en una transacción, registrando la inicialización junto con ellas.
En ejecuciones posteriores no sobrescribir `context_only` ni recrear concesiones eliminadas.
Las ampliaciones de versiones futuras requieren una operación explícita, revisada y auditada que preserve decisiones administrativas.
El mecanismo persistente concreto y su instalación pertenecen a la integración de Víctor; **este catálogo no añade runner, marcador ni migración**.
El esquema actual permite concesiones por rol, no excepciones individuales por usuario; no confundir la administración de permisos con la asignación de roles a una persona.

## Precisiones técnicas pendientes (sin reabrir la matriz)

Las celdas son legibles. Se conserva su asignación; quedan estas decisiones para integrar políticas:

1. **Asteriscos mixtos** (`C U*`, `C R*`): el catálogo conserva literalmente los grupos marcados. Precisar si el motor desea además materializar RF22.5 en `context_only`; nunca ampliar el acceso de las letras sin marca. Las acciones ya están definidas.
2. **RF04 / delegado / READ**: `C* R` no especifica la relación de lectura con canchas compartidas o prestadas frente al límite de club de RF22.5. Definir qué relación existente (propiedad, asignación de localía o préstamo vigente) habilita esa lectura, sin conceder acceso universal.
3. **RF11 / SCHEDULER / R U [PV]**: precisar qué operaciones de arbitraje cubre UPDATE y el alcance operativo de la nota [PV]; READ y UPDATE permanecen concedidos.
4. **RF16 / SECRETARY / P (revisa)**: precisar cómo se integra la revisión con el flujo de publicación; no reinterpretar la P aprobada.
5. **Árbitro designado**: RF22.5 no enumera estados de `referee_assignments` válidos para operar. Precisar cuándo una propuesta/aprobación constituye designación efectiva y su ventana temporal; no equiparar automáticamente «distinto de REVOKED» con designación autorizada.
6. **RF23/RF24 fuera de las filas de RF22**: los textos describen creación de comunicados e importación, pero esta matriz no contiene esas concesiones adicionales. No añadir CREATE o IMPORT por analogía. Su correspondencia operativa requiere tratamiento separado al implementar esos RF.

## Comprobación de esta entrega

Revisión visual de las páginas 40-42 y contraste independiente con las celdas extraídas del PDF.
Se verifican los 12 códigos contra el baseline, 12 módulos únicos, 127 concesiones sin duplicados,
acciones permitidas por PostgreSQL, ausencia de IMPORT/GUEST y correspondencia de letras, asteriscos y notas.
Comprobación de tipos y lint del archivo de datos, sin ejecutar seed ni conectar una base.
Estas comprobaciones del catálogo no sustituyen las pruebas del motor de PDGLD-56 ni declaran terminada la autorización.

