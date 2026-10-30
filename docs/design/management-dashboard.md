# PDGLD-115 — Entrega 1: panel de inicio

El panel se sirve en `/access`, dentro de la estructura de PDGLD-114. Esta entrega
no incorpora modales ni modifica los listados de afiliación o equipos.

## Presentación y capacidades

- Bienvenida con `@usuario` y todos los nombres de roles vigentes. Sin nombre
  completo, correo ni elección automática de una asignación principal.
- Tarjetas para solicitudes de afiliación, revisión, inscripción/consulta de
  equipos y creación de cuentas, exclusivamente cuando aparecen en
  `getManagementNavigation`. Tener lectura no se presenta como permiso de aprobar
  o inscribir. No se añade una matriz de roles en el navegador.
- El detalle anterior de permisos y ámbitos permanece en un bloque desplegable.
  Una cuenta sin herramientas recibe orientación y acceso al portal público.
- Conserva Geist, `ActionLink`, los tokens de ambos temas y el menú de cuenta.
  Tarjetas en una columna móvil y dos desde el ancho intermedio.

## Datos del resumen

El usuario elige explícitamente una liga o club. No existe un total global ni una
temporada activa inferida. El alcance «Todas las temporadas» se indica junto a
los resultados, también cuando son cero.

`features/clubs/server/dashboard-queries.ts` valida el contrato, verifica
`clubs:READ` sobre el ámbito solicitado y obtiene conteos completos en una
transacción `RepeatableRead`. Reutiliza el límite de autorización de los listados.
Una concesión por club no autoriza la lectura de su liga completa.

| Indicador | Fuente y definición |
| --- | --- |
| Por revisar | `club_affiliations`, `PENDING`, sin motivo de corrección (nulo o vacío) |
| Con correcciones | `club_affiliations`, `PENDING`, con motivo no vacío |
| Aprobadas | `club_affiliations`, `APPROVED` |
| Inscripciones (solo club) | Filas de `season_teams` del club, incluidas retiradas; no equipos únicos |

Las fases coinciden con `affiliationReviewPhase`. Los números no se calculan a
partir del tamaño de una página ni de catálogos parciales. No se ofrecen gráficas,
porcentajes, resultados, actividad reciente, jugadores o ingresos sin un contrato
apropiado para el dashboard.

Las opciones reutilizan `getAffiliationReviewLeagueOptions` y
`getTeamEnrollmentCatalogs`. Este último se pagina de 20 en 20; «Ver más clubes»
avanza mediante el cursor real. La opción elegida se conserva al avanzar y los
enlaces directos se autorizan otra vez. Limpiar vuelve al inicio del catálogo.

La selección vive en `/access?context=league:<uuid>` o
`/access?context=club:<uuid>`; `clubAfter` es el cursor opcional. El formulario GET
conserva las URL directas y el historial sin introducir estado persistente por
usuario en el cliente. Los parámetros son identificadores a comprobar, nunca
prueba de autorización.

## Estados y recuperación

`access/loading.tsx` muestra una espera accesible. La ausencia de selección no
simula ceros. Sin ámbitos de lectura, se explica que el resumen no está disponible
para la cuenta y se mantienen sus demás accesos. Una selección inválida, retirada
o ajena muestra aviso sin métricas. Los fallos del resumen no eliminan las tarjetas;
el reintento recarga la misma URL. Fallos generales usan la frontera de error con
`retry`, según Next.js 16.4, para volver a consultar el servidor.

## Dependencias y límites

PDGLD-95 mantiene configuración de temporadas, categorías, grupos y reglas. Esas
vistas todavía no existen en esta rama: no se agregan enlaces sin destino ni un
CRUD alternativo. La entrega 2 implementará el diálogo reutilizable después de la
revisión humana de este panel. La entrega 3 coordinará su integración con PDGLD-95.
PDGLD-116 conserva la regresión completa.

## Prueba manual

1. Iniciar el entorno local (`npm run dev`), entrar con una cuenta operativa y abrir
   `/access`. Verificar identidad, roles y tarjetas correspondientes.
2. Entrar a una herramienta y volver con el navegador. Probar sus enlaces directos.
3. Elegir liga/club y pulsar «Ver resumen». Verificar el nombre, todas las
   temporadas y las cifras contra los registros autorizados. Abrir la URL en otra
   pestaña y comprobar la misma selección.
4. Probar un ámbito sin registros y otro sin permiso: cero y denegación deben
   distinguirse. Con varias asignaciones, cambiar entre ámbitos sin sumar datos.
5. Probar 390 px y escritorio, claro/oscuro, teclado y sidebar móvil. Los botones
   deben conservar relleno y foco visible, sin desplazamiento horizontal.
6. Probar sin sesión y con cambio de contraseña obligatorio: mantienen las
   redirecciones. El portal público conserva su estructura propia.

Automatización: `npm run test:dashboard` verifica presentación con datos sintéticos;
`npm run test:authorization` verifica consultas y páginas HTTP contra PostgreSQL
temporal real. Ninguna de esas pruebas equivale a una revisión visual en navegador.

### Revisión ejecutada el 29/10/2026

- Typecheck y lint correctos; seis pruebas de presentación del dashboard correctas.
- `test:authorization`: 42 pruebas en el subproceso de autorización y 61 en el
  proceso HTTP, todas correctas. Incluye conteo de 26 afiliaciones, separación
  entre ligas, fases nula/vacía, club suspendido y revocación con la misma sesión.
- Navegador con sesión de secretaría y PostgreSQL real en una base desechable:
  selector inicialmente vacío, selección explícita de liga, indicador de una
  afiliación real del fixture, tarjetas y carga durante la consulta.
- Revisión visual en escritorio y 390 px, claro/oscuro; sin desbordamiento
  horizontal en móvil. Sidebar móvil con foco inicial en cerrar, recorrido inverso
  hasta la salida, Escape y retorno al botón que la abrió.
- Los registros de la demostración son sintéticos; no se usó producción. No se
  completó una regresión visual de todos los perfiles ni todos los recorridos de
  PDGLD-116. Las denegaciones y perfiles combinados sí tienen pruebas automáticas.
