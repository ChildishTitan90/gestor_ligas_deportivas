# Formulario de cuentas — PDGLD-53

La ruta `/accounts/new` usa `getAccountFormData` en servidor y el panel `/access`
muestra su enlace cuando el catálogo autorizado contiene roles delegables. La página
redirige sesiones ausentes o restringidas y presenta acceso denegado sin formulario
si no hay roles disponibles. No se cambian las reglas de autorización ni el contrato HTTP.

Se reutilizan los tokens existentes, etiquetas y errores asociados a los campos,
foco visible, distribución adaptable y anuncios de carga/error/éxito. La liga recarga
roles y clubes desde GET `/api/accounts`; se descartan respuestas anteriores y se
limpian selecciones dependientes. SUPERADMIN es exclusivo y omite liga/club del envío.
El delegado puede seleccionar club existente o crear su registro inicial si tiene
permiso de creación en la liga. Reutilizar persona por UUID conocido se ofrece solo
con permiso global de creación de cuentas; no se añade búsqueda de personas.
Estas capacidades se consultan usando `assertPermission`; POST las vuelve a verificar.

Se valida con el contrato Zod compartido. El conflicto de duplicado no identifica el
campo ocupado ni devuelve información de otras cuentas. Se bloquean envíos repetidos,
se limpia la contraseña después del envío y solo se anuncia éxito tras un 201 con
confirmación. Un fallo de red, respuesta incierta o 5xx detiene nuevos envíos desde
ese formulario y pide verificar el resultado; no hay reintento automático ni guardado
local de credenciales. El éxito indica el cambio obligatorio de contraseña y no muestra
la clave ni los identificadores internos devueltos por la API.

## Criterios y validación

Se leyó HU22-01 (PDGLD-34) en Jira. Su texto conserva «solo SUPERADMIN»;
el backend integrado de PDGLD-54 autoriza por concesiones y ámbito, sin bypass
por rol. Esta interfaz sigue ese backend por instrucción del ticket; queda pendiente
conciliar el texto de aceptación con el equipo, sin cambiar permisos desde esta tarea.

`npm run test:account-form` prueba captura/contrato, campos condicionales enviados,
normalización, validaciones y mensajes de duplicados, más render inicial sin navegador.
El workflow CI ejecuta este comando junto a los controles puros existentes.
Las suites HTTP de cuentas existentes cubren unicidad concurrente y rollback; no
se ejecutan en esta entrega porque su runner aplica migraciones en una base temporal.
Quedan pendientes esas suites, revisión visual y recorridos interactivos en navegador.
