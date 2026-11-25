# Árbitros y designaciones — primera entrega visual de PDGLD-142

Nota posterior: la revisión visual fue aprobada y su ruta de demostración se
retiró del menú. `/referees/demo` ahora redirige a `/referees`, conectado al
backend. El recorrido descrito debajo es el registro de la revisión sintética;
los fixtures se conservan únicamente para pruebas de componentes.

Trabajo de PDGLD-86 (PDGLD-141/142/143) en una sola rama:
`feat/PDGLD-86-arbitros-designaciones`. Esta entrega termina en revisión de vistas.
No implementa el backend de registro/designación ni da por terminadas las historias.

## Levantar y recorrer

1. Usar la instalación y autenticación de desarrollo existentes, con una cuenta
   activa que haya completado su cambio de contraseña. No se crean cuentas,
   personas ni permisos para esta entrega; no hace falta sembrar datos de arbitraje.
2. Ejecutar `npm run dev` e iniciar sesión en `/login`.
3. Abrir `/referees/demo` o «Arbitraje → Árbitros y designaciones · Demo».
4. Seleccionar explícitamente «Municipal · DEMO» y «Apertura 2026 · DEMO».
   Cambiar la liga limpia temporada y filtros dependientes; no elige otro alcance.
5. Recorrer las pestañas Padrón, Disponibilidad, Cuota por club, Designaciones e
   Historial. Las URL admiten `?view=register`, `availability`, `quota`,
   `assignments` e `history`; funcionan enlaces directos y atrás/adelante.
6. Para evidencia histórica, seleccionar «Clausura 2025 · DEMO · Cerrada» e
   Historial. «Regional · DEMO» permite revisar una temporada sin registros.

Se reutiliza el layout de `(management)` y `ManagementShell`, sin encabezados o
`main` adicionales. Selectores: `SelectField`. Captura/revisión breve:
`FormDialog`, con advertencia de descarte, foco contenido, retorno del foco y
lista del selector dentro del diálogo. Acciones y estados usan los tokens,
`primary-action`, `ActionLink` y el tema del menú de cuenta existente.

Las pestañas mantienen la simulación mientras el componente siga montado.
Recargar, abandonar el recorrido o cerrar la sesión pierde los cambios. No hay
localStorage, IndexedDB, cola offline ni solicitudes de escritura. «Reiniciar
demostración» restaura el fixture. El estado sin conexión informa esta limitación.

## Casos sintéticos

| Vista | Recorrido / resultado esperado |
| --- | --- |
| Padrón | Buscar Alba (también `ÁLBA`), filtrar club o activo/inactivo. Bruna está inactiva. |
| Presentar | Elegir Fina del catálogo existente y un club; aplicar solo a la demo. No crea persona, cuenta, rol ni permiso. |
| Editar | Modificar club/estado; persona queda fija. Escape/Cancelar con cambios pide descartar o continuar. La relación es única por árbitro y temporada. |
| Disponibilidad | Ciro tiene disponibilidad amplia y un intervalo «No disponible» de 10:00 a 12:00 del 21/11/2026; el bloqueo prevalece en el ejemplo. Dara presenta traslape. |
| Sin intervalos | «Simular sin intervalos» muestra disponibilidad sin confirmar y evita presumir elegibilidad. Reiniciar restaura los intervalos. |
| Cuota | Brisas: 5 equipos → 2 requeridos, 3 presentados, 0 faltantes. Cedro: 4 → 1, 1, 0. Roble: 9 → 3, 1, 2. Faro: 0 → 0, 0, 0. |
| Positiva | D-101 / Alba está pendiente y sin bloqueos; se puede simular aprobación y revocación. |
| Aprobada sin conflictos | D-104 / Alba, de 12:00 a 14:00 en la zona de la liga, comienza al terminar D-101. |
| Inactivo | D-101 / Bruna no permite aprobación. |
| No disponible | D-101 / Ciro coincide con su intervalo de indisponibilidad. |
| Traslape | D-101 / Dara coincide con D-102, que ya está aprobado. |
| Club en grupo | D-101 / Elio: Cedro C pertenece al grupo A aunque el encuentro sea Roble A – Faro A. Se muestra ese motivo de bloqueo. |
| Estados | Pendiente (`PROPOSED`), aprobada (`APPROVED`), revocada (`REVOKED`). Bloqueos y disponibilidad son evaluación de presentación, no estados nuevos de base. |
| Grupo único | Proponer D-103 con Alba: Brisas J está en el grupo único. Todos los clubes del fixture tienen un equipo en ese grupo. No se supone excepción. |
| Historial abierto | Filtrar referencia de árbitro o partido; las acciones de esta visita agregan eventos locales sin reescribir el antecedente inicial. No es auditoría real. |
| Identidad preservada | Clausura 2025 / D-021: nombre y versión de identidad de una evidencia sintética al cierre (`SEASON_CLOSURE_V1`). |
| Antecedente insuficiente | Clausura 2025 / D-022: «Identidad histórica no disponible». Se conserva referencia técnica sin completar el nombre desde el padrón actual. |
| Carga/vacío/error/denegado | Selector «Estado de vista · Simulación», disponible en todas las pestañas. Son ejemplos deliberados, no errores reales provocados en servicios. |

Fechas con `Intl.DateTimeFormat` y zona de la liga `America/Mexico_City`, también
cuando la zona del dispositivo sea otra. Los intervalos muestran inicio y fin
completos. No se presupone disponibilidad si faltan intervalos.

## Autenticación y conexión posterior

`features/referees/server/preview.ts` exige `NODE_ENV === development` y
`requireOperationalUser()` antes de importar los fixtures. Fuera de desarrollo,
el destino devuelve `notFound` y no carga datos de ejemplo. La navegación también
oculta la demo fuera de desarrollo; la protección efectiva está en el servidor.

Cualquier cuenta operativa autenticada de desarrollo puede revisar estos datos
sintéticos. Esto no acredita permisos para gestionar árbitros ni acceso a una
liga real. El estado visual de acceso denegado es simulado. No se modifica la
política RBAC ni se implementa una matriz paralela en cliente.

«Mis partidos · Alineación» conserva `/matches`, su consulta/autorización y su
recorrido existente de Nick. En la demo el enlace se ofrece mediante la capacidad
`canAccessMatchEligibility`; no se pasan IDs sintéticos al recorrido real. No se
copian las acciones de transiciones del PR #56. Comprobado el 13/11/2026 mediante
GitHub: PR #56 abierto, sin integrar, con base `develop`.

`features/referees/types.ts` define DTOs serializables: persona mínima, árbitro
activo/inactivo, relación club/temporada, disponibilidad, partido con categoría y
grupo, designación, evaluación con motivos e identidad histórica. No contiene
CURP, correo, documentos, cuenta completa, Prisma ni sesión. Los IDs `DEMO-*`
son ficticios y no son payloads válidos para escrituras.

`preview-model.ts` evalúa únicamente fixtures para reaccionar a cambios locales.
No es un servicio de elegibilidad o seguridad y no debe reutilizarse para
autorizar escrituras. Al conectar el backend, las consultas autorizadas deben
entregar evaluación, cuotas y capacidades reales; cada entrada y servicio deben
validar identidad, permiso, alcance y estado contra datos actuales. Antes de
aprobar, deberán comprobar persona/árbitro, relación de temporada, grupo completo,
disponibilidad y concurrencia. No basta deshabilitar botones. La preservación
histórica deberá consumir las evidencias existentes del cierre; si faltan, no
usar identidad vigente como respaldo.

## Decisiones pendientes

- Efecto de la restricción de club cuando la categoría tiene grupo único: con los
  clubes de ese grupo representando árbitros, el conjunto elegible puede quedar
  vacío. Confirmar el criterio con el equipo antes del backend; no se inventa
  una excepción ni una consecuencia deportiva.
- Cómputo de inactivos en cuota. Esta propuesta cuenta relaciones de presentación
  para faltantes y expone activos/inactivos por separado. Confirmar si el estado
  cambia el cómputo oficial. La fórmula requerida sigue siendo `ceil(equipos/4)`.
- Confirmar política sobre propuestas pendientes que se traslapan, márgenes entre
  encuentros e intervalos disponibles contiguos. El fixture bloquea cruces con
  propuestas/aprobaciones, permite extremos adyacentes y exige un solo intervalo
  que cubra el encuentro; no se presenta como regla oficial implementada.
- Alcances y capacidades de registro, disponibilidad, propuesta, aprobación y
  revocación; contratos de concurrencia, auditoría y revocación de una
  aprobación. Esta entrega no incorpora endpoints ni Server Actions de negocio.

## Verificación

Comandos: `npm run typecheck`, lint de archivos afectados y
`npm run test:referee-preview`. Este último monta componentes React y el shell
reales en Chrome headless con datos y navegación sintéticos, sin backend ni
proveedores. Incluye filtros, FormData, descarte/foco, motivos de bloqueo,
aprobación/revocación visual, cuota, evidencia histórica y estados de vista.
Comprueba ausencia de desbordamiento y selectores en diálogo a 390/1440 px,
claro/oscuro. `REFEREE_SCREENSHOTS` indica un directorio opcional para capturas.
`CHROME_BIN` permite usar otro ejecutable de Chrome.

La prueba se ejecuta mediante su comando explícito; no se añadió a `test:ci`.
Se ejecutaron tipado y lint completos, y la prueba de Chrome con capturas de
ambos temas. Se revisaron visualmente padrón en escritorio, cuota e historial en
móvil y selector abierto dentro de diálogo. Next.js compiló la ruta local; la
petición sin cookies devolvió 307 a `/login` sin entregar el fixture. No se probó
un recorrido autenticado contra el backend real ni se ejecutó una compilación
de producción. Los permisos y los datos reales requieren validación posterior.
La revisión humana de las vistas precede al backend.
