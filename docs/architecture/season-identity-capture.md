# PDGLD-117 — captura mínima para cierres futuros

La decisión humana del 8 de noviembre de 2026 completa la captura mínima y
mantiene la barrera donde no hay evidencia suficiente. En el incremento selectivo las barreras se aplican por lector, no por la sola
existencia de una temporada cerrada. Se conservan los acuerdos de Sergio del comentario Jira 10088 y RF02/RNF02/RNF04 del ERS consultado.

La captura mínima acredita los **nombres mostrados al cierre**, su versión de
identidad y la versión de temporada. Incluye personas con inscripción (también
retirada), directiva histórica, tutor y relaciones arbitrales. Las referencias
de negocio permanecen en sus tablas; no se duplican personas ni sus documentos.

La nueva migración `20261108030000_pdgld117_identity_closure_receipts` añade un
acuse privado e inmutable por temporada: actor, closed_at, captured_at, versión
de temporada, versión del formato y número de personas capturadas. Incluso un
cierre sin personas deja un acuse con cero; un cierre legado permanece sin acuse.
Esto permite distinguir ausencia de captura de una captura nueva vacía.

Se conserva el trigger de cierre y se amplía su función mediante migración
nueva, sin editar las migraciones anteriores. Estado, auditoría, nombres y acuse
se escriben en una transacción. Un fallo en cualquiera de las capturas revierte
el cierre. SQL directo debe aportar actor y fecha de cierre, igual que el
servicio autorizado. La llave de historial mantiene el orden con correcciones.
El acuse no concede permisos de lectura; el lector interno exige autorización
previa y devuelve solo metadatos mínimos, sin exponer el actor a la UI.

El incremento selectivo añade `20261109010000_pdgld117_selective_history`:
una fila privada por inscripción con nacimiento, identity_version, año de
referencia, regla/versión y huella de política, estado registrado y referencias
mínimas de documentos/comprobaciones/participaciones. No se copian archivos,
firmas, CURP completa ni payloads del proveedor. El acuse/referencia por sí solo
no acredita un resultado favorable; los hechos faltantes siguen ausentes.

No hay backfill. La UI cerrada muestra los datos capturados disponibles y explica
las ausencias; nunca calcula desde people vigente. APPLY afecta solo abiertas
y mantiene bloqueos específicos de lectores sin protección, como los arbitrales.
El mismo people.id y los hechos/resultados/sanciones cerrados se conservan.
Véase [contrato selectivo](season-history-selective-correction.md).

Las tablas siguen privadas: sin concesiones públicas, RLS en el entorno con auth,
sin RLS en Docker, e inmutabilidad de INSERT externo/UPDATE/DELETE/TRUNCATE. La
producción mantiene pendiente su plan exacto de ACL, conservación y respaldos;
esta migración no se despliega desde el trabajo local.
