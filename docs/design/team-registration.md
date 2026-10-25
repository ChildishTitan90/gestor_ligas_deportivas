# Inscripción y consulta de equipos — PDGLD-63

Avance desde 91422ba: lista y formulario presentacionales con modelos de presentación.
No hay integración HTTP ni página real conectada en esta entrega. Los datos
sintéticos existen únicamente en archivos de pruebas.

## Requisitos confirmados de PDGLD-12

- Un club puede inscribir varios equipos en la misma temporada.
- Cada inscripción debe tener categoría y grupo válidos.
- Un equipo pertenece a un solo grupo por temporada.
- La inscripción comienza como INSCRITO, sin activación automática.
- Se conserva el historial de inscripciones de temporadas anteriores.
- La autorización se comprueba en servidor por permiso y contexto.

Son requisitos de la historia padre aportados por el equipo; no implican que todo
el backend esté implementado. Las reglas de inscripción y sus restricciones
corresponden a PDGLD-62 (Víctor). Las vistas corresponden a PDGLD-63.

## Modelos y restricciones existentes

Fuente: `prisma/schema.prisma` y el SQL de `prisma/migrations/0_init/migration.sql`.
Este análisis no ejecuta migraciones ni comprueba una base en vivo.

| Modelo | Relaciones y garantías existentes |
| --- | --- |
| `teams` | Identidad permanente del equipo: UUID, club, nombre y referencia única. Permite varios equipos por club. `UNIQUE(id, club_id)` respalda la relación compuesta desde la inscripción. |
| `season_teams` | Inscripción con UUID propio, equipo, club, temporada, grupo y estado. `UNIQUE(team_id, season_id)` impide dos inscripciones/grupos del mismo equipo en una temporada. No hay unicidad club/temporada: admite varios equipos. |
| `club_affiliations` | Única por club/temporada; la inscripción referencia esa pareja. La FK exige existencia, no estado de aprobación. |
| `groups` | Pertenece a `season_categories` mediante `(season_category_id, season_id)`. La inscripción referencia `(group_id, season_id)`, evitando grupos de otra temporada. |
| `season_categories` | Relaciona temporada, categoría y reglamento. Única por `(season_id, category_id)`. La categoría de una inscripción se obtiene a través del grupo. |
| `categories` | Catálogo por liga y deporte, con nombre único por liga/deporte. |
| `club_affiliation_categories` | Categorías solicitadas en una afiliación; no son equipos inscritos ni prueba de afiliación aprobada. |

Las claves compuestas también garantizan equipo/club y afiliación club/temporada.
No sustituyen la validación de liga/deporte, elegibilidad ni del estado exigido de
la afiliación. El backend debe verificar las relaciones pertinentes.

El CHECK SQL de `season_teams.status` admite exactamente `REGISTERED`, `ACTIVE` y
`WITHDRAWN`, con default `REGISTERED`. La interfaz traduce esos valores a
«Inscrito», «Activo» y «Retirado». Mostrar estados existentes no autoriza ni añade
transiciones. Inscribir no significa activar.

El mismo `teams.id` puede tener distintos `season_teams.id` en temporadas
diferentes. El modelo preserva esa separación y la lista no agrupa ni descarta
inscripciones por identidad del equipo. El baseline incluye el trigger
`season_read_only` sobre `season_teams`, que protege temporadas cerradas con su
mecanismo específico de correcciones autorizadas; no se modifica en este ticket.

## Responsabilidades

**PDGLD-62 — Víctor:** definir contratos de consultas/inscripción y opciones
filtradas; obtener identidad del servidor; validar permisos, alcance, relaciones y
reglas; garantizar atomicidad y concurrencia; traducir conflictos de restricciones;
conservar historial y estado inicial REGISTERED. Según la propuesta recibida, un
equipo nuevo y su inscripción se crearán en una única transacción de PDGLD-62.
Las respuestas deben exponer solo los datos necesarios.

El catálogo agrupa clubes y equipos en `clubs`: existen las acciones CREATE y READ.
Su correspondencia con cada operación debe integrarse con Víctor, sin crear un
permiso `teams:REGISTER` ni inferir autoridad de nombres de rol. El motor consulta
concesiones y asignaciones vigentes. `teamId` en el motor significa `teams.id`, no
`season_teams.id`; autorizar equipo+temporada presupone una inscripción existente,
por lo que Víctor debe elegir el contexto adecuado para el alta.

**PDGLD-63 — interfaz:** presentar inscripciones y estados, conservar identidades y
temporadas, y posteriormente implementar captura con opciones del servidor,
validación de campos, bloqueo de envíos duplicados y tratamiento de errores. No
duplicar reglas de negocio ni decisiones de autorización en el navegador.

Esta entrega implementa `TeamRegistrationList`, `TeamRegistrationForm` y sus
modelos/controlador de presentación. No contiene botones de activación, baja o
edición, peticiones ni adaptador HTTP.

## Presentación implementada

`team-registration-model.ts` define `TeamRegistrationItem` con `teamId`,
`seasonTeamId`, nombres de equipo/temporada/categoría/grupo y el estado existente.
Los campos sirven a la vista; **no son un DTO ni contrato HTTP confirmado**. El
futuro servicio o adaptador deberá mapear su respuesta y validar su contenido.

La lista recibe una colección de inscripciones ya seleccionadas y autorizadas por
quien la integre. Cada elemento conserva sus identificadores de equipo e
inscripción con etiquetas diferentes. No consulta, filtra, deduplica ni autoriza.
El vacío se refiere a la consulta seleccionada, no a la inexistencia global de
equipos. Usa lista y pares etiqueta/valor; tarjetas en móvil y columnas adaptables
en pantallas mayores, con salto de línea para nombres e identificadores largos.
Reutiliza los tokens existentes `surface`, `border`, `primary`, `muted` y `soft` y
los patrones de tarjetas y espaciado del proyecto. Los estados tienen texto y no
se comunican solo mediante color. No se introduce un control genérico innecesario.

## Propuesta recibida para integrar con PDGLD-62

Se contempla seleccionar un equipo existente o crear uno nuevo cuando el servidor
lo permita. Equipo nuevo e inscripción se crearán transaccionalmente en PDGLD-62.
El resultado inicial será `REGISTERED` («Inscrito»), sin activación automática.
Se conserva una inscripción y un único grupo por equipo/temporada.

Las siguientes **rutas son propuestas**, no contratos HTTP definitivos:

- GET `/api/team-enrollments/options`
- GET `/api/team-enrollments?clubId=...&seasonId=...`
- POST `/api/team-enrollments`

Éxito previsto del alta: HTTP 201. Errores previstos: 400/401/403/409 con código
controlado. No se han acordado aquí el cuerpo JSON exacto, los DTO de respuesta,
los nombres de códigos ni los parámetros de las opciones. No se implementa un
adaptador POST con estos supuestos.

## Formulario presentacional

`TeamRegistrationForm` recibe `TeamRegistrationFormOptions` y un callback async
`onSubmit`. Las opciones agrupan clubes, sus temporadas, equipos disponibles,
categorías y grupos. `canCreateTeam` es una capacidad de presentación por
club/temporada proporcionada por quien integre la vista con el servidor. No se
infiere del rol ni reemplaza la autorización del backend. Estos modelos anidados
son internos de UI, no el formato supuesto de GET `/options`.

Cambiar club limpia temporada, modo, equipo/nombre, categoría y grupo. Cambiar
temporada limpia todos sus dependientes. Cambiar modo o equipo limpia categoría
y grupo; cambiar categoría limpia el grupo. Actualizar las opciones elimina IDs
que ya no están disponibles y retira el modo nuevo si desaparece su capacidad.
Un grupo ajeno a la categoría/temporada nunca se conserva ni se entrega al callback.
El nombre solo se muestra y se requiere en modo nuevo; se descarta en modo existente.

La validación comprueba pertenencia a las opciones recibidas y nombre no vacío;
no decide reglas de elegibilidad, duplicados ni autorización. Cada error está
asociado a su campo y el envío inválido intenta enfocar el primero. Mientras el
callback está pendiente se bloquean cambios y envíos concurrentes, tanto en los
controles como en el controlador. El callback recibe una captura discriminada:
identificadores de ámbito/categoría/grupo y `team` existente por ID o nuevo por
nombre recortado. **No es el JSON del futuro POST**: no incluye estado ni activa
el equipo. El futuro adaptador mapeará esa captura al contrato confirmado.

El callback devuelve un resultado **tipado interno**, independiente del futuro
DTO HTTP:

- `confirmed`: el integrador confirma persistencia con `teamId`, `seasonTeamId` y
  `status: "REGISTERED"`. Solo entonces se muestra «Inscripción confirmada como
  Inscrito». Para equipo existente, la identidad confirmada debe coincidir.
- `correctable`: rechazo confirmado **sin creación**, con errores por campo
  opcionales. Conserva la captura y permite corregir y volver a enviar.
- `unconfirmed`: se desconoce el resultado. También se usa ante una excepción,
  respuesta ausente o confirmación incompleta/incompatible del callback.

Un resultado incierto bloquea nuevos envíos **y cambios de captura**; conserva los
valores y pide verificar la inscripción antes de reenviar. Cambiar opciones o el
callback no elimina ese bloqueo. No hay botón de reintento ni de desbloqueo ficticio.
La futura integración deberá consultar el estado real y solo preparar un nuevo
formulario cuando haya resuelto esa incertidumbre; refrescar props o volver a montar
la UI por sí solo no verifica persistencia. PDGLD-62 sigue siendo responsable de la
idempotencia. Una confirmación explícita también bloquea repetir esa inscripción en
la instancia actual. No hay activación automática.

El botón se deshabilita cuando faltan opciones indispensables de club/temporada,
equipo existente en ese modo, categorías o grupos. Se muestran avisos específicos
si no hay temporadas, categorías, equipos existentes o grupos. Una categoría sin
grupos no permite enviar aunque otra sí los tenga. «Crear equipo» permanece
seleccionable si la capacidad lo permite, incluso sin equipos existentes; el modo
nuevo no exige un equipo previo, pero sí categoría y grupo disponibles. La validación
del controlador también impide invocar el callback con selecciones incompletas.

Los errores HTTP, confirmación de persistencia y actualización de la lista siguen
pendientes del contrato de PDGLD-62. Este resultado interno no define códigos HTTP,
endpoints ni presume que todo callback resuelto equivalga a una escritura confirmada.

## Preguntas de integración pendientes

1. ¿Cuál es el cuerpo JSON exacto para equipo existente y nuevo? ¿Quién genera la
   referencia? ¿Cómo se distingue `teamId` de `seasonTeamId` en la respuesta 201?
2. ¿Qué estado de afiliación permite inscribir? ¿Las categorías deben estar entre
   las solicitadas/aprobadas del club? ¿Qué temporadas admiten inscripciones?
3. ¿Qué parámetros y DTO de respuesta tendrá GET `/options`? ¿Cómo se expresan
   capacidades, equipos reutilizables y relaciones categoría/grupo por ámbito?
4. ¿Qué ocurre cuando una opción deja de ser válida durante la captura o el envío?
   ¿El identificador de categoría enviado será `categoryId` o `seasonCategoryId`?
5. ¿Cuáles son los códigos controlados y errores por campo de 400/401/403/409?
   ¿Qué respuestas representan duplicado, grupo inválido o temporada cerrada?
6. ¿Qué mecanismo de reintento/idempotencia y consulta evita duplicar una
   inscripción cuando no puede confirmarse el resultado de un envío?
7. ¿Qué filtros, orden, paginación y permisos aplican a la consulta histórica?

La propuesta y estas preguntas no autorizan inventar payloads, endpoints
implementados, permisos nuevos, restricciones adicionales o reglas de activación.

## Verificación

`npm run test:team-registration-list` usa `node:test` y
`renderToStaticMarkup`, siguiendo los patrones existentes. Comprueba campos e
identidades, vacío, varias inscripciones del mismo equipo entre temporadas,
varios equipos en una temporada y traducción de los tres estados sin acciones.
`npm run test:team-registration-form` comprueba dependencias de selectores, ambos
modos, capacidad recibida/revocada, validación, falta de opciones, errores
corregibles y bloqueo persistente de resultados inciertos con el mismo
controlador de la vista y renderizado estático. No son clics DOM ni pruebas de
foco real en navegador.

Los fixtures solo se declaran en los archivos `team-registration-*.test.tsx`; ninguna página
real los importa. No se usa base de datos ni HTTP. Son pruebas de renderizado,
no de navegador, accesibilidad completa o integración con PDGLD-62.

También se ejecutan `npm run typecheck` y `npm run lint`. El nuevo comando no se
incorpora a CI en esta entrega; `test:ci` conserva sus controles existentes.
