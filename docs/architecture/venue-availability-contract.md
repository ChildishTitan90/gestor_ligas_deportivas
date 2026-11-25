# PDGLD-22 · Canchas y disponibilidad

La sección **Competencias → Canchas y disponibilidad** usa permisos RF22 por liga.
La gestión de intervalos requiere `venues:UPDATE`. Los identificadores de
partidos afectados se muestran a quien puede actualizar la cancha y leer
programación para esa liga. Las altas, ediciones y retiros dejan un evento de
auditoría dentro de la transacción.

## Integración con programación

- La cancha activa pertenece a la liga de la temporada. Sus parámetros son
  `match_duration_minutes` y `buffer_minutes`, inicialmente 90 y 0 minutos.
- Las fechas del formulario se interpretan en la zona de la liga. PostgreSQL
  almacena instantes y compara intervalos semiabiertos `[inicio, fin)`.
- Al programar, calcula `ends_at = starts_at + duración` y
  `reserved_until = ends_at + holgura`. Una sola ventana AVAILABLE debe
  contener la reserva completa y ningún BLOCK o MAINTENANCE puede intersectarla.
- El trigger verifica los requisitos al crear o mover una reserva. La
  exclusión existente de `venue_reservations` rechaza un traslape incluso si
  dos escrituras concurrentes intentan reservar la misma cancha. La exclusión
  devuelve SQLSTATE `23P01`; un intervalo inválido, una cancha fuera de alcance
  o una reserva incompatible con la disponibilidad devuelve `23514`.
- Un bloqueo posterior conserva el partido y su reserva. La pantalla detecta
  el conflicto consultando las reservas vigentes. Se resuelve reprogramando
  el partido o modificando el bloqueo; un ajuste que no mueve la reserva
  puede seguir guardándose. El generador de PDGLD-24 debe aplicar este mismo
  contrato al construir propuestas.

La migración solo modifica tablas existentes. Si hay intervalos que se
superponen dentro del mismo grupo (disponibilidad o bloqueos/mantenimiento),
identifícalos y resuélvelos antes de aplicar la exclusión. El esquema conserva
el tratamiento de RLS de cada entorno. Preview requiere ejecutar su plan de
mantenimiento tras la migración para aprovisionar los permisos del backend.

Para repetir la regresión de PostgreSQL, aplica las migraciones a un clúster
desechable en `127.0.0.1:55427`, base `pdgld22`. Configura
`PDGLD22_TEST_DATABASE_URL` apuntando a esa base y ejecuta
`node --test tests/integration/venue-availability.test.mjs`.
