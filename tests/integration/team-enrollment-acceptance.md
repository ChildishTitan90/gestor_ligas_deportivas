# Aceptación pendiente — PDGLD-64

Actualización 25/10/2026, tras recibir el PR #28 desde develop.

La suite `npm run test:team-enrollments` ejecuta la solicitud real del delegado,
consulta el detalle con la sesión de Secretaría y usa su versión vigente para
aprobar por el endpoint real. Verifica actor, versión e historial, y comprueba que
un equipo previamente REGISTERED no se active automáticamente.

El servicio recibido no escribe autorización individual de categorías. Por eso
la inscripción del recorrido real termina en `CATEGORY_NOT_AUTHORIZED`, con
opciones de categorías vacías y sin efectos parciales. **No se declara aprobado
el recorrido completo solicitud → aprobación/autorización → inscripción.**

Los positivos de inscripción utilizan otra temporada con un fixture explícito de
afiliación aprobada y categoría autorizada. No completan ni sustituyen la
autorización real pendiente; no hay UPDATE SQL de aprobación en el recorrido real.

Cuando Checo integre la autorización individual acordada, completar por servicios reales:

1. Acceder como delegado autorizado y enviar solicitud de afiliación con firmas
   válidas. Verificar PENDING y ausencia de equipos/inscripciones automáticos.
2. Como delegado, intentar aprobar y comprobar denegación sin cambios.
3. Como secretario autorizado de esa liga, aprobar y autorizar categorías mediante
   el contrato acordado por Checo; obtener siempre expectedVersion del detalle
   vigente y verificar responsable, fecha e historial, sin activar equipos. Una
   selección visual se acordará con Nick si hace falta; no se inventa en este PR.
4. Mantener las pruebas de aprobación concurrente y rollback de PDGLD-60 y ampliar
   el recorrido a la autorización individual; conservar auditoría coherente.
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
