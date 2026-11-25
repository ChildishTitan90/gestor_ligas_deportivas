@AGENTS.md

# Guía visual para agentes de desarrollo

Usa esta guía al trabajar en el Gestor de Ligas Deportivas desde Codex, Claude u otro agente. Mantén el alcance indicado por el equipo y las reglas de arquitectura, seguridad y pruebas del repositorio. [Instrucciones del proyecto](AGENTS.md)

## Antes de editar

1. Lee las instrucciones del proyecto. Si vas a tocar una ruta o un componente de Next.js, consulta la documentación de la versión instalada en `node_modules/next/dist/docs/`.
2. Localiza la entrada habitual de la pantalla, el rol que la usa, su contexto y el resultado que necesita. Revisa los componentes existentes, las pantallas que los comparten y el registro de decisiones antes de cambiar un estilo o comportamiento común. [Registro del refinamiento](docs/design/ui-ux-refinement.md)
3. Comprueba qué skills están disponibles y lee sus instrucciones antes de aplicarlas. Reutiliza las que ya estén instaladas. Si el agente no puede descubrir la skill local, abre directamente su `SKILL.md`.

| Skill | Cuándo usarla |
| --- | --- |
| [`ui-guardrails`](.agents/skills/ui-guardrails/SKILL.md) | En cada cambio de interfaz del proyecto. Recoge las reglas locales de orientación, avance, guardado y verificación. |
| `web-design-guidelines` | Para auditar accesibilidad, formularios, navegación y estados de interacción. |
| `impeccable` | Para revisar la claridad del recorrido, la jerarquía, el texto y la adaptación a cada tamaño. |
| `frontend-design` | Para refinar la composición visual respetando la identidad y los componentes ya aprobados. |
| `shadcn` | Solo cuando la tarea la requiera y shadcn/ui ya forme parte del proyecto. |

## Identidad visual y componentes

- Conserva Geist, Tailwind 4 y los tokens semánticos vigentes. Las acciones principales usan petróleo con texto blanco en claro y cobre con texto oscuro en oscuro. Las acciones secundarias conservan el contorno, el cobre distingue la navegación activa y la menta se reserva para estados positivos. Usa texto o iconos accesibles para reforzar los estados. [Temas y contraste](docs/design/color-themes.md)
- En gestión, reutiliza `ManagementShell`, su navegación autorizada y su encabezado de cuenta. Usa `ManagementPageHeader` cuando la vista necesite explicar su propósito, mostrar contexto o volver al origen. El modo claro, oscuro y sistema conserva el selector propio de la vista pública o del menú de cuenta. [Estructura de gestión](docs/design/management-shell.md) y [temas](docs/design/color-themes.md)
- Usa `ActionLink` o `primary-action` para la acción principal, `SelectField` para selección y `FormDialog` para capturas breves o confirmaciones. Reutiliza el catálogo de iconos y el tamaño visual de los controles vecinos. En la portada, el portal público y el inicio de sesión, toma como base la composición ya aprobada. [Selectores](docs/design/select-field.md), [diálogos](docs/design/management-dialogs.md) y [navegación pública](docs/design/public-navigation.md)

## Acomodo y recorridos

- En listados administrativos, prioriza renglones compactos con entidad, contexto, estado y acciones. Alinea las acciones al lado en escritorio y colócalas debajo si falta espacio en móvil. Haz que las acciones habituales se encuentren en el renglón. El detalle y la edición pueden abrir su propio diálogo. La consulta de firmas privadas conserva su control y sus permisos.
- Coloca el título, los filtros y el contexto necesario antes del contenido. Identifica liga, temporada, club, equipo, jornada o folio según el recorrido. Al volver desde un detalle, conserva los filtros, la página y el foco cuando sea posible. En procesos largos, conserva la página como espacio de trabajo.
- Usa `ProcessSteps` para etapas reales del trámite o de la captura. Distingue la etapa actual con `aria-current` y marca como completas las etapas acreditadas. Usa el resultado del servidor para representar un envío, una aprobación o un cierre. Los filtros, pestañas y consultas independientes conservan su propia navegación.
- Nombra la acción por su efecto y explica los requisitos junto a ella. Distingue captura temporal, guardado local, acuse del servidor, revisión, corrección y resultado incierto. Si se pierde la respuesta, conserva la intención original y ofrece consulta antes de reenviar cuando el contrato lo permita. Advierte al salir cuando se perderían cambios.
- Presenta carga, vacío, error, acceso denegado y desconexión cuando correspondan. Los permisos, el ámbito y la validación se comprueban en el servidor. Muestra únicamente el contexto y la información privada que necesita el rol autorizado.

## Verificación de la entrega

- Recorre la vista desde su entrada habitual con el rol correspondiente. Si cambias un componente compartido, comprueba sus consumidores pertinentes.
- Revisa claro y oscuro, móvil y escritorio, navegación por teclado, foco visible, retorno de foco al cerrar, etiquetas, contraste y movimiento reducido cuando corresponda. Prueba el ancho pequeño con contenido largo y revisa los estados de carga, vacío y error que afecte el cambio.
- Usa datos de prueba en las capturas. Describe qué se verificó con sesión y backend aislados, qué usó transporte simulado y qué queda pendiente. Las consultas reales a las APIs de CURP e INE corresponden exclusivamente al equipo humano. [Instrucciones del proyecto](AGENTS.md)
- Registra las decisiones del recorrido y la evidencia de prueba en `docs/design/`. Usa el registro de este refinamiento para consultar los patrones ya acordados. [Registro del refinamiento](docs/design/ui-ux-refinement.md)
