# PDGLD-147 · Revisión local de backend

## Arranque seguro para revisión

Docker Desktop debe estar disponible. Desde `feat/PDGLD-18-cedula-arbitral`:

```powershell
npm run match-reports:local
```

El runner crea su propio contenedor PostgreSQL 15, aplica migraciones, configura
datos sintéticos y el rol limitado de Preview/RLS, ejecuta comprobaciones y deja
Next en `http://127.0.0.1:3198`. Imprime el enlace con el ID del partido.
Ctrl+C elimina solo su contenedor y el directorio privado temporal de firmas.
Todo ese entorno es desechable. No migra la base habitual, no lee credenciales de
Supabase compartido y no ejecuta proveedores externos.

El Storage de este perfil son archivos privados reales en un directorio temporal,
fuera de `public`, servidos únicamente por el handler autorizado. No es una prueba
de Supabase Storage. Ese adaptador solo se habilita en development con
AUTH_TEST_RUN y directorio fijados por el runner; en producción se usa el transporte
privado configurado. No ingresar datos personales ni firmas verdaderas en el fixture.

Usuarios (todos ficticios), clave **`Arbitraje-Local-141!`**:

| Usuario | Caso |
| --- | --- |
| `arbitraje_arbitro` | Árbitro con designación efectiva para REAL-147. |
| `cedula_capturista` | DATA_ENTRY autorizado de esa liga; no tiene identidad ni designación de árbitro. |
| `cedula_ajeno` | DATA_ENTRY de otra liga; no debe poder consultar ni guardar ese partido. |

Entrar a **Arbitraje → Cédula arbitral → Abrir cédula**, o utilizar el
enlace impreso. Las URL antiguas `/matches/report-demo` redirigen al listado real. La demo se retiró del menú y del recorrido de la aplicación; sus fixtures solo permanecen para regresión de componentes.

## Casos manuales

1. **Árbitro y DATA_ENTRY:** abrir REAL-147 por separado con esas cuentas. Comprobar
   alineación, capitán, tiempos y marcador del fixture. Cambiar observaciones y
   guardar. Tras acuse, recargar y verificar persistencia y versión. DATA_ENTRY no
   utiliza la cuenta del árbitro ni necesita su designación.
2. **Actor ajeno:** usar `cedula_ajeno` con la URL de REAL-147. Debe mostrar acceso
   denegado; su listado no incluye el partido.
3. **Jugador bloqueado:** Carlos aparece con sus motivos y sin selección posible.
   El backend también rechaza incorporarlo manipulando el contrato; no basta con
   habilitar el checkbox en el navegador.
4. **Dorsal:** el dorsal del partido de Alonso es 17. Su habitual se asigna a 45
   durante la prueba; 17 permanece en la cédula. El habitual ya elegido sigue
   inmutable por el baseline. No se altera esa regla.
5. **Eventos y cambios:** el fixture tiene gol sin minuto y cambio. Agregar eventos
   del catálogo vigente, conservar minuto vacío cuando no se conoce y ajustar
   marcador a los goles registrados. Un marcador incongruente se rechaza.
6. **Firmas:** una modificación retira ambas firmas de la captura. Trazar firmas
   ficticias, revisar y confirmar sus vistas previas, guardar y esperar acuse.
   Recargar y comprobar las imágenes privadas. Otra cuenta fuera de ámbito no
   debe obtenerlas mediante su URL.
7. **BORRADOR y FINALIZADO:** los partidos DRAFT-147 y FINISHED-147 no admiten captura.
   FINISHED-147 no tiene cédula histórica: se informa falta de evidencia, no se
   reconstruye una cédula oficial con jugadores actuales.
8. **Conflicto:** abrir REAL-147 en dos pestañas con igual versión. Guardar en una y
   luego en la otra. La segunda conserva captura y rechaza la versión obsoleta.
   «Abrir versión vigente en otra pestaña» consulta lo actual sin sobrescribir.
9. **Resultado incierto:** desconectar la respuesta del POST después del envío
   desde las herramientas del navegador, volver a conectar y consultar el acuse.
   Si no hay evidencia todavía, reenviar la misma operación. No se genera otra
   clave ni se pierde el contenido. La suite automatizada corta realmente la
   conexión después del COMMIT y recupera el acuse antes del replay.
10. **Confirmación:** completar las firmas, revisar resumen y solicitar cierre.
    Debe informar el bloqueo de dependencias. El borrador anterior permanece;
    no se finaliza el partido ni aparecen resultado, historial, clasificación o
    expedientes simulados. Esto es un bloqueo pendiente, no una aceptación positiva
    de la confirmación de PDGLD-147.

## Comprobaciones automatizadas

```powershell
npm run test:match-reports
npm run test:match-report-client
npm run test:match-report-tactics
npm run test:match-report-ui
npm run typecheck
```

`test:match-reports` crea y destruye su propio PostgreSQL 15, con rol Preview/RLS y
datos sintéticos. Comprueba autorización efectiva y revocada, DATA_ENTRY propio y
ajeno, elegibilidad, dorsal independiente, periodos, eventos/cambio/minuto ausente,
consistencia de marcador, carreras de versiones, contenido de clave idempotente,
rollback sin acuse, estados cerrados, firmas privadas, recuperación de subida sin
enlace SQL y bloqueo transaccional de confirmación sin efectos. Incluye sesiones
NextAuth/HTTP reales y corte de conexión después de guardar.

`test:match-report-client` usa transporte simulado, sin red: pérdida de respuesta
de subida y guardado, recuperación y conservación exacta de claves/contenido.
`test:match-report-ui` ejecuta 12 pruebas reportadas por Chrome, incluidas campo,
formación personalizada, uniforme y acciones del jugador;
son componentes con datos sintéticos, no una aceptación de la confirmación real.
Los comandos nuevos están en package.json; no se afirma que `test:ci` los ejecute.

Se ejecutaron también ESLint pertinente y los 27 controles de planes de producción,
privilegios Preview y helpers de migración. No se alteraron RLS/ACL remotas ni se
ejecutaron llamadas CURP/INE. Falta aceptación humana y conectar los tres receptores
de cierre definidos en el [contrato de integración](../architecture/match-reports-online.md).


## Partido persistente de Docker: PR86-05

A petición del usuario se preparó el encuentro sintético PR86-05 en
`gestor_ligas_dev` (Docker 5433), sin tocar Supabase: 14 jugadores ficticios por
equipo, con 13 elegibles y uno INELIGIBLE para probar el rechazo. Los registros
CURP son respuestas sintéticas explícitamente auditadas; no se consultó al proveedor.
Se inicializó únicamente la política antes vacía de su categoría sintética y la
autorización de categoría de los dos clubes. El partido pasó de SCHEDULED a
IN_PROGRESS con versión e historial, como preparación de fixture, no como nuevo
servicio de transición de PDGLD-85.

Se conservó cualquier cédula existente; al estar vacío se creó un borrador inicial
con once titulares por equipo, capitán con dorsal 4, dos suplentes elegibles por
equipo, marcador 0:0 y firmas sin capturar. Los periodos tienen entrada 0 y salida
pendiente; no se presume una duración. Se verificó acceso tanto de `victorm` como
`capturista-local`. Las firmas usan el perfil privado local explícito de development
para este Docker, fuera de public; no se modificó un bucket remoto.


## Prueba del campo y acciones del jugador (PDGLD-18)

### PR86-04: preparación desde una cédula vacía

El 15 de noviembre se preparó también PR86-04 en Docker local, a petición del
usuario. Estaba SCHEDULED: los jugadores eran elegibles, pero el estado impedía
convocarlos. Se cambió únicamente ese fixture a CONFIRMED, incrementando su
versión de 1 a 2 y dejando historial explícito de preparación sintética. La
designación aprobada de `victorm` ya existía. No se creó ni reemplazó una cédula.

Enlace: `/matches/adf1bfb6-a1b3-5322-a75e-7702325dd53e/report`. Recargar la página
tras el ajuste; marcar convocados, asignar titulares y capitanes y guardar el once
para iniciar el partido. Se comprobó con los servicios reales que `victorm` y
`capturista-local` tienen captura habilitada, con 13 elegibles y un bloqueado por
equipo. La captura existente de PR86-05 se comparó antes/después y se conservó.

### PR86-05: continuar una captura existente

La migración `20261115020000_pdgld18_tactics_and_kits` se aplicó a Docker local,
tras comprobar destino e historial, y se regeneró Prisma 7. Si `next dev` estaba
abierto al regenerarlo, reiniciarlo con Ctrl+C y `npm run dev`. No hace falta borrar
volúmenes, reiniciar la base, cambiar datos del partido ni regenerar contraseñas.

Con `victorm` o `capturista-local`, abrir Arbitraje → Cédula arbitral → PR86-05.
El enlace directo del fixture es `/matches/aa3bf377-1e1d-53cb-a082-6d923c844a55/report`.
Los ajustes y la captura que ya existían no se sustituyeron por nuevos fixtures.

1. En **Alineaciones → Once inicial**, elegir una de las quince formaciones o
   Personalizada. Si no se eligió ninguna, se indica distribución provisional.
2. Tocar una posición, seleccionar un jugador elegible y su dorsal del partido.
   No puede ocupar dos posiciones. Quien sea reemplazado en el once queda en banca
   si sigue convocado. Para probar suplentes del fixture, marcar #12 o #13 en
   Convocados y dorsales; #14 permanece bloqueado con su motivo.
3. En Personalizada, ajustar horizontal/vertical con el control táctil o flechas
   del teclado. Aplicar posición, guardar borrador, recargar y verificar ubicación.
4. Abrir **Uniforme**, elegir local/visitante registrado o Colores de este partido.
   Ajustar ambos colores con el selector nativo, aplicar y guardar. Tras recargar
   deben mantenerse. Los clubes antiguos conservan su texto y no reciben RGB
   supuesto. El fixture permite indicar los colores del encuentro desde aquí.
5. En **En cancha**, tocar un jugador. El diálogo debe mostrar foto autorizada o
   playera, dorsal, nombre e historial; los seis botones usan nuestra paleta.
6. Registrar Lesión sin minuto: se agrega el evento y una marca al jugador, pero
   no se sustituye. Registrar Gol debe actualizar el marcador; editarlo o quitarlo
   también recalcula los goles capturados. No se infieren autogoles/defaults.
7. Registrar Cambio: el saliente queda precargado y se elige un suplente. El campo
   muestra al entrante en ese lugar; Once inicial conserva al titular. Si se indican
   periodo y minuto, Participación muestra entrada/salida derivadas. Con tiempos
   desconocidos, usar el orden del registro; las flechas permiten corregirlo.
8. Registrar Roja con descripción: deja vacante el lugar. El jugador permanece
   consultable en el historial. No agrega otro jugador ni impone una sanción.
9. Guardar, recargar y comprobar formación, colores, dorsales y eventos. Repetir
   con capturista y árbitro. Repetir acceso directo con actor ajeno: debe denegarse.
10. En un partido CONFIRMED se pueden preparar y guardar alineaciones, pero no
    registrar eventos, tiempos, marcador o firmas. DRAFT y FINISHED no se editan.
    Este cambio no inicia partidos ni incorpora el PR #56 pendiente.
11. En **Afiliación nueva**, definir uniformes local/visitante con color principal
    y secundario. El servidor recibe RGB validados, conserva descripción compatible
    y los equipos usan esos juegos como referencia en esa temporada. Una corrección
    mantiene los colores previos hasta que se cambien explícitamente.

Las fotos requieren un PHOTO VALIDATED y confirmado para la identidad vigente en
el Storage privado existente. Los 28 jugadores sintéticos persistentes no tienen
fotos personales; muestran playeras. La prueba SQL positiva utiliza un PNG sintético
con transporte inyectado; no acredita una llamada a Supabase. El handler HTTP
comprueba 401/403 con sesiones reales sin alcanzar Storage para actores ajenos.
Al consultar evidencia histórica se evita sustituirla por una foto actual.

Evidencia adicional: las cinco pruebas de `test:match-report-tactics` verifican
formaciones, posiciones duplicadas, cambio/roja/lesión, captura posterior con/sin
minutos, reversibilidad de tiempos y RGB/compatibilidad de huellas. La suite de
base usa el rol limitado Preview con RLS: comprueba posiciones de equipo ajeno,
cambios inconsistentes, persistencia de colores y fotos privadas con doble
autorización, hash y revocación durante lectura. No invoca CURP/INE ni Supabase.
La confirmación oficial continúa bloqueada por los receptores de cierre; este
recorrido verifica guardado real de borradores y la interfaz, no el cierre oficial.


## Revisión del once y captura en vivo

1. Abrir PR86-05: sus datos se conservan. Elegir formaciones de ambos equipos,
   capitanes y revisar dorsales. Personalizada permite escribir 4-2-2-2 y mover
   jugadores directamente; también mantiene rangos de teclado.
2. Repetir un dorsal en el mismo equipo (titular o banca): ambos campos deben
   mostrar error y el guardado no debe enviarse. Corregirlo. Repetir el mismo
   número en equipos distintos está permitido. El servidor vuelve a comprobarlo.
3. En Uniforme, cambiar colores del portero y comprobar su playera. Elegir el
   mismo principal que el equipo debe impedir aplicar/guardar esa combinación.
4. Arrastrar desde el asa de banca a una posición con ratón o tacto; probar también
   tocar al suplente y después la posición. Mover una playera sobre el campo.
   Antes del sello no aparece En cancha. Nada de esto bloquea el once por sí solo.
5. Continuar abre la revisión de ambos equipos y de las vacantes. Cancelar mantiene
   la edición. Aceptar y Confirmar y guardar alineaciones espera acuse. Tras él,
   recargar: los dorsales, convocatoria, capitanes, posiciones y uniformes quedan
   bloqueados. Un POST que intente cambiarlos se rechaza también en servidor.
6. En Captura en vivo, pulsar Iniciar partido y confirmar 45 min y descanso 15.
   Si estaba CONFIRMED, debe pasar a IN_PROGRESS con un solo historial; si ya estaba
   IN_PROGRESS, solo se inicia el reloj. Recargar no debe reiniciarlo.
7. Tocar un jugador: aparece el modal Gol, Amarilla, Roja, Cambio, Lesión e Incidente.
   La acción propone minuto/periodo del reloj; se puede corregir. Aplicar guarda con
   acuse y recalcula marcador. Ante desconexión se conserva el mismo envío.
8. Al minuto 45 aparece aviso de compensación y el reloj sigue sumando. Declarar
   los minutos indicados. Terminar tiempo y confirmar inicia descanso de 15 min;
   ajustar a 20 conserva su inicio. Iniciar segundo tiempo comienza el segundo
   contador. Finalizar ese periodo detiene el reloj sin cerrar oficialmente partido.
9. En Captura posterior, usar Participación/Eventos con minutos manuales y sin
   necesidad de iniciar reloj. El sello inicial permanece en vigor.
10. Abrir otra sesión sobre la misma versión y guardar: se conserva el conflicto.
    Reintentar el inicio/sello con su clave original devuelve el acuse sin duplicar
    historial ni cambiar el instante de inicio. Actor ajeno no puede operar el reloj.

El reloj no establece reglas reglamentarias nuevas sobre mínimos, reingresos o
cruces pendientes. Las vacantes se revisan explícitamente. Las notificaciones se
comprueban con la página abierta; no hay PWA ni avisos garantizados en segundo plano.


### Sustituciones sin reingreso

En captura en vivo, el selector de entrante contiene solo banca del equipo: no
incluye titulares en cancha, expulsados ni jugadores ya sustituidos. Indicar
periodo/minuto no amplía esa lista. Después del primer cambio, abrir otro y
comprobar que el saliente anterior no aparece. Un POST que intente reingresarlo
debe responder INVALID_SUBSTITUTION_ORDER sin guardar ni generar acuse. En edición
posterior se reconstruye la banca anterior al evento, y el servidor valida toda
la secuencia resultante. Esta prohibición fue confirmada expresamente por el
usuario; no se habilitan excepciones por identidad, sanciones u otras reglas pendientes.


### Segunda amarilla y relevo de capitán

Por indicación del usuario, la segunda CAUTION del mismo jugador/equipo implica
expulsión por segunda amarilla: se conserva cada tarjeta original, se deriva una
sola expulsión (sin fabricar otra operación o roja directa), se retira al jugador,
se deja vacante su posición y se cierra la participación en el minuto conocido.
No permite sustitución ni reingreso. La marca roja y el motivo quedan en historial
y consulta del jugador. El contrato del receptor de disciplina recibe también
`dismissals` con evento causante y razón SECOND_CAUTION/DIRECT_RED; sigue sin
implementarse el cierre oficial ni imponerse sanciones automáticamente.

Cuando el capitán sale por cambio o expulsión, el evento exige
`replacementCaptainId`, elegido entre quienes quedan en cancha (puede ser el
entrante). El servidor valida pertenencia y la secuencia completa. El capitán
inicial no cambia ni se desbloquea la alineación: el relevo queda en el JSON
serializable del evento, y se deriva el capitán vigente para la marca C y la firma
final. Cambiar el evento invalida las firmas anteriores por su vinculación al
contenido. Los eventos y firmas existentes no se modifican silenciosamente.
Si la salida del capitán se capturó antes de esta revisión sin indicar relevo,
se debe editar ese cambio/expulsión para elegirlo antes de continuar guardando.

Prueba manual: sustituir al capitán, elegir entrante y comprobar que no se puede
aplicar sin nuevo capitán; elegir a un jugador que permanezca y verificar C y firma.
Registrar dos amarillas a otro jugador: tras la primera permanece, tras la segunda
sale, deja vacante y no aparece en el selector de entrantes. Reintentar la misma
operación conserva sus eventos originales y no duplica una roja derivada.


### Precisión y marcas acumuladas

Los eventos admiten `second` opcional 0..59, solo con minuto indicado. La migración
aditiva `20261115040000_pdgld18_event_seconds` añade match_events.second nullable;
no completa los históricos con 00. Preview solo incorpora esa columna a INSERT.
En vivo se propone minuto/segundo del mismo instante del reloj, conservado en la
operación para reintentos. La captura posterior permite ambos valores y la consulta
muestra MM:SS; los segundos históricos ausentes se indican como desconocidos.
La proyección SQL es parametrizada y guarda la precisión junto con el evento.
La participación por periodos conserva su contrato de minutos, sin inventar tiempos
más precisos ni totales jugados. Con precisión completa, los eventos se ordenan
por periodo, minuto y segundo; si faltan segundos, se conserva el orden dentro del
minuto en vez de asumir 00.

Se muestra un balón por cada GOAL y una tarjeta por cada CAUTION, con roja tras la
segunda amarilla. Los iconos se apilan verticalmente con desplazamiento del 50%:
cada uno cubre la mitad del anterior. Se conservan nombres accesibles por icono y
las marcas aparecen en campo, modal e historial del retirado. La segunda amarilla
sigue retirando al jugador; la pila no lo mantiene indebidamente en cancha.

Prueba: registrar dos goles del mismo jugador, uno en 22:34; comprobar dos balones
solapados y la hora del evento al consultar/recargar. Registrar dos amarillas a otro
jugador: en el historial deben verse dos amarillas y una roja apiladas; el jugador
ya no debe estar en cancha ni disponible para entrar de cambio.
