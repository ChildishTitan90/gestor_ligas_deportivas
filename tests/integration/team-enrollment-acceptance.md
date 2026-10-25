# Aceptación pendiente — PDGLD-64

La suite `npm run test:team-enrollments` prueba los endpoints reales de inscripción
y la solicitud real de afiliación. Un fixture PostgreSQL explícito prepara después
afiliación aprobada/categoría autorizada. **Ese fixture no demuestra aprobación
real por Secretaría.** No se agregó un servicio de aprobación simulado a producción.

Al integrar PDGLD-60, ejecutar este tramo mediante sus contratos reales:

1. Acceder como delegado autorizado y enviar solicitud de afiliación con firmas
   válidas. Verificar PENDING y ausencia de equipos/inscripciones automáticos.
2. Como delegado, intentar aprobar y comprobar denegación sin cambios.
3. Como secretario autorizado de esa liga, aprobar la solicitud y seleccionar
   categorías habilitadas; verificar responsable, fecha e historial, sin activar
   equipos. Integrar las marcas `authorized_by`/`authorized_at` del contrato.
4. Probar aprobación concurrente y rollback mediante los servicios reales de
   PDGLD-60; conservar una única aprobación e historial coherente.
5. Como delegado, obtener opciones, inscribir equipo y comprobar REGISTERED,
   unicidad por temporada, permisos y auditoría mínima.
6. Repetir inscripción con la misma clave ante fallo de red y confirmar el mismo
   resultado sin duplicar equipos ni eventos.

Al integrar PDGLD-63, comprobar por navegador selección dependiente de club,
equipo, temporada, categoría y grupo; modo nuevo/existente excluyente; guardado
de clave/captura en reintentos; mensajes de error, doble envío y consulta del
historial. Este recorrido visual no forma parte de las pruebas HTTP de backend.

Activación a ACTIVE: pendiente de definir con profesor/Liga. No intentar completar
ese criterio mediante cambios SQL en un entorno compartido. La suite no contiene
ninguna ruta de demostración ni aprobación falsa.
