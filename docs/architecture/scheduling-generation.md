# PDGLD-135 — Generación de propuestas (en desarrollo)

El motor genera vueltas completas por grupo, invierte localía entre vueltas y
conserva descansos para equipos impares. Compartir cancha nunca invierte local y
visitante. La búsqueda elige horarios completos sin traslapes de cancha/holgura o
equipos; ante falta de solución o límite de búsqueda no devuelve partidos parciales.
La búsqueda compara preferencias y registra si terminó de encontrar el mínimo entre los candidatos.

La configuración propuesta `calendar.scheduling` forma parte del reglamento
versionado y aprobado: `slotStepMinutes` y `venueStages` con `fromRound`, `toRound`
y `venueIds`. Los tramos no se superponen. Una regla antigua sin esta configuración
se rechaza explícitamente; no se presupone que sus últimas diez jornadas sean neutrales.
La configuración se captura y revisa al crear una versión del reglamento en competencias.

Las jornadas pertenecen a la temporada. Cada grupo utiliza las primeras jornadas
consecutivas que necesita, sin exigir que otro grupo tenga el mismo número de equipos.
Se rechazan jornadas faltantes o fechas superpuestas. La cuadrícula de candidatos
parte de la apertura de la cancha; los horarios de localía autorizados también se
incluyen aunque no coincidan con esa cuadrícula. Se conserva la zona horaria de la liga.

Las sanciones bloqueantes se evalúan por equipo y por intervalo del partido, con
inicio inclusivo y final exclusivo, siguiendo el contrato temporal actual de
elegibilidad. Una sanción vencida no bloquea toda la generación. No se interpretan
automáticamente apelaciones ni cumplimiento por partidos: falta integrar ese
contrato cuando disciplina lo publique.

`generateSchedule` autentica en servidor; `generateScheduleInTransaction` conserva
RBAC, contexto, versión y clave de operación. Genera sobre General o un grupo ya
distribuido, con afiliaciones y categorías autorizadas. Conserva el resultado en
`schedule_proposals.parameters` (formato 1), incluyendo partidos, descansos y versión
de reglas. No crea partidos oficiales ni reservas: PDGLD-25 debe revalidar toda la
propuesta antes de reservar y confirmar. Dos propuestas pueden competir por una
cancha; ninguna acredita disponibilidad futura. La propuesta no publica contenido.

## Estado histórico al 17 de noviembre: pendientes de PDGLD-135

Los apartados siguientes conservan el contexto previo a incorporar PDGLD-23;
no describen por sí solos el estado actual. Para la evidencia y pendientes de
integración de PDGLD-137, consultar `docs/validation/PDGLD-137.md`.

### Dependencia de PDGLD-23: pendiente de incorporación

Según lo informado por Sergio el 17 de noviembre de 2026, Karol ya implementó
las ventanas de préstamos. Víctor encontró detalles durante la revisión y Karol
está atendiendo esos ajustes antes de subir la entrega. No se registran aquí
defectos específicos porque no se han confirmado en esta revisión.

El adaptador local de PDGLD-135 se preparó contra el contrato disponible en
`origin/feat/PDGLD-23-prestamos-localias`; ese contrato todavía puede cambiar.
La incorporación definitiva espera la versión revisada de Karol en `develop`.
No se copió ni se aplicó su migración desde la rama pendiente de revisión.

Cuando se incorpore PDGLD-23, corresponde a nuestro trabajo de PDGLD-24:

1. Comparar el contrato definitivo de ventanas y aprobación con el adaptador local
   y ajustar cualquier diferencia, incluidas las reglas acordadas de cancha compartida.
2. Incorporar los cambios aprobados de `develop`, aplicar las migraciones correspondientes
   en el entorno local y regenerar el cliente Prisma.
3. Comprobar con PostgreSQL los préstamos aprobados, pendientes y rechazados;
   el alcance por club/temporada/cancha; y que partido más holgura quepan en una
   sola ventana, respetando aperturas, bloqueos y tramos de jornadas.
4. Completar persistencia, reintentos, concurrencia, rollback y permisos de Preview
   del generador. Estos pendientes siguen siendo responsabilidad de PDGLD-24.

Estado de este avance: código local preparado y 13 pruebas puras aprobadas,
con revisión de tipos sin errores. Se comprobó el servicio con PostgreSQL y un
contrato sintético mínimo de ventanas, según el apartado siguiente. Esto no acredita
la integración definitiva de PDGLD-23 ni permite dar PDGLD-135 por terminada. El servicio requiere la migración de
PDGLD-23 y no debe presentarse como funcional en una base que todavía no la tenga.

### Trabajo restante

- Incorporar la migración `20261115010000_pdgld23_venue_loan_requests` de PDGLD-23
  y comprobar la lectura real. El generador ya consume `requested_windows` mediante
  `loadApprovedLoanWindows` dentro de su transacción. Exige préstamo aprobado con
  solicitante, responsable y fecha de aprobación del mismo club local y temporada.
  Partido y holgura deben caber en una única ventana válida; no se unen ventanas.
  Las asignaciones legadas solo ordenan preferencias y ya no autorizan una cancha
  privada sin ventana. Las aperturas generales, bloqueos y tramos siguen aplicando.
  Esta rama todavía no incluye la migración: ejecutar el servicio sin ella falla;
  falta acreditar su migración definitiva y las políticas RLS del entorno Preview.
- Integrar resoluciones, apelaciones y cumplimiento con el contrato disciplinario.
  La evaluación temporal actual no acredita esos flujos futuros.
- Repetir las pruebas reales con la migración definitiva de PDGLD-23 y comprobar
  las políticas RLS de Preview. Persistencia, permisos de aplicación, reintentos,
  concurrencia, rollback y ACL limitadas ya se comprobaron en PostgreSQL local aislado.
- Revisión de otra persona e integración con la pantalla de PDGLD-136/ajuste PDGLD-25.

Pruebas puras: `npm run test:scheduling`. El límite operativo actual es de 64
equipos, cuatro vueltas y 1024 partidos por búsqueda, 200000 candidatos examinados
al construir horarios y 100000 nodos/5 segundos para asignarlos. Alcanzar el límite
se distingue de demostrar que no existe solución.

## Verificación local del 17 de noviembre de 2026

Se probaron pares únicos, descansos, inversión entre vueltas, canchas compartidas,
retroceso de búsqueda, conflictos, límites, vigencia de sanciones, jornadas por
grupo, tramos de canchas y autorización de localía. El préstamo legado debe ser
aprobado, tener responsable/fecha de aprobación y coincidir en cancha, club y temporada;
la asignación del visitante no concede permisos al local.

Dataset de rendimiento del motor: 20 equipos, dos vueltas, 38 jornadas, cuatro
canchas, 380 partidos y 4560 candidatos. Una ejecución local tomó aproximadamente
294 ms, con comprobación de ausencia de cruces en todos los pares de partidos.
Esta medición no incluye lecturas, construcción de candidatos ni persistencia y
no sustituye la aceptación del servicio completo. Las pruebas no usan datos reales.

Los conflictos de serialización se reintentan como transacciones completas, hasta
tres intentos, conservando la clave de operación y repitiendo autorización/validación.
La concurrencia y recuperación se comprobaron después con PostgreSQL aislado,
como se detalla en el apartado siguiente.

## Comprobación del servicio con PostgreSQL aislado (17 de noviembre de 2026)

Comando reproducible: `npm run test:scheduling:integration`. El runner crea una
base con nombre aleatorio `pdgld135_test_*`, aplica las migraciones del repositorio
y carga exclusivamente datos sintéticos. Añade solo en esa base las dos columnas
del contrato de lectura previsto (`requested_by` y `requested_windows`). Esto no
simula ni valida las restricciones, aprobaciones o migración definitiva de Karol.

La prueba ejecuta el servicio real y comprueba:

- Denegación de un actor sin permiso y rechazo de una versión desactualizada.
- Persistencia de una propuesta completa y ausencia de partidos oficiales.
- Recuperación del mismo acuse sin duplicados; rechazo de reutilizar su clave con otro contenido.
- Dos llamadas concurrentes con una misma clave: una creación y una recuperación.
- Reversión de la propuesta cuando la transacción falla después de crearla.
- Generación y recuperación bajo un rol SQL temporal limitado con las ACL del
  plan de Preview. Se conceden lecturas y alta de propuestas; la prueba conserva
  RLS desactivado en Docker y no acredita las políticas de Supabase.
- Falta de horarios: devuelve `NO_AVAILABLE_SLOT` sin persistir otra propuesta.

Dataset completo: 20 equipos, una vuelta, 19 jornadas, cuatro canchas, duración
de 90 minutos y holgura de 30 minutos. Se guardaron 190 partidos propuestos.
La ejecución medida tomó **1859.6 ms**, incluyendo consultas, construcción de
candidatos, búsqueda y persistencia. Se exige menos de 30 segundos para este dataset;
no es una garantía para cualquier volumen o infraestructura.

El runner elimina su base y su rol temporal al terminar. La ejecución local pasó
y confirmó la eliminación de la base. La prueba quedó añadida a la matriz de
PostgreSQL 15/17 del workflow; esa ejecución remota todavía no se ha realizado.
También pasaron tipos y ESLint del código modificado. La suite general `test:ci`
en Windows presentó errores `EPERM` al crear enlaces simbólicos, incluso al repetir
fuera de las restricciones iniciales; no se declara el pipeline completo en verde.

El plan de Preview añade las columnas de ventanas únicamente si ambas existen,
para poder mantener el entorno anterior a PDGLD-23. Al incorporarse esa migración,
se debe volver a aplicar el plan antes de usar la generación con su rol limitado.

## Verificación integrada con PDGLD-23 (17 de noviembre de 2026)

La migración definitiva de préstamos ya forma parte de esta rama y está aplicada
en la base local. El selector y la solicitud permiten canchas de otro club de la
misma liga. El runner aplica las migraciones completas y se retiró la creación
provisional de columnas.

Pasó `npm run test:scheduling:integration` en PostgreSQL 15. Además de permisos,
persistencia, reintentos, concurrencia, rollback y ACL limitadas, ejecuta los
servicios reales de solicitud y decisión con cartas PDF sintéticas y almacenamiento
privado simulado. Comprueba que 80 solicitudes pendientes y después rechazadas
impiden generar; nuevas solicitudes aprobadas permiten guardar 190 encuentros
para 20 equipos, 19 jornadas y cuatro canchas privadas compartidas. Cada encuentro
y su holgura caben en una ventana autorizada. Quitar las aperturas impide guardar
otra propuesta. La base y el rol temporales se eliminan al finalizar.

Esta ejecución verifica servicios y PostgreSQL. Quedan pendientes el recorrido
de navegador, RLS de Preview y revisión externa. Los apartados anteriores sobre
la espera de la migración describen el estado previo a esta comprobación.


## Jornadas finales y preferencias

El generador aplica `complexOnlyFinalRounds` cuando está definido en el reglamento
aprobado. Para cada jornada cuenta las jornadas posteriores de la temporada, igual
que el contrato de localías. Si la jornada está entre las últimas N, admite solo
canchas de la unidad deportiva. Un tramo de `venueStages` también debe permitir
la cancha. Si ambas condiciones no dejan opciones, se informa la falta de horarios.
La ausencia de N conserva la regla desactivada.

La búsqueda minimiza la suma de costos de preferencias entre las soluciones que
alcanza a explorar. Una asignación habitual autorizada tiene costo 0 y las demás
costo 1. Usa cotas para descartar combinaciones que no mejoran la mejor solución.
Si alcanza el límite después de encontrar una solución completa, la conserva con
`preferenceOptimal: false` y la pantalla indica que puede existir una mejor.
Si termina la búsqueda, `preferenceOptimal: true` acredita el mínimo bajo los
candidatos y costos implementados. Las restricciones duras siguen vigentes.


## Medición local PDGLD-137 — 18 de noviembre de 2026

La ejecución de `node scripts/test-scheduling.mjs` midió la llamada al servicio
en una transacción PostgreSQL local, desde antes de abrirla hasta su confirmación.
La base era temporal y exclusivamente sintética. La medición incluye la
autorización, lectura de reglas y recursos, generación de candidatos, búsqueda y
persistencia de la propuesta; no incluye preparación de datos, migraciones,
red HTTP, navegador, ni publicación de partidos.

Datos: un grupo en tabla General, 20 equipos, una vuelta, 19 jornadas y 190
encuentros; cuatro canchas de la unidad deportiva con aperturas sintéticas de
seis horas por jornada, partidos de 90 minutos, 30 minutos de holgura y pasos
de búsqueda de 30 minutos. No había partidos oficiales ocupando las canchas.
La propuesta se guardó completa y la base temporal se eliminó al terminar.

La muestra fue **8167,3 ms (8,17 segundos) para el grupo completo**, en Windows
x64, Node 24.22.1, AMD Ryzen 7 7735U y PostgreSQL 15 local. En paralelo se
ejecutaba la comprobación de tipos del proyecto. El total queda por debajo de
la meta propuesta de 30 segundos por jornada y grupo para este caso. No se
cronometró cada jornada por separado: tampoco es una garantía de rendimiento
para otros tamaños, restricciones, concurrencia o entornos de despliegue. Una
sola muestra no caracteriza la variabilidad ni la experiencia HTTP completa.

## Consulta de propuestas guardadas

Al seleccionar temporada y grupo, la pantalla consulta las propuestas guardadas
de ese contexto. El servidor vuelve a comprobar el permiso de programación y el
grupo de la temporada, y entrega los campos necesarios para revisar jornadas,
equipos, canchas y horarios. Las propuestas formato 1 conservan sus nombres y
zona horaria registrados. Se muestran las que cumplen el contrato de lectura;
otros formatos o registros incompletos requieren su propio adaptador.

La consulta se comprobó tras recargar en Chrome, con rechazo de una cuenta sin
permiso y con el rol limitado y RLS activos en PostgreSQL local. La solicitud pendiente se conserva por usuario en IndexedDB antes de enviarse.
Al recargar, se recupera la misma clave y contenido para reintentar sin duplicar
la propuesta. La captura se elimina después de recibir un resultado confirmado.


## Configuración desde el reglamento

El formulario de reglas permite indicar el intervalo de horarios y tramos de
jornadas con las canchas autorizadas de la liga. El servidor valida el contrato
y comprueba que las canchas seleccionadas estén activas y pertenezcan a la liga.
Al crear una nueva versión se conserva la configuración de programación previa.
La revisión muestra nombres de canchas y conserva las versiones anteriores.

Una categoría con equipos puede asociarse a una nueva versión aprobada si solo
cambia la configuración de programación, conserva todas las demás reglas y
aún no hay partidos ni propuestas de esa categoría. Se mantienen las protecciones
para otros cambios, temporada iniciada, cierre e historial existente.

El recorrido local en Chrome creó y aprobó la versión, la asoció a una categoría
con equipos y generó la propuesta. También rechazó una cancha ajena, un cambio
de puntuación y un reemplazo después de generar una propuesta. El recorrido se
repitió con RLS y el rol limitado activos en PostgreSQL temporal.
