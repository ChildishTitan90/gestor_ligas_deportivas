# PDGLD-16 · Evidencia de cierre técnico

Seguimiento del PR #53, 18/11/2026. Base `develop` 129d1f8; rama
`feat/PDGLD-16-mitades-cedula`. El árbol original, `compose.yml` y stashes no
forman parte de esta entrega. No hay migraciones ni llamadas a proveedores reales.
La evidencia técnica no sustituye revisión y aceptación humana ni cierra Jira.

## Matriz de criterios

| Criterio de Jira/ERS | Implementación y prueba |
| --- | --- |
| Origen o superior inmediata autorizada | Evaluador común; fixtures de familia, nivel y autorización, sin cambiar la inscripción original |
| Plantilla del encuentro | Ambas plantillas visibles; otra categoría sin autorización excluida completamente del DTO |
| Pertenencia y sanciones | Triggers de cambio de equipo; sanción en fecha del partido con inicio inclusivo y fin exclusivo |
| Horarios coincidentes, RF02.7 | Reserva por mitad en cédula; combinación complementaria del mismo club/temporada y categoría distinta; marcas reales del reloj |
| Retrasos, compensación y evidencia incompleta | Pruebas sin duración supuesta, frontera contigua válida, cruce real rechazado y ausencia de marcas rechazada |
| Captura y persistencia con PDGLD-18 | Servicio real guarda reserva, periodos y reloj; lectura del almacenamiento confirma los valores; acuse idempotente |
| Guardado concurrente | Versiones y locks del partido; carrera de reprogramación; serialización por Persona y comprobación de espera con `pg_blocking_pids` |
| Bloqueo conserva captura | Rechazo por cruce/marcas ausentes no incrementa versión ni borra periodos anteriores |
| Autoridad y privacidad | Árbitro designado / DATA_ENTRY según recorrido, rol ajeno denegado, sanciones no eludidas por elegir mitad |
| Interfaz real | Prueba de NextAuth + HTTP + Chrome sobre PostgreSQL con rol Preview/RLS; reserva y tiempos al guardar/reabrir |

La prueba de dos categorías emplea fixtures de reloj y partido dentro de una
transacción que revierte al finalizar; escribe mediante `mutateReportInTransaction`.
La prueba Chrome usa reloj/controles reales en una cédula y comprueba persistencia.
No se presenta como dos partidos disputados físicamente ni como aceptación de Liga.

## Reproducir

1. `npm ci`.
2. `npm run typecheck && npm run lint && npm run test:ci`.
3. `npm run test:match-report-tactics`.
4. `node scripts/test-match-eligibility-isolated.mjs --postgres=15` y repetir con
   `--postgres=17`. Docker debe estar disponible; runners crean y eliminan
   únicamente contenedores sintéticos propios, sin volúmenes heredados.
5. `CHROME_BIN=/ruta/a/chrome node --conditions=react-server --import tsx
   scripts/match-reports-local.mts --http --browser --postgres=17`.
   No permite conexiones de base heredadas; crea fixtures, rol limitado y app local.
6. `npm run build` con URL local y secreto sintético efímero.

En este entorno no hay daemon Docker. Para ejecutar los runners se adaptó
externamente su ciclo de contenedor a PostgreSQL embebido 15.19 / 17.11,
loopback y bases desechables. No se modificaron los runners ni las guardas de
conexión del repositorio. Los resultados de servicios y SQL son reales; no
acreditan ejecución nativa de Docker. La diferencia inicial de zona horaria del
runtime embebido se corrigió configurándolo en UTC, sin alterar autorización.

## Recorrido de revisión

1. Con árbitro designado o capturista autorizado, abrir la cédula real.
2. En convocados elegir primera mitad en el origen y segunda en el destino
   autorizado; revisar que el segundo inicia en banca. Sellar cada alineación.
3. Iniciar/terminar primera mitad con los controles del reloj. Registrar la
   sustitución del descanso, segundo periodo, minuto relativo y segundo cero.
4. Iniciar segunda mitad del destino después del cierre real del primero. Un
   comienzo previo o marcas ausentes deben impedir la captura.
5. Guardar, reabrir y comprobar la misma reserva, periodos y tiempos. Revisar que
   el bloqueo posterior conserva la captura guardada y no duplica acuses.
6. Revisar el mismo flujo con actor ajeno y jugador sancionado: deben rechazarse.

## Condición de cierre en Jira

Solicitar revisión de este seguimiento como PR normal hacia `develop`, verificar
su CI e integrarlo según las reglas del equipo. Añadir el PR y resultados de
validación a PDGLD-16 y obtener aceptación del recorrido por el responsable
funcional. La confirmación oficial de la cédula, clasificación y disciplina
conservan sus bloqueos de otras historias; no se implementan como parte de PDGLD-16.

## Resultados de esta ejecución

- Tipado y lint aprobados; controles de pipeline 93/93; pruebas puras de cédula,
  reloj y mitades 18/18; `npm run build` aprobado.
- Elegibilidad e integración PostgreSQL: 21/21 en 15 y 17 (incluye regresiones
  reutilizadas de jugadores). Los casos nuevos comprueban persistencia entre
  categorías, rechazo de cruce/marcas ausentes y espera real por Persona.
- Cédula con rol limitado/RLS y sesión NextAuth/HTTP reales: aprobada en PostgreSQL
  15; en 17 alcanzó el recorrido HTTP antes del arranque de Chrome.
- **Chrome integrado pendiente de ejecutar en un equipo compatible**: este runtime
  aborta el navegador al crear su socket local (`Operation not permitted`), antes
  de publicar CDP. No se presenta como prueba aprobada ni se debilitan las guardas
  del runner. El caso actualizado comprueba reserva por mitad y tiempos al reabrir.
- CI remoto y revisión humana deben verificarse después de publicar la rama.

El build emitió un aviso de seguridad de la versión instalada de Next.js en una
repetición; la siguiente ejecución del mismo comando terminó correctamente.
No se cambió la dependencia ni se desactivó ese control. Ese aviso debe revisarse
por separado del alcance funcional de PDGLD-16.
