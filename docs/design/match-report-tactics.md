# PDGLD-18 · Campo, uniformes y acciones del jugador

La captura real conserva ManagementShell, navegación autorizada, cinco etapas,
SelectField, FormDialog y las firmas existentes. El campo sustituye la elección de
titulares mediante una lista de roles; convocatoria, capitanía y dorsales siguen
disponibles en la misma página. No hay cédula completa dentro de un modal.

## Preparación y consulta del campo

- En móvil se cambia entre Local y Visitante sin perder la captura. En escritorio
  amplio se muestran ambos equipos. Convocados y dorsales se despliega para evitar
  una lista extensa antes del siguiente equipo.
- Once inicial permite elegir formación y asignar jugadores a sus once posiciones.
  El selector incluye las quince formaciones de PFSA y Personalizada. Sin elección
  se informa distribución provisional; no se afirma una formación del equipo.
- Las posiciones son botones con nombre accesible, jugador y dorsal. Asignar abre
  un diálogo breve con SelectField y dorsal. Los bloqueados conservan su motivo y
  no pueden elegirse. Un jugador no puede ocupar dos posiciones.
- Los demás convocados son banca. Los ausentes sin convocar no se convierten en
  suplentes. Cambiar al titular no elimina al anterior de la convocatoria.
- Personalizada usa coordenadas con controles de rango; funciona con tacto y
  teclado sin exigir arrastrar. La captura admite posiciones todavía vacías.
- En cancha representa cambios y expulsiones sobre el esquema conservando el
  once inicial. La roja deja un lugar vacante. La lesión solo agrega su marca.
  No representa seguimiento físico ni determina sanciones o recuperación.
- Con tiempos desconocidos se informa el orden del registro; las flechas del
  listado permiten corregirlo. Con tiempos completos se usa periodo y minuto.

## Apariencia y acciones

El campo tiene tokens propios `--pitch`, `--pitch-line` y `--pitch-foreground` en
ambos temas. Las playeras SVG usan el uniforme del encuentro. Sus dorsales tienen
una placa de contraste independiente del color elegido. Nombres completos están
en la etiqueta accesible, el diálogo y la convocatoria; el campo los abrevia por
espacio. Las marcas de capitán, gol, tarjeta y lesión acompañan el historial textual.

El panel del jugador reutiliza FormDialog: cabecera con identidad mínima y una
cuadrícula de seis acciones táctiles, condicionadas al catálogo del partido. Gol,
Amarilla, Roja, Cambio, Lesión e Incidente llevan icono y texto. Se conservan
superficies y bordes de la aplicación; amarillo/rojo son semánticos y el cobre
identifica foco/selección. Elegir una acción abre sus campos; no registra el evento
por tocar la playera. Periodo y minuto siguen siendo opcionales.

Cambio precarga al saliente si se abrió desde cancha, o al entrante si se abrió
desde banca. Los cambios sin tiempos completos siguen el orden explícito del
registro. Los jugadores que salieron quedan consultables en su historial.

La fotografía privada se muestra cuando está disponible y autorizada. Si falla o
no existe, aparece la playera con dorsal y nombre. No se publican las fotos del
expediente ni se utiliza el optimizador de imágenes para omitir la sesión.

## Uniformes

ColorField comparte el selector nativo, etiquetas, foco y objetivo táctil de 48 px.
El formulario de afiliación captura principal/secundario de local y visitante.
Los equipos heredan esa referencia de temporada; la cédula conserva su propia
copia del uniforme elegido, incluso si después cambian los colores del club.
El texto histórico no se interpreta automáticamente. También se pueden indicar
colores propios del encuentro cuando no hay RGB registrados.

## Validación

`npm run test:match-report-ui` comprueba los componentes con datos sintéticos en
Chrome, temas claro/oscuro, anchos 360/390/1440, foco, teclado, descartes, doble envío,
conflicto y respuesta incierta. Incluye equipo móvil, asignación, posición
personalizada, uniforme y acciones del jugador. La aceptación con sesión,
PostgreSQL y rol limitado se documenta por separado en
[PDGLD-147](../validation/PDGLD-147-online.md); las imágenes de componentes no
acreditan una confirmación oficial del partido.


## Revisión: confirmación del once, arrastre y captura en vivo

Antes de confirmar, En cancha permanece oculto. Continuar abre un diálogo de
revisión de ambos equipos y de sus posiciones vacantes; el usuario debe aceptar
explícitamente el bloqueo. Solo el acuse del servidor bloquea convocatoria,
titulares, capitanes, dorsales, formación, coordenadas y uniformes. Guardar borrador
permite avanzar sin bloquear. Se conservan editables tiempos y eventos después.
La captura de partidos incompletos no establece un mínimo reglamentario nuevo:
el diálogo muestra las vacantes y exige revisarlas; las reglas de categoría
pendientes no se consideran concedidas.

Los dorsales repetidos se señalan junto a ambos campos y bloquean el guardado.
La validación incluye banca y se acota al equipo: equipos distintos pueden usar
el mismo dorsal. El diálogo de posición aplica la misma comprobación. El portero
utiliza amarillo como referencia inicial (azul si el equipo viste amarillo),
ajustable por partido en Uniforme. Su principal debe diferenciarse del equipo.

Personalizada incluye texto, por ejemplo 4-2-2-2, con diez jugadores de campo y
portero separado. El texto redistribuye los lugares; las playeras también se
pueden mover directamente antes del bloqueo. Banca admite arrastre mediante asa
con ratón/tacto y la alternativa tocar jugador y posición. Se mantienen selección
por diálogo y rangos de teclado. El arrastre se cancela al salir del campo o
cruzar al otro equipo; el borde de pantalla permite desplazamiento vertical.

Después del bloqueo aparecen Captura en vivo y Captura posterior. En vivo se
inicia el reloj con base 45/45 y descanso 15, revisables al iniciar. El reloj
persiste su ancla en el servidor y cuenta a partir de ella tras recargar; no se
escribe en SQL cada segundo. Al cumplir la base aparece aviso para declarar
compensación y sigue sumando. Al terminar el periodo, la confirmación del operador
inicia el descanso. Este puede ajustarse antes de iniciar el segundo tiempo;
el cumplimiento del reloj avisa, no declara por sí solo decisiones arbitrales.

El modal del jugador conserva las seis acciones de la referencia. En vivo propone
periodo y minuto relativos al tiempo activo; son editables porque la hora del
dispositivo no acredita el minuto oficial. Aplicar un evento envía el guardado,
actualiza marcador y conserva operación/contenido ante resultado incierto.
Participación y Eventos permiten registrar después sin depender del reloj.
Terminar el segundo tiempo detiene el reloj; no confirma la cédula ni finaliza
oficialmente el partido. No hay Service Worker, cola offline ni IndexedDB.


El selector de sustituciones en vivo muestra exclusivamente suplentes disponibles.
Un saliente o expulsado no puede reingresar en cambios posteriores. Tener minuto
sugerido por el reloj no abre opciones de todo el plantel. La captura posterior
reconstruye la banca antes del evento para permitir ordenar correctamente hechos
anteriores, conservando el rechazo a reingresos en la secuencia completa.


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

Quien entra de cambio muestra una insignia de flechas sobre su playera/foto,
con texto accesible «Entró de cambio». Se deriva del evento conservado, sin una
bandera visual independiente que pueda perderse al guardar o recargar.


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
cada uno cubre la mitad del anterior. Las tarjetas llevan borde oscuro opaco de
2 px para distinguir sus contornos al solaparse. Se conservan nombres accesibles por icono y
las marcas aparecen en campo, modal e historial del retirado. La segunda amarilla
sigue retirando al jugador; la pila no lo mantiene indebidamente en cancha.

Prueba: registrar dos goles del mismo jugador, uno en 22:34; comprobar dos balones
solapados y la hora del evento al consultar/recargar. Registrar dos amarillas a otro
jugador: en el historial deben verse dos amarillas y una roja apiladas; el jugador
ya no debe estar en cancha ni disponible para entrar de cambio.

### Intercambio de posiciones

Antes de guardar el once, arrastrar un titular sobre otra posición intercambia
ambos jugadores, manteniendo las coordenadas del esquema, sus dorsales y su
convocatoria. Si el destino está vacío, el origen queda vacante. Soltar en campo
libre conserva el ajuste de ubicación personalizada. El intercambio funciona con
ratón y pantalla táctil y conserva el bloqueo del once ya guardado.

### Cambios durante el descanso

En el modal del jugador, el descanso permite únicamente Cambio. Gol, amarilla,
roja, lesión e incidente quedan deshabilitados hasta reanudar el juego. El cambio
solo ofrece banca disponible y conserva el relevo obligatorio del capitán.
Su tiempo queda fijo en P2, 45:00 para tiempos de 45 minutos; no usa los minutos
transcurridos del descanso ni la compensación del primer tiempo. Si el operador
configuró tiempos de 40 minutos, se registra 40:00. Los cambios durante el juego
siguen disponibles.

El segundo tiempo propone tiempos del partido: 45:00 al iniciar y 50:00 cinco
minutos después. La participación mantiene minutos relativos al periodo: el
suplente del descanso entra en el minuto 0 del periodo 2. Los eventos anteriores
conservan sus datos; no se completan ni convierten silenciosamente.

Prueba manual: terminar el primer tiempo, abrir un titular y comprobar que solo
Cambio está habilitado. Elegir banca, guardar y comprobar P2 45:00 en Eventos.
Recargar y comprobar el suplente en cancha. Iniciar el segundo tiempo: reloj y
nuevos eventos parten de 45:00. Confirmar que quien salió no puede reingresar.
