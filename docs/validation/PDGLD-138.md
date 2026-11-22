# PDGLD-138 — Ajustes y revisión de propuestas

## Alcance y estado

Evidencia local de la rama `feat/PDGLD-25-integracion`, creada desde el avance
guardado de PDGLD-85 (`b214fe4`), que incluye PDGLD-24 y la implementación de
PDGLD-25. Las ampliaciones de pruebas aún están sin commit ni push. La rama
contiene trabajo de PDGLD-85; antes de abrir el PR debe decidirse cómo integrar
esa dependencia y actualizarla con el `develop` vigente.

La aprobación operativa de una propuesta completa revalida el calendario y crea
los partidos y sus reservas. Enviar a revisión no crea partidos ni reservas.
No se debe confundir aprobación operativa con publicación en el portal público.

## Comprobaciones ejecutadas

| Caso | Evidencia local |
| --- | --- |
| Aprobación y reservas | La prueba de integración comprueba ausencia de partidos y reservas al enviar; creación al aprobar; reenvío sin duplicados; y reversión del estado, partidos y reservas cuando se provoca un error durante la creación. |
| Canchas y horarios | Se rechazan cancha bloqueada, horario fuera de disponibilidad y cancha ocupada. Se prueban préstamos pendientes o rechazados, las dos aprobaciones, ventana autorizada y cambio concurrente de autorización. |
| Intercambio de equipos | Se guardan los cruces ajustados, los encuentros modificados quedan sin cancha y horario y se rechaza reasignar una cancha bloqueada. |
| Permisos, versiones e historial | Se deniegan acciones a usuarios sin permiso; una versión antigua no se guarda; dos ajustes diferentes simultáneos producen un solo ganador. Se comprueba autor y motivo en ajustes, intercambio, envío, devolución y aprobación. |
| Separación con publicación | Enviar, aprobar y activar una propuesta aprobada previamente no crean filas en `publications`. Esto no verifica por sí solo una futura consulta pública. |

La suite `npm run test:scheduling:integration` pasó en PostgreSQL 15 y 17 con
bases y datos sintéticos. La versión más reciente, con los casos ampliados de
concurrencia, auditoría, devolución y ausencia de publicación, se ejecutó en
PostgreSQL 15; estos últimos casos aún no se han repetido en PostgreSQL 17.
El runner usa permisos SQL limitados en una parte de sus pruebas, pero no activa
RLS; no confundir ese resultado con la prueba de Preview.

`npm run test:scheduling:preview` pasó en PostgreSQL 15 con RLS activo y el rol
`gestor_ligas_preview`. La prueba verificó identidad y RLS, generación con
préstamos aprobados, consulta de opciones, ajuste, intercambio en transacción
revertida, denegación a un usuario ajeno, versión obsoleta, envío y aprobación.
Ejercita servicios y base reales, no una sesión HTTP ni el navegador. El
intercambio se revierte intencionalmente para continuar el resto del recorrido.
`npm run typecheck` pasó después de ampliar las pruebas de concurrencia e
historial. No se ha ejecutado CI de GitHub sobre esta versión.

## Dependencia de publicación — PDGLD-81, siguiente sprint

La [PDGLD-81](https://victoranhernandez.atlassian.net/browse/PDGLD-81) continúa
«Por hacer» y corresponde al flujo de publicación pública. Al implementarlo debe:

- Mantener separadas la versión y aprobación operativas de la versión pública.
- Comprobar en servidor la autoridad y que el proponente no publique su propia
  propuesta cuando aplique la separación de funciones; probar también llamadas
  directas sin permiso.
- Exponer a personas anónimas únicamente versiones publicadas y campos autorizados;
  comprobar que los borradores y las propuestas en revisión no aparezcan.
- Registrar los actores y versiones; probar retirada e invalidación de caché.

Estas reglas de publicación no están demostradas por la aprobación operativa y
quedan pendientes de la PDGLD-81. La ausencia de publicaciones en la prueba
local no sustituye esas comprobaciones.

## Pendiente para aceptación

- Realizar al final el recorrido en la aplicación con sesiones y permisos reales,
  desde el ajuste hasta la revisión y aprobación de la propuesta.
- Repetir las pruebas pertinentes sobre la versión final integrada, incluida la
  matriz PostgreSQL requerida; comprobar CI de GitHub cuando se suba la rama.
- Actualizar la referencia a `develop`, resolver la integración con PDGLD-85 y
  enlazar el PR y la evidencia. No marcar terminada la subtarea únicamente por
  estas pruebas locales.

Archivos de prueba: [integración](../../tests/integration/scheduling-adjustment-shared.ts)
y [Preview con RLS](../../tests/integration/scheduling-preview.test.ts).
