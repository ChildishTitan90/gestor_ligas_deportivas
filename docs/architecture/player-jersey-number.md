# Dorsal habitual por inscripción

Decisión de Sergio, 09/11/2026: el dorsal es opcional al capturar al jugador. Una vez elegido queda fijo hasta una nueva temporada. No puede repetirse dentro del mismo equipo inscrito; una baja no libera el número durante esa temporada.

- `player_registrations.jersey_number` guarda el dorsal habitual. La inscripción contiene equipo y temporada; la siguiente temporada crea otra inscripción y permite elegir otro número sin cambiar la anterior.
- Los registros existentes conservan `NULL` y pueden completar el número una sola vez desde el expediente, con permiso `players:UPDATE` y lectura autorizada del ámbito real. Se bloquean bajas, equipos no operativos y temporadas cerradas.
- PostgreSQL garantiza unicidad por `season_team_id, jersey_number` y un trigger impide cambiar o quitar un dorsal asignado. Varios registros pueden permanecer sin asignar. Se aceptan enteros no negativos dentro del tipo `integer`; no se ha impuesto un rango reglamentario adicional.
- La actualización bloquea la inscripción y revalida permisos. Repetir el mismo número es idempotente; otro número devuelve `JERSEY_NUMBER_LOCKED`. Una colisión devuelve `JERSEY_NUMBER_TAKEN` sin revelar datos del otro jugador. La auditoría existente registra la escritura y el actor, sin un segundo evento duplicado.
- La operación escribe solamente el dorsal: no cambia Persona, CURP, INE, documentos, estado de inscripción ni verificaciones de elegibilidad. Un reenvío del alta recupera la inscripción existente sin reasignar su dorsal.
- `lineups.jersey_number` conserva el número usado en cada partido. Esta entrega no modifica alineaciones ni propone automáticamente dorsales en cédulas; ese uso queda para el sprint de arbitraje y debe contemplar las participaciones en categoría superior.

## Interfaz

El formulario de alta ofrece el dorsal opcional y advierte que es definitivo para la temporada. El listado y expediente muestran el valor o «Sin asignar». El expediente permite asignar un número pendiente, con estados de envío y respuesta incierta; un reintento conserva exactamente el número enviado. Se reutilizan los estilos, temas y controles del espacio de jugadores.

## Aplicación

La migración nueva no rellena datos históricos ni modifica cédulas. Aplicarla mediante el procedimiento habitual de migraciones y generar Prisma antes de usar la aplicación. No se aplica automáticamente a la base habitual ni a producción desde esta tarea.

## Validación del recorrido — 09/11/2026

El primer laboratorio conservaba incorrectamente `AUTH_TEST_RUN=1` en el servidor HTTP sin inyectar transporte sintético. El proveedor lanza deliberadamente `SYNTHETIC_TRANSPORT_REQUIRED` en ese modo; el alta ya había sido confirmada por su transacción, pero su verificación posterior no podía responder. Esta protección está también en `develop` y no fue introducida por el dorsal. No se cambió código de cuentas ni se debilitó el bloqueo del proveedor.

Se corrigió la configuración del laboratorio: servidor de demostración fuera de `AUTH_TEST_RUN`, clave del proveedor explícitamente vacía y base temporal con datos ficticios. Las suites automatizadas conservan su modo de pruebas e inyectan proveedor sintético.

Comprobaciones HTTP con sesión real: altas con y sin dorsal devuelven 200 y `NOT_CONFIGURED`, cumplen el contrato del cliente y se recuperan por reenvío sin duplicarse. El mismo jugador conserva 10 en 2026 y 7 en 2027. Una inscripción sin dorsal acepta 12 una sola vez; repetir 12 es seguro, cambiarlo devuelve 409, quitarlo devuelve 400 y tomar un dorsal ocupado devuelve 409. El listado conserva los tres números correctos.

En el navegador se confirmó el envío sin pantalla de resultado incierto ni recuperación manual. No se consultaron proveedores de CURP/INE, no se subieron documentos ni se modificó la base habitual. Las cuentas, bases y scripts específicos de demostración se eliminan después del recorrido.
