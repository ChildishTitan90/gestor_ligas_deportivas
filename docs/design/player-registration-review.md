# PDGLD-98 — Captura y revisión de identidad

Rutas de gestión: `/players/registrations`, `/players/review` y `/players/review/[registrationId]`. Reutilizan ManagementShell, navegación por capacidades, SelectField, tokens y acciones existentes. La captura extensa y el expediente viven en página.

Actualización 04/11/2026: «Mis jugadores» aparece al entrar, sin seleccionar primero
un equipo de captura. Lista solo el alcance autorizado, con búsqueda por nombre,
club/temporada y filtro de equipo. Cada fila enlaza «Abrir expediente»; permanece
disponible al volver otro día, aunque no haya equipos habilitados para nuevas altas.
El formulario de registro conserva sus selectores y ventana de lunes a miércoles.

«Registrar y verificar CURP» inicia una consulta en el POST humano del alta. No se
consulta al cargar la página, escribir o listar. `registration-intake.ts` reutiliza
los servicios existentes y una intención estable por actor/registro/identidad.
El servicio de CURP conserva cuotas, alcance, huella y deduplicación entre procesos.
Un resultado incierto nunca se reenvía automáticamente al proveedor. El registro
local queda recuperable si la verificación falla; no se afirma verificación o
habilitación sin resultado. El costo técnico no se muestra en controles de CURP.
Tras el acuse hay acceso directo «Continuar al expediente».

El destino del sidebar y el título son «Jugadores»; se conserva la URL existente.
«Registrar jugador» abre `FormDialog`; los filtros y la lista quedan en la página.
Ambos filtros usan etiquetas en bloque y separación/altura equivalentes. El modal
conserva la captura en el padre, solicita confirmación para descartar, impide cerrar
durante el envío y permite ocultar un resultado incierto conservando su intención
en memoria. Se puede volver mediante «Continuar registro pendiente». No es un
borrador persistente: recargar pierde la captura. Documentos y firmas continúan
en su página de expediente. Se reutilizan foco, Escape, fondo inerte, popup de
SelectField dentro del diálogo y desplazamiento móvil del componente compartido.

El delegado captura para equipos con afiliación y categoría autorizadas. Las altas conservan la ventana lunes–miércoles en America/Mexico_City. El backend impide altas fuera de esa ventana; no se ha cambiado el reloj de Docker habitual.

Secretaría necesita `players:APPROVE` y `players:READ` en el contexto real. La bandeja presenta solo inscripciones autorizadas pendientes. Cada candidato se autoriza por separado. Las coincidencias fuera de alcance se ocultan y bloquean la resolución; administración debe revisarlas. No se expone CURP en la bandeja ni en la comparación.

La decisión motivada confirma personas distintas o mantiene revisión por documentación insuficiente. Nunca fusiona personas ni cambia el estado deportivo INELIGIBLE. Cada inscripción tiene su propia decisión: resolver una no resuelve las demás.

La auditoría inmutable conserva huellas de versiones y decisiones, sin copiar nombres, CURP ni documentos. La huella de envío incluye la última decisión; dos decisiones contrarias desde el mismo expediente no se sobrescriben. Reenviar una intención ya registrada recupera su acuse. Cambios en identidades o candidatos invalidan la resolución al consultar el contrato `readPlayerRegistrationForActor`: futuros servicios de elegibilidad deben consumirlo antes de aprobar, además de las restricciones de PostgreSQL. No usar `identity_review_status` aisladamente como autorización deportiva.

Ante una respuesta incierta, el formulario bloquea otra decisión y ofrece consultar el expediente actualizado. Recargar pierde captura sin enviar; no existe borrador persistente en el navegador.

Datos locales: `npm run seed:registration-demo` valida gestor_ligas_dev en loopback, rechaza marcadores de Supabase y exige el perfil DEMO instalado. Aplica migrate deploy/generate y añade dos categorías, cuatro grupos, una temporada separada y cuatro equipos. Repetir conserva cambios posteriores y no duplica filas. No crea cuentas ni modifica contraseñas, roles o solicitudes anteriores. La edad 35+ de Veteranos es sintética de demostración; requiere acuerdo de la Liga para uso real.

Validación del 31/10/2026: pruebas de servicio con PostgreSQL desechable y transporte del proveedor simulado. La corrección de afiliaciones pasó 28 pruebas HTTP/base. En Docker se comprobó que aparecen categorías en la corrección y la captura del delegado en la navegación. Pendiente aceptación humana del recorrido visual de Secretaría, teclado, claro/oscuro y móvil/escritorio; pendiente CI remoto y revisión por otra persona. No se han ejecutado consultas reales de CURP/INE ni subido archivos por el agente. INE/selfie y aprobación deportiva quedan fuera de esta entrega.


Vocabulario de participación superior: la interfaz usa «Categorías que permiten subir» y «orden para subir» en lugar de «familias». Ejemplo visible: Sub-15 → Sub-16 → Sub-17; se conserva origen y autorización, sin bajar ni saltar niveles. Se actualizaron enlaces, título, confirmaciones y mensajes de error. Los códigos, rutas y contratos internos conservan su compatibilidad.
