# PDGLD-38 — Plan de migración de distribución

La migración existente 20261029130000_pdgld38_pending_distribution contiene
CREATE TEMP TABLE pd38_trigger_state ON COMMIT DROP. El filtro conservador de
producción también detecta tablas temporales, por lo que requiere un plan exacto.

Se conserva intacto el archivo aplicado. production-plans.mjs reconoce solamente
su nombre y SHA-256 del SQL normalizado a LF:
8cd0c79f5a5044ced2575e1648c38a0ec2bff72d6ba620af8684dca1893c76b9.

La tabla conserva el estado de los triggers de auditoría y temporada durante la
proyección de season_category_id. Existe solo en la sesión de migración y se
elimina al commit. La transacción y ACCESS EXCLUSIVE del ALTER evitan escrituras
paralelas; los triggers recuperan exactamente sus estados previos antes del
commit. No crea tablas persistentes, no cambia permisos de API ni desactiva RLS.

La prueba de migración de distribución ejecuta el SQL real sobre fixtures
cerrados y comprueba que inscripciones, huellas, auditoría y estado de triggers
se conserven. Las pruebas del plan rechazan cualquier cambio al archivo incluso
si ya consta aplicado, así como nuevas tablas y desactivaciones de RLS. El filtro
general conserva su comportamiento para cualquier otra migración.

La incorporación del plan se somete a revisión en el PR; no despliega en Supabase
ni sustituye la ejecución autorizada desde main.
