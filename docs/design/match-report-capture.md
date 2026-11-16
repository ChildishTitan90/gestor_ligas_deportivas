# PDGLD-148 · Captura y consulta de cédula — revisión de interfaz

Entrega exclusivamente visual de PDGLD-18. No implica aceptación de la historia,
PDGLD-147/149 ni disponibilidad funcional del cierre de partidos. La siguiente
etapa espera la revisión humana de estas vistas.

## Base y aislamiento

- Rama `feat/PDGLD-18-cedula-arbitral`, creada desde `origin/develop` `95a9280`
  después de un fetch exitoso. Checkout separado en `.worktrees/PDGLD-18`.
- Se conservó el checkout original en `feat/PDGLD-86-arbitros-designaciones`,
  sin cambios locales ni alteraciones de sus cuatro commits exclusivos. No se
  incorporó el PR pendiente #58 ni ningún otro PR pendiente.
- El fetch final volvió a obtener `95a9280`: `develop` no avanzó durante la
  implementación. La rama de trabajo sigue en ese mismo commit, sin commits
  nuevos ni cambios preparados. Se revisó el diff local contra la referencia
  actualizada: conserva los servicios, contratos y correcciones ya integrados.
- `develop` contiene PDGLD-16 (PR #53), `features/matches/eligibility.ts`, la
  consulta autorizada de alineaciones y su contrato de participación transaccional.
  No contiene el módulo `features/referees` del PR #58. Tampoco contiene servicios
  funcionales de PDGLD-85, catálogo PDGLD-26 o clasificación PDGLD-29.
- Se consultaron PDGLD-18 y PDGLD-148 en Jira solo para lectura. Sus instrucciones
  de entrega completa son contexto: el pedido humano actual limita esta entrega a
  vistas. No se crearon ni editaron historias, subtareas, comentarios o estados.
- Se leyeron las guías instaladas de Next.js 16.4.3 sobre estructura, componentes
  servidor/cliente, seguridad, autenticación, carga, errores y `next typegen`.

## Cómo abrir

En desarrollo y con una sesión operativa, entrar a **Arbitraje → Demo · Cédula
arbitral**. También hay un enlace en `/matches` y acceso directo a
`/matches/report-demo`. La lista abre el partido sintético `DEMO-018`; desde su
detalle se pulsa **Capturar cédula**. Los casos confirmados abren la consulta.

Ambas páginas llaman `requireOperationalUser`, además del layout de gestión. No
se añadió una excepción de sesión ni se cambió el login. El permiso y designación
del partido mostrado son ejemplos, disponibles a cuentas operativas en desarrollo;
no conceden acceso a partidos reales. Solo se acepta el ID sintético `demo-018`.
Fuera de `NODE_ENV=development` las rutas responden mediante `notFound` y no se
añaden enlaces de demo al menú ni al listado real.

Para iniciar otro servidor desde el worktree, cargar un entorno local válido como
explica [autenticación](../authentication.md) y ejecutar:

```powershell
npm run dev -- --webpack -H 127.0.0.1 -p 3018
```

En la sesión de implementación se dejó una instancia en
`http://localhost:3018/matches/report-demo`. Su lanzador temporal ignorado por Git,
`.next/run-report-demo.cjs`, hereda el entorno del checkout original en un proceso
separado y fija únicamente la URL local de NextAuth. No copia ni imprime `.env`.
Las dependencias instaladas se reutilizan mediante una junction `node_modules`;
no se instalaron paquetes ni se regeneró Prisma sobre la rama del PR pendiente.

## Casos sintéticos

Todos se eligen en la lista. También pueden abrirse con
`/matches/report-demo/demo-018?case=VALOR`:

| Valor | Caso |
| --- | --- |
| `draft` | En curso y borrador: dos equipos, 11 titulares y dos suplentes por equipo, jugadores bloqueados, dorsal del partido distinto del habitual, tiempos incompletos, gol, cambio y amonestación sin minuto. Firmas pendientes. |
| `empty` | Sin alineación confirmada, capitanes, eventos, tiempos o marcador. No se inventa cero como resultado. |
| `confirmed` | Partido finalizado y cédula confirmada: solo consulta, dorsales de la captura y trazos rotulados como firmas sintéticas. |
| `denied` | Designación o permiso no vigente; sin formulario. |
| `loading` | Carga simulada con finalización manual. No representa una solicitud real. |
| `error` | Error de consulta y reintento manual. |
| `stale` | Captura conservada y edición bloqueada; comparación con una referencia sintética. No se cambia la versión base ni se concilia automáticamente. |
| `uncertain` | Operación y versión conservadas en memoria. Consultar resultado simulado aplicado/no aplicado antes de permitir otro envío. |
| `scheduled` | Partido programado que no admite captura en este caso ilustrativo; política real pendiente. |

En captura, **Controles de demostración** permite elegir éxito, error conocido,
versión obsoleta, resultado incierto o pérdida de permiso para el próximo guardado
o confirmación. Un error conocido permite reintentar manualmente la misma captura,
identificador y versiones. Un resultado incierto bloquea edición y reenvío hasta
consultar. Un conflicto conserva la captura bloqueada; para iniciar otro ejemplo
hay que salir explícitamente, perdiendo la captura actual.

## Diseño y recorrido

1. Partido con equipos, marcador, temporada, categoría, grupo, jornada, cancha y
   horario de Morelia. Estado del partido y estado de cédula siempre separados.
   Durante la edición se compacta el marcador y los metadatos se despliegan.
2. Alineaciones de ambos equipos, titular/suplente, capitán, dorsal habitual como
   referencia y dorsal del partido editable. Jugadores bloqueados visibles, con
   motivos textuales y sin opción de incorporarse. El dorsal histórico no depende
   de un cambio futuro al habitual.
3. Entrada/salida por periodo y cambios. Se reutiliza `participationTimesSchema`
   de PDGLD-16 para enteros, orden y periodos únicos. Ausente se muestra como
   pendiente; no se deduce participación ni se calculan totales.
4. Eventos por catálogo, con selección dependiente equipo/jugador. El cambio
   añade jugador entrante y saliente distintos. Periodo y minuto opcionales; se
   conserva el orden de captura. Registrar un cambio no rellena tiempos por
   inferencia ni modifica automáticamente el marcador.
5. Marcador explícito, observaciones, incidencias y firmas. Un incidente grave
   necesita evento con descripción, pero no crea expediente ni sanción.
6. Captura directa de ambos capitanes mediante `DirectSignatureField` compartido:
   trazo → vista previa → confirmar captura. No se acepta nombre escrito como
   sustituto. El archivo se representa como imagen serializable solo en memoria.
   Cambiar cualquier contenido retira ambas firmas; hay que volver a capturarlas.
7. Resumen en página de alineaciones, dorsales, tiempos, cambios, eventos, marcador,
   observaciones e imágenes de firmas. Se señalan faltantes antes de confirmar.
8. Confirmación breve en `FormDialog`, con casilla explícita y prevención de doble
   envío. Solo tras una respuesta simulada aplicada cambia a consulta y se bloquea
   la edición normal. No cambia datos oficiales.

No se encierra el expediente completo en un modal. `FormDialog` se reserva para
tiempos, eventos, confirmación, comparación breve y salida. Conserva descarte,
fondo inerte, foco seguro, Escape y retorno del foco. `SelectField` conserva su
recuadro cerrado, búsqueda, selección confirmada y popup dentro del diálogo.

Se reutilizan ManagementShell, AccountMenu, navegación, ActionLink, tokens y los
temas existentes. No hay otro `main`, shell, selector de tema ni cierre de sesión.
La ruta hija de demo mantiene activa la entrada del menú compartido con
`aria-current` y cobre. El selector de secciones permanece bajo el encabezado
compartido al desplazarse, con sus mismas alturas de 64/80 px.

Las referencias aportadas por el usuario orientan la jerarquía del marcador,
equipos, jugadores y cambios. La cancha táctica con posiciones/fotografías encaja
mejor en consulta pública futura: aquí no se asignan formaciones o posiciones
que los contratos existentes no proporcionan. No se usaron imágenes o nombres
de esas capturas como datos de la liga.

## Contratos y límites de la simulación

`features/match-reports/types.ts` contiene DTOs sin Prisma, identidad del servidor,
`File`, `Date`, secretos o dependencias de almacenamiento. IDs de partido/equipo/
jugador, dorsal del partido, periodos, eventos, capitanes, firmas, marcador y
versiones permanecen separados. El catálogo de la demo usa los códigos del
baseline: GOAL, CAUTION, SENDING_OFF, SERIOUS_INCIDENT y SUBSTITUTION. Sus requisitos
de selección son ilustrativos hasta recibir el catálogo vigente.

`presentation-review.ts` comprueba completitud de UI, pertenencia de selecciones,
dorsales repetidos, tiempos y firmas. No certifica elegibilidad ni permisos. Los
servicios de PDGLD-16 se inspeccionaron y no se modificaron ni invocaron con datos
sintéticos. La futura entrega deberá reutilizar esos límites autorizados.

Guardar conserva una copia y versión solo en memoria. Confirmar cambia solo el
estado React del ejemplo. No hay Server Actions, endpoints, consultas Prisma,
migraciones, subida de firmas, resultados oficiales, estadísticas, expedientes,
Service Worker, IndexedDB, cola, sincronización ni recuperación tras recarga.
Salir/recargar advierte y pierde la captura incluso después de «guardar».
La preferencia de tema conserva su implementación compartida independiente.

## Decisiones pendientes de la entrega funcional

- Integración real de PDGLD-85 y PDGLD-86, incluidos estados que permiten captura,
  consulta y bloqueo. El servicio integrado de elegibilidad permite árbitro
  designado; el alcance de DATA_ENTRY necesita su contrato autorizado.
- Periodos, duración, descansos, cruces, minutos incompletos, prórroga y reingreso;
  no se interpretan como resueltos por permitir capturar un ejemplo.
- Catálogo vigente de PDGLD-26 y requisitos exactos de equipo/jugador; coherencia
  entre marcador, eventos y periodos. No se añadieron tipos deportivos por las
  imágenes de referencia.
- Procedimiento ante capitán ausente o rechazo de firma; almacenamiento privado,
  vinculación y evidencia histórica de firmas antes de una confirmación real.
- Confirmación atómica e idempotente con resultado, transición y clasificación
  (PDGLD-29), tratamiento de versiones y consulta de operaciones inciertas.
- Receptor mínimo de incidentes graves. Registrar la incidencia no impone sanción
  ni significa que exista ya el expediente disciplinario.
- Persistencia online y, después, contratos de PDGLD-19/20. Esta entrega no ofrece
  ninguna garantía de funcionamiento o almacenamiento offline.

## Validación

- `node node_modules/next/dist/bin/next typegen` y `npm run typecheck`.
- ESLint de módulos/rutas nuevos, navegación y shell afectados y prueba de Chrome.
- `npm run test:match-report-ui`: 10 comprobaciones de Chrome con React, shell,
  CSS real, selectores, diálogos y canvas. Incluye trazo → confirmación de firma,
  invalidación al cambiar contenido, doble envío, confirmación explícita, consulta
  bloqueada, minutos ausentes, descarte/foco, conflicto, incertidumbre y permiso
  perdido. Los adaptadores de Next y la cuenta del harness son sintéticos.
- Sin solicitudes de negocio en el harness; registra y rechaza `fetch`. No hay
  credenciales, sesiones de usuario reales, base, Supabase ni proveedores externos.
- Claro/oscuro en 360/390/1440 px: sin desbordamiento de página; capturas de partido,
  alineación, jugadores, firma, selector en diálogo y consulta en
  `.next/report-review`. Se inspeccionaron imágenes de móvil/escritorio y ambos
  temas. No sustituye aceptación humana ni una prueba física táctil.
- Servidor Next real: GET anónimo de lista y captura respondió 307 a `/login`.
  No se ejecutó un recorrido con login ni base reales y no se afirma esa validación.
- La prueba se expone en package.json; no se agregó al pipeline ni se afirma que
  `test:ci` la ejecute. No se ejecutaron llamadas reales a CURP/INE.

No se hicieron commits, push, merge de PR, despliegues ni modificaciones en Jira.
