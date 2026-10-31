# PDGLD-98 — Captura y revisión de identidad

Rutas de gestión: `/players/registrations`, `/players/review` y `/players/review/[registrationId]`. Reutilizan ManagementShell, navegación por capacidades, SelectField, tokens y acciones existentes. La captura extensa y el expediente viven en página; la consulta externa usa FormDialog con confirmación de gasto.

El delegado captura para equipos con afiliación y categoría autorizadas. Las altas conservan la ventana lunes–miércoles en America/Mexico_City. El backend impide altas fuera de esa ventana; no se ha cambiado el reloj de Docker habitual.

Secretaría necesita `players:APPROVE` y `players:READ` en el contexto real. La bandeja presenta solo inscripciones autorizadas pendientes. Cada candidato se autoriza por separado. Las coincidencias fuera de alcance se ocultan y bloquean la resolución; administración debe revisarlas. No se expone CURP en la bandeja ni en la comparación.

La decisión motivada confirma personas distintas o mantiene revisión por documentación insuficiente. Nunca fusiona personas ni cambia el estado deportivo INELIGIBLE. Cada inscripción tiene su propia decisión: resolver una no resuelve las demás.

La auditoría inmutable conserva huellas de versiones y decisiones, sin copiar nombres, CURP ni documentos. La huella de envío incluye la última decisión; dos decisiones contrarias desde el mismo expediente no se sobrescriben. Reenviar una intención ya registrada recupera su acuse. Cambios en identidades o candidatos invalidan la resolución al consultar el contrato `readPlayerRegistrationForActor`: futuros servicios de elegibilidad deben consumirlo antes de aprobar, además de las restricciones de PostgreSQL. No usar `identity_review_status` aisladamente como autorización deportiva.

Ante una respuesta incierta, el formulario bloquea otra decisión y ofrece consultar el expediente actualizado. Recargar pierde captura sin enviar; no existe borrador persistente en el navegador.

Datos locales: `npm run seed:registration-demo` valida gestor_ligas_dev en loopback, rechaza marcadores de Supabase y exige el perfil DEMO instalado. Aplica migrate deploy/generate y añade dos categorías, cuatro grupos, una temporada separada y cuatro equipos. Repetir conserva cambios posteriores y no duplica filas. No crea cuentas ni modifica contraseñas, roles o solicitudes anteriores. La edad 35+ de Veteranos es sintética de demostración; requiere acuerdo de la Liga para uso real.

Validación del 31/10/2026: pruebas de servicio con PostgreSQL desechable y transporte del proveedor simulado. La corrección de afiliaciones pasó 28 pruebas HTTP/base. En Docker se comprobó que aparecen categorías en la corrección y la captura del delegado en la navegación. Pendiente aceptación humana del recorrido visual de Secretaría, teclado, claro/oscuro y móvil/escritorio; pendiente CI remoto y revisión por otra persona. No se han ejecutado consultas reales de CURP/INE ni subido archivos por el agente. INE/selfie y aprobación deportiva quedan fuera de esta entrega.
