# PDGLD-135 — Generación de propuestas (en desarrollo)

El motor genera vueltas completas por grupo, invierte localía entre vueltas y
conserva descansos para equipos impares. Compartir cancha nunca invierte local y
visitante. La búsqueda elige horarios completos sin traslapes de cancha/holgura o
equipos; ante falta de solución o límite de búsqueda no devuelve partidos parciales.
Las preferencias ordenan candidatos; no se acredita un óptimo global.

La configuración propuesta `calendar.scheduling` forma parte del reglamento
versionado y aprobado: `slotStepMinutes` y `venueStages` con `fromRound`, `toRound`
y `venueIds`. Los tramos no se superponen. Una regla antigua sin esta configuración
se rechaza explícitamente; no se presupone que sus últimas diez jornadas sean neutrales.
La configuración y su interfaz de edición necesitan integrarse con competencias/PDGLD-23.

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

## Pendientes antes de cerrar PDGLD-135

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
