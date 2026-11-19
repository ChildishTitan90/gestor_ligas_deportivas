# PDGLD-23: contrato inicial de localías

`homeVenueOptions` filtra las canchas para un partido de una liga y temporada. Recibe hechos resueltos en servidor: vigencia de los préstamos y sus ventanas, localía previa verificada, versión de reglas y jornadas restantes del calendario. El generador debe obtenerlos de fuentes autorizadas, nunca de datos enviados por el navegador.

- La cancha particular requiere un préstamo aprobado del club local para la misma temporada. Es la primera opción. Si no hay una particular elegible, se ofrece la unidad deportiva.
- La cancha rival es una alternativa si una localía previa verificada permite esa misma cancha y el rival tiene un préstamo aprobado para la temporada. La función no infiere el antecedente ni modifica el orden de local y visitante.
- Si faltan menos de N jornadas después de la actual, solo se ofrece la unidad deportiva. N viene de la versión del reglamento; 10 es la referencia de Jira, no un valor fijo en código. N = 0 deja inactiva la restricción.
- Partido y holgura deben caber completos en una apertura y, en una cancha particular, también en una ventana aprobada. Se mantienen los rangos semiabiertos y los bloqueos de PDGLD-22. La escritura de programación sigue siendo responsable de impedir traslapes en PostgreSQL.

La consulta de localías ya lee los préstamos aprobados de PostgreSQL. Queda pendiente invocarla al generar una propuesta y revalidar la cancha al guardar una reserva. Las aperturas generales de PDGLD-22 no acreditan un préstamo para otra temporada o club. Antes de conectar PDGLD-24, precisar qué antecedente de RF04 habilita la alternativa rival. El reglamento versiona N como `calendar.complexOnlyFinalRounds` y conserva las versiones previas que aún no definen ese valor.

## Referencia de interfaz

Usar como referencia las presentaciones de arbitraje de PDGLD-86 (PR #58): encabezado breve, contexto de club y temporada, filtro de estado y tarjetas con el estado visible. En préstamos, mostrar una acción principal para el delegado («Solicitar préstamo») y una acción por solicitud pendiente para Presidencia («Revisar»). Dentro de la revisión se consulta la carta privada y se registra la decisión con motivo. Las tarjetas muestran los horarios, su zona horaria y el motivo de la decisión. Las solicitudes resueltas muestran el resultado sin botones de decisión. Reutilizar el diálogo, los selectores y la vista previa de documentos de la aplicación.

## Cortes de entrega

1. **PDGLD-129 — Backend.** La migración conserva solicitudes legadas. El servicio registra una solicitud con carta validada, horarios y una clave de reintento; Presidencia decide una vez con motivo y auditoría. La vista previa reautoriza y nunca devuelve la clave de Storage. El servicio usa un transporte privado y `loadHomeVenueOptions` alimenta la regla con préstamos aprobados. La ruta `/api/venue-loans` registra, revisa y autoriza la consulta de la carta. La integración con el generador y el guardado de reservas queda en PDGLD-24. No convertir ventanas de un préstamo en aperturas globales.
2. **PDGLD-130 — Pantallas.** Solicitud del delegado y revisión de Presidencia, reutilizando la interfaz de arbitraje. Debe haber una acción principal por rol y por estado.
3. **PDGLD-131 — Aceptación.** Probar acceso ajeno denegado, carta privada, reenvíos, dos decisiones simultáneas, préstamo pendiente/rechazado excluido, aprobación visible en programación, unidad deportiva y últimas N jornadas.


### Integración con PDGLD-24 y entorno de pruebas

- Invocar `loadHomeVenueOptions(tx, actorId, contexto)` desde el servicio de programación, dentro de su transacción. La consulta comprueba acceso a la temporada, deriva los clubes de las inscripciones activas y cuenta jornadas posteriores del calendario; los horarios aprobados se mantienen acotados a su club y temporada. Las aperturas generales y los bloqueos de PDGLD-22 siguen aplicando.
- El llamador debe resolver N desde `calendar.complexOnlyFinalRounds` en el reglamento aprobado que aplica a la propuesta y solo pasar una cancha rival después de verificar el antecedente RF04. Si no hay antecedente verificado, omitirlo. Antes de persistir, revalidar la opción elegida y dejar que PostgreSQL compruebe disponibilidad y traslapes.
- En pruebas, configurar del lado del servidor `SUPABASE_VENUE_LOAN_LETTERS_BUCKET=cartas-prestamo-canchas` con el bucket privado, el mismo límite de tamaño y los mismos MIME admitidos para acreditaciones privadas. La prueba de integración `tests/integration/venue-loans.test.ts` usa PostgreSQL temporal y un transporte privado simulado. El CI la ejecuta en PostgreSQL 15 y 17. Verifica el alcance de la carta, reenvíos, dos decisiones concurrentes, auditoría y las opciones de localía dentro y fuera del horario aprobado. La aceptación con PDGLD-24 debe ejecutar también la generación y el guardado reales.
