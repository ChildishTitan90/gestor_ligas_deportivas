# PDGLD-38/95 — Datos e integración con la interfaz de Vic

29/10/2026. Guía para coordinar con el borrador PR #36, PDGLD-114, head f27fa588.
Propuesta de presentación: no implementa vistas ni asigna tareas nuevas a Vic.
PDGLD-95 conserva las pantallas de competencias; la estructura compartida y los
componentes comunes se coordinan con PDGLD-110/114/115.

## Base compartida

Cuando se integre el PR #36, ubicar gestión en `(management)` y reutilizar su
layout/sidebar, navegación por capacidades, tokens, temas, AccountMenu y salida.
Conservar las URL y evitar otro AccountHeader/main dentro del shell. La pantalla
provisional de temporadas y su enlace del panel deben adaptarse entonces. No
integrar el borrador únicamente para copiar su apariencia.

## Tabla de pantallas y componentes

| Operación | Datos visibles o editables | Presentación propuesta | Servidor actual y pendiente |
| --- | --- | --- | --- |
| Listado de temporadas | Liga, nombre, inicio, fin, estado y versión | Página con listado y acceso al detalle | Consulta lista. Paginar/filtrar si el volumen lo exige; no inventar métricas |
| Crear temporada | Liga autorizada, nombre, fecha inicial y final | Modal breve o formulario de página si la revisión lo requiere | Alta PLANNED lista; estado/versión se asignan en servidor |
| Editar/cerrar temporada | Datos actuales, motivo y confirmación de cierre | Página y confirmación contextual | Servicio de edición/cierre aún pendiente; no mostrar botones operativos |
| Catálogo de categorías | Liga, nombre | Listado con modal breve de alta | GET/POST listos; edición/eliminación pendientes |
| Agregar categoría a una edición | Temporada de contexto, categoría, versión de reglamento, orden y tipo OPEN/YOUTH/VETERANS | Modal breve; selector de reglamento con número y estado | GET/POST listos. Mostrar elegibilidad pendiente; no solicitar edades o corte de PV-04 |
| Convocatoria y parámetros | Texto, puntos por victoria/empate/derrota, desempates ordenados, vueltas, duración y motivo | Página extensa con secciones; conservar orden de desempates | Consulta/alta de versiones DRAFT listas. Aprobación y aplicación pendientes; no presentarlas como activas |
| Listado de grupos | Temporada y categoría como contexto; nombre de cada grupo | Sección de la página de categoría | GET listo |
| Crear/renombrar grupo vacío | Nombre y motivo | Modal breve reutilizable | POST/PATCH listos; duplicados o referencias rechazan la operación |
| Eliminar grupo vacío | Nombre, temporada, categoría y motivo | Confirmación contextual | DELETE listo solo sin referencias; usar UPDATE de competitions, no inventar permiso DELETE |
| Elegir formato | Tabla general / fase de grupos por categoría de la edición | Sección de configuración | Persistencia y servicio pendientes. No mostrar selección que aparente guardarse |
| Distribuir equipos | Categoría, equipos inscritos pendientes, grupos y resultado de asignación | Página con listado, no formulario completo dentro de un modal pequeño | Pendiente adaptación de inscripción y asignación autorizada; delegado no elige grupo |
| Validar elegibilidad | Estado pendiente y requisitos confirmados | Indicador ahora; formulario tras PV-04 | Pendiente decisión del profesor y servicio de configuración/validación |

El tipo OPEN/YOUTH/VETERANS lo proporciona el operador; no se deduce del nombre.
La versión de temporada y los UUID viajan internamente desde el contexto leído,
no son campos que deba teclear la persona. Mostrar etiquetas/nombres de liga,
temporada, categoría y reglamento; no usar UUID como texto principal.

## Contratos disponibles

- Temporadas: `getSeasonWorkspace`, `createSeason` y Server Action del módulo.
- Catálogo: GET/POST `/api/competitions/categories`, consulta con `leagueId`.
- Participación: GET/POST `/api/competitions/seasons/{id}/categories`.
- Reglas: GET/POST `/api/competitions/seasons/{id}/configuration`.
- Grupos: GET/POST/PATCH/DELETE
  `/api/competitions/seasons/{id}/categories/{participationId}/groups`.

Detalles: [categorías](../architecture/competition-categories.md),
[reglas](../architecture/competition-configuration.md) y
[grupos](../architecture/competition-groups.md).

Las respuestas de grupos incluyen id/name; la escritura agrega seasonVersion y
deleted. POST requiere name/reason/expectedSeasonVersion; PATCH agrega groupId;
DELETE recibe groupId/reason/expectedSeasonVersion. Contexto siempre desde la
selección autorizada. Tras una operación volver a consultar la temporada para
obtener la versión actual; tras un 409 no reenviar automáticamente sobre otra versión.

## Componentes comunes por coordinar

Modal con nombre accesible, foco contenido, Escape y retorno del foco; distinguir
cancelar de guardar, impedir doble envío y conservar los datos ante errores.
Compartir confirmación breve sin convertir los formularios extensos en modales.
Mostrar vacío, carga, acceso denegado, error de campo y conflicto de edición, en
claro/oscuro y móvil. La navegación y cada operación usan capacidades del servidor;
la ausencia de un botón no sustituye autorización. Evitar indicadores de actividad,
KPIs, aprobación o distribución con números o estados simulados.

Esta guía queda local. No se envió a Vic ni se comentó en GitHub/Jira.
