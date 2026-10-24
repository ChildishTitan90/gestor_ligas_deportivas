# Inscripción y consulta de equipos — PDGLD-63

Primera entrega: componente presentacional de consulta y modelo de presentación.
No hay integración HTTP, formulario de inscripción ni página real conectada en esta
entrega. Los datos sintéticos existen únicamente en el archivo de pruebas.

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
conservar historial y estado inicial REGISTERED. Determinar cómo crear o reutilizar
el equipo permanente. Las respuestas deben exponer solo los datos necesarios.

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

Esta entrega solo implementa `TeamRegistrationList` y su modelo. No contiene
botones de activación, baja o edición, formularios, peticiones ni adaptador HTTP.

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

## Preguntas de integración pendientes

1. ¿El alta crea equipo e inscripción atómicamente, reutiliza un equipo existente
   o admite ambas opciones? ¿Quién genera la referencia y cómo se evita duplicar?
2. ¿Qué estado de afiliación permite inscribir? ¿Las categorías deben estar entre
   las solicitadas/aprobadas del club? ¿Qué temporadas admiten inscripciones?
3. ¿Qué entrada usará el servidor (servicio, Action o endpoint), con qué métodos,
   rutas si procede, campos y envoltorios? No hay endpoints acordados aquí.
4. ¿Cómo se obtienen clubes, temporadas, equipos reutilizables, categorías y grupos
   autorizados y relacionados? ¿Qué ocurre cuando una opción deja de ser válida?
5. ¿Qué respuesta distingue `teamId`, `seasonTeamId`, `categoryId` y
   `seasonCategoryId`? ¿Qué campos/capacidades recibirá la interfaz?
6. ¿Qué códigos/estados HTTP, si procede, distinguen validación, falta de sesión,
   acceso denegado, inscripción duplicada, grupo inválido y temporada cerrada?
7. ¿Qué mecanismo de reintento/idempotencia y consulta evita duplicar una
   inscripción cuando no puede confirmarse el resultado de un envío?
8. ¿Qué filtros, orden, paginación y permisos aplican a la consulta histórica?

Estas preguntas no son contratos confirmados ni autorizan implementar endpoints,
permisos, restricciones nuevas o reglas de activación.

## Verificación

`npm run test:team-registration-list` usa `node:test` y
`renderToStaticMarkup`, siguiendo los patrones existentes. Comprueba campos e
identidades, vacío, varias inscripciones del mismo equipo entre temporadas,
varios equipos en una temporada y traducción de los tres estados sin acciones.
Los fixtures solo se declaran en `team-registration-list.test.tsx`; ninguna página
real los importa. No se usa base de datos ni HTTP. Son pruebas de renderizado,
no de navegador, accesibilidad completa o integración con PDGLD-62.

También se ejecutan `npm run typecheck` y `npm run lint`. El nuevo comando no se
incorpora a CI en esta entrega; `test:ci` conserva sus controles existentes.
