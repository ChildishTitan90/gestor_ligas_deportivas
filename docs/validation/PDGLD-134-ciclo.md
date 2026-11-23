# PDGLD-134: validación parcial del ciclo de partido

En PostgreSQL temporal se probaron las transiciones implementadas, ámbito de liga, revocación de permisos, reenvíos, conflictos de versión, concurrencia e historial. También se verificó que un partido en FINISHED no pueda modificarse mediante el servicio de transiciones, incluso con permisos operativos y de aprobación. Esta prueba no acredita que otras entradas de la aplicación bloqueen toda edición directa.

Las escrituras de estado en `src` incluyen el servicio de transiciones, el inicio desde el reloj de cédula y el nuevo cierre interno. El registro de tiempos de participación bloquea FINISHED bajo bloqueo del partido y se comprobó que conserva versión de cédula y tiempos anteriores. La regresión `npm run test:match-eligibility-integration` aprobó 19 pruebas sobre un PostgreSQL nuevo y desechable. La nueva migración impide además UPDATE directo sobre un partido ya finalizado. La corrección autorizada sigue pendiente de su servicio.

Se forzó un fallo al guardar el historial y se comprobó que también revierten el estado, la versión, la auditoría y las reservas de cancha y equipos. La suite `npm run test:match-transitions-db` pasó en PostgreSQL temporal con todas las migraciones aplicadas desde cero. Falta comprobar estos cambios en CI remoto.

Pendiente: flujo completo y pruebas de reprogramación y no presentación; confirmación real de cédula con resultado y clasificación atómicos e idempotentes, más integración con PDGLD-18/25/29. El servicio de confirmación aún no está disponible en esta rama. La evidencia local no sustituye CI remoto ni revisión de otra persona.

El 16 de noviembre se añadió y probó `finishConfirmedReportMatch` como transición
interna de cédula en PostgreSQL 15 temporal. Exige resultado de la cédula y rechaza
otro expediente; registra versión, actor e historial. La entrada genérica continúa
denegando FINISHED y la confirmación visible sigue bloqueada hasta integrar
clasificación y recepción disciplinaria. Las pruebas de reglas, integración,
TypeScript y ESLint pasaron localmente.
