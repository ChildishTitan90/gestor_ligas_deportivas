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

Esta rama combina la interfaz de PDGLD-63 del commit be2052a con el backend
integrado en develop por el PR #31 (19599e9, incluida la protección de identidad
de a05df7b). Se conservan navegación, foco, accesibilidad y pruebas de la interfaz.
Consume capabilities del club seleccionado, catalogs para consulta, seasonName y
consulta/cancelación de operaciones con X-Expected-Actor-Id del propietario.
Conserva cuerpo y clave hasta CONFIRMED/CANCELLED; cerrar no cancela la operación.
El adaptador de recuperación de Víctor y sus pruebas también se conservan.

`npm run test:team-registration` prueba presentación y adaptador con simulación.
`npm run test:team-registration-browser` utiliza Chrome y React DOM reales con
negocio sintético; verifica foco, modal y aislamiento por usuario. No arranca Next
ni realiza el recorrido con autenticación real.

Validación integrada pendiente, con PostgreSQL y Storage exclusivos confirmados:
ver [procedimiento](../../docs/validation/PDGLD-63-recorrido-integrado.md).

1. En navegador, iniciar sesión real como delegado y registrar solicitud; cambiar
   a Secretaría, obtener detalle vigente, seleccionar categorías y aprobar; volver
   al delegado e inscribir equipo nuevo y existente. Comprobar REGISTERED.
2. Recorrer capacidad permitida/denegada, READ sin CREATE, temporada cerrada con
   nombres, clubes ajenos, pendiente/no autorizada, duplicado y estados accesibles.
3. Perder deliberadamente un acuse después del commit; recargar la página y recuperar
   por GET. Verificar misma clave/contenido, cancelación concurrente/tardía y auditoría.
4. Adjuntar evidencia por versión/entorno y revisión independiente.

**Este recorrido de navegador no se ejecutó: la integración completa de HU01-03
permanece pendiente.** No atribuirlo a las pruebas HTTP, al reinicio del adaptador
ni al recorrido de Chrome con negocio simulado que reportó Nick.

ACTIVE continúa pendiente de definición de negocio. El ajuste delegado/subdelegado
corresponde a Sprint 2. El plan de producción de la tabla nueva debe revisarse antes
de desplegar; no se modifica Supabase para probar esta entrega.

Contrato, respuestas y recuperación: [team-enrollment.md](../../docs/architecture/team-enrollment.md).
