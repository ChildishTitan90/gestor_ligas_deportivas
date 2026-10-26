# Aceptación HU01-03 / PDGLD-62/63/64

Actualizado el 26/10/2026. El PR #29 de Checo ya está en develop: la autorización
explícita de categorías está disponible y se usa en el recorrido HTTP real.

## Evidencia disponible

`npm run test:team-enrollments` usa sesiones NextAuth de delegado y Secretaría y
PostgreSQL desechable. Solicita por POST real, comprueba rechazo mientras PENDING,
obtiene expectedVersion del detalle vigente, aprueba una selección explícita por
PATCH y crea una inscripción REGISTERED por POST. Rechaza la categoría no elegida.
Los únicos fixtures del recorrido preparan identidades, contexto y metadatos de
firmas sintéticas; no actualizan aprobación/autorización para fingir ese éxito.
Los escenarios aislados restantes conservan sus fixtures explícitos separados.

También cubre:

- Equipos nuevos y existentes; varias participaciones del club y una por equipo/temporada.
- Capacidad CREATE contextual, denegación y prohibición de mezclar roles/clubes.
- READ sin CREATE, catálogos de temporadas cerradas/sin afiliación, nombres y paginación.
- Clubes ajenos, sesión restringida y revocaciones con la misma sesión.
- Rollback, clave repetida con contenido distinto y auditoría sin duplicados.
- Acuse perdido tras confirmación y recuperación por GET; mismo cuerpo/clave en reintento.
- Adaptador de recuperación reinicializado con el pendiente conservado y HTTP real.
- Cancelación persistente, petición tardía y carrera entre cancelación e inscripción.
- Migración con una inscripción legada, sin cambiar filas anteriores ni auditoría.
- RLS/ACL con marcadores de Supabase simulados en PostgreSQL local; nunca Supabase real.

`test:team-enrollment-client` cubre almacenamiento por usuario/club/operación,
normalización, recarga del adaptador, conservación ante red/404/503/401/403,
cancelación confirmada y falta de capacidad. No es una prueba de las vistas de Nick.

## Recorrido pendiente desde la página real

Víctor confirmó que PDGLD-63 y sus 55 pruebas permanecen en la computadora de Nick.
No existen esas vistas en develop ni en las referencias remotas revisadas. No se
creó otra pantalla para simular haber recibido su trabajo.

Integración y validación pendientes sobre esa entrega:

1. Incorporarla sin reemplazar su navegación, foco, accesibilidad ni pruebas.
2. Consumir capabilities del club seleccionado y mantener equipo nuevo deshabilitado
   ante carga pendiente, ausencia/denegación de capacidad o respuesta de otro club.
3. Cargar consulta/historial desde catalogs con READ y mostrar seasonName del listado.
4. Integrar el adaptador de recuperación con su controlador y quitar el bloqueo
   local anterior solo al verificar CONFIRMED/CANCELLED. Abandonar edición conserva
   la recuperación; cancelar llama al servidor. No comprobar silenciosamente con POST.
5. En navegador, iniciar sesión real como delegado y registrar solicitud; cambiar
   a Secretaría, obtener detalle vigente, seleccionar categorías y aprobar; volver
   al delegado e inscribir equipo nuevo y existente. Comprobar REGISTERED.
6. Recorrer capacidad permitida/denegada, READ sin CREATE, temporada cerrada con
   nombres, clubes ajenos, pendiente/no autorizada, duplicado y estados accesibles.
7. Perder deliberadamente un acuse después del commit; recargar la página y recuperar
   por GET. Verificar misma clave/contenido, cancelación concurrente/tardía y auditoría.
8. Adjuntar evidencia por versión/entorno y revisión independiente.

**Este recorrido de navegador no se ejecutó: la integración completa de HU01-03
permanece pendiente.** No atribuirlo a las pruebas HTTP, al reinicio del adaptador
ni al recorrido de Chrome con negocio simulado que reportó Nick.

ACTIVE continúa pendiente de definición de negocio. El ajuste delegado/subdelegado
corresponde a Sprint 2. El plan de producción de la tabla nueva debe revisarse antes
de desplegar; no se modifica Supabase para probar esta entrega.

Contrato, respuestas y recuperación: [team-enrollment.md](../../docs/architecture/team-enrollment.md).
