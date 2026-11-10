# PDGLD-124 — integridad, permisos e historial

Validación local con datos sintéticos y PostgreSQL temporal, tras integrar develop `4d795b4`.

- `npm run test:club-maintenance`: 2 pruebas de entrada y 13 de integración aprobadas en la validación previa de PDGLD-123. Incluyen alcance, bajas, reactivación, concurrencia, duplicados, referencias, permisos y auditoría.
- `npm run test:affiliations`: 27 pruebas aprobadas, solicitud y aprobación incluidas.
- `npm run test:team-enrollments`: 33 pruebas aprobadas. El recorrido real de solicitud, aprobación e inscripción incluye una comprobación adicional con el servicio de mantenimiento: rechaza el cambio de nombre y la eliminación con historial; da de baja y reactiva club y equipo; compara íntegramente la afiliación, categorías autorizadas, directivos con sus referencias de firma e inscripciones antes y después de cada operación.
- Typecheck y lint aprobados. La suite de inscripción está configurada en el workflow CI; su ejecución remota depende de publicar la rama y abrir el PR. La validación local no acredita ese resultado remoto.

Las firmas son referencias a archivos sintéticos, no archivos de personas reales. Las bases temporales se eliminan al finalizar; no se modificó la base habitual ni Supabase. La revisión de código y el CI remoto quedan pendientes.
