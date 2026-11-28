# Datos locales para revisión de la aplicación

## Acceso

Servidor en [localhost:3000](http://localhost:3000/login), conectado al contenedor `gestor_ligas_deportivas-db-1`, PostgreSQL 15, base `gestor_ligas_dev` en localhost:5433.

Las cuentas nuevas usan la contraseña sintética de [Demostración manual desechable](../authentication.md#demostración-manual-desechable). Las cuentas y registros anteriores se conservaron.

| Cuenta | Recorrido |
| --- | --- |
| `admin-local` | Cuentas, permisos, competencias y administración global según la matriz vigente. |
| `consulta-local` | Secretaría, revisión de afiliaciones y jugadores, consultas de tesorería. |
| `tesoreria-local` | Alta, consulta, corrección y generación de cargos. |
| `arbitraje-local` | Padrón, propuestas de clubes y designaciones. |
| `programador-local` | Calendarios, propuestas y registro de partidos. |
| `capturista-local-175` | Operación de partidos conforme a sus capacidades. Se conservó la cuenta previa `capturista-local`. |
| `disciplina-local` | Catálogo disciplinario y denegación de escritura financiera. |
| `presidencia-local` | Revisión de préstamos después del visto bueno del club propietario. |
| `delegado-local-01` a `delegado-local-20` | Cada cuenta representa únicamente el club correspondiente de la tabla siguiente. |
| `arbitro-local-1` a `arbitro-local-5` | Disponibilidad propia y los partidos que la Comisión les asigne efectivamente. |
| `temporal-local-175`, `inactiva-local-175` | Cambio obligatorio de contraseña y rechazo de acceso. |

## Clubes y equipos

Se agregaron 20 clubes, un equipo por club y 11 jugadores ficticios por equipo. Los nombres de clubes son referencias reconocibles para la prueba local. Las afiliaciones, jugadores, árbitros, ubicaciones y documentos del escenario son ficticios. Los identificadores de jugadores tienen formato sintético y sus inscripciones conservan la revisión de identidad pendiente.

| Delegado | Club |
| --- | --- |
| 01 | Monarcas Morelia |
| 02 | Real Madrid |
| 03 | Pumas |
| 04 | Chivas |
| 05 | Barcelona |
| 06 | América |
| 07 | Cruz Azul |
| 08 | Tigres |
| 09 | Toluca |
| 10 | Atlas |
| 11 | Pachuca |
| 12 | León |
| 13 | Liverpool |
| 14 | Manchester City |
| 15 | Bayern Múnich |
| 16 | Juventus |
| 17 | Inter de Milán |
| 18 | Boca Juniors |
| 19 | River Plate |
| 20 | Santos Laguna |

El contexto nuevo se llama **Liga local de tesorería**. La **Temporada local 2026–2027** tiene categoría Libre local, dos grupos y diez partidos en borrador. **Trámites locales pendientes** contiene tres afiliaciones pendientes y una rechazada para corregir. **Calendario local por revisar** contiene inscripciones de los mismos equipos y nueve jornadas, con dos propuestas generadas por el servicio de programación.

Las reglas de ejemplo usan 3/1/0 puntos, desempates por puntos/diferencia/goles/victorias, una vuelta y partidos de 90 minutos. Son valores exclusivos del escenario ficticio. La versión anterior de reglas permanece disponible en el catálogo. La clasificación inicial usa el motor real y tiene cero resultados oficiales.

## Recorridos preparados

| Módulo y ruta | Datos y recorrido manual |
| --- | --- |
| Cuentas y acceso, `/accounts`, `/access` | Usar las cuentas de rol, temporal e inactiva. Crear una cuenta desde administración, probar cambio de correo y restablecimiento con la configuración de transporte vigente. |
| Clubes y equipos, `/clubs`, `/teams/registrations` | Consultar los 20 clubes y sus inscripciones. Comparar el alcance de dos delegados. |
| Afiliaciones, `/affiliations/new`, `/affiliations/review` | Revisar la temporada de trámites pendientes y la solicitud rechazada. Las firmas nuevas se capturan desde la interfaz. |
| Jugadores, `/players/registrations`, `/players/review` | 220 jugadores nuevos con dorsales y datos ficticios. Abrir expedientes, subir documentos y revisar identidad. CURP/INE reales corresponden exclusivamente al equipo humano. |
| Fotos | Se conservaron los dos objetos originales de `expedientes-jugadores` en Supabase de pruebas. Se verificaron tamaño/hash y se asociaron, pendientes de revisión documental, al primer jugador de Monarcas y al primero de Pumas. |
| Competencias, `/competitions/seasons` | Tres temporadas nuevas para separar el trabajo manual de captura, afiliaciones y programación. Consultar versiones de reglas, categorías, grupos e inscripciones. |
| Gobierno, `/governance` | Comité local y nombramientos de Secretaría, Tesorería y Arbitraje. |
| Canchas, `/venues` | Morelos, Bernabéu, Camp Nou, Olímpico Universitario, Akron y Azteca con disponibilidad de prueba. Morelos tiene un mantenimiento que permite probar el bloqueo. |
| Préstamos, `/venues/loans` | Dos canchas privadas de entrenamiento, de Monarcas y Real Madrid. Dos solicitudes con PDF y marca de firma ficticia, pendientes del propietario y de Presidencia. El delegado 02 revisa la solicitud de Monarcas sobre su cancha. El delegado 01 revisa la de Pumas. Después actúa `presidencia-local`. |
| Propuestas arbitrales, `/referees/presentations` | Los cinco primeros clubes tienen árbitros en padrón. Los otros 15 tienen candidatos pendientes con acreditaciones PDF ficticias en Storage privado de pruebas. Comisión puede consultar el documento y aprobar o rechazar usando el recorrido vigente. |
| Padrón y disponibilidad, `/referees`, `/referees/my-availability` | Cinco árbitros nuevos con cuenta propia, vínculo de club y disponibilidad. Probar designación a un partido ajeno al grupo de su club y la denegación por conflicto. Se conservaron las designaciones anteriores de la base. |
| Calendario, `/competitions/scheduling`, `/scheduling/proposals` | Dos propuestas generadas para la temporada de calendario. Revisar, ajustar, aprobar y registrar desde la interfaz. Guardar una propuesta conserva su estado propio. |
| Partidos, `/matches/recording`, `/matches` | Diez encuentros en borrador en la temporada principal. Programar, designar y confirmar con las cuentas correspondientes. La captura de cédula exige un partido y asignación efectivos. |
| Cédula y offline | La base conservó su cédula anterior. Para los partidos nuevos, completar programación, designación y habilitación antes de preparar la copia offline. Capturar y cerrar con el flujo real. |
| Clasificación, `/standings` | Dos versiones iniciales calculadas, sin resultados oficiales. Confirmar una cédula actualiza la clasificación mediante su integración existente. |
| Disciplina, `/discipline/catalog` | Artículo ficticio editable en la versión borrador y una versión aprobada para la competencia. La resolución de expedientes de PDGLD-27 sigue pendiente de implementación. |
| Tesorería, `/treasury/charges` | Dos cargos y un plan semanal creados por el recorrido real. Monarcas tiene una corrección de importe con motivo. Pumas tiene un cargo de cancha semanal generado y recuperado al repetir el periodo. |
| Portal y temas | Usar Portal público desde el menú de cuenta y comprobar ambos temas. La publicación de información oficial depende de los módulos implementados y sus acuses. |

La preparación proporciona datos para entrar en estos recorridos. La aceptación funcional, las combinaciones negativas, concurrencia, rollback y la regresión completa requieren su etapa de pruebas. Los jugadores nuevos permanecen pendientes de habilitación y los candidatos pendientes requieren la decisión de Comisión. Las funcionalidades todavía pendientes en Jira conservan su bloqueo.

## Carga reproducible

Los comandos siguientes ya se ejecutaron sobre Docker local. Cada script conserva un marcador o recupera registros existentes. Repetirlos conserva los cambios posteriores realizados en la interfaz.

```powershell
node --import tsx scripts/seed-treasury-demo.mts
node --conditions=react-server --import tsx scripts/seed-app-local-scenarios.mts
node --conditions=react-server --import tsx scripts/seed-local-player-photos.mts
node --conditions=react-server --import tsx scripts/seed-local-competition.mts
node --conditions=react-server --import tsx scripts/seed-local-private-documents.mts
```

Los scripts exigen `gestor_ligas_dev` en loopback y puertos de desarrollo. Los dos que usan Storage exigen además el proyecto de pruebas `loaztwwpwsaqzdtdtvvj`. Las fotos originales se reutilizan por referencia. Los nuevos PDFs se cargaron en los buckets privados de acreditaciones y cartas. Se añadió únicamente la configuración del bucket de cartas a `.env.local`, conservando sus demás valores.
