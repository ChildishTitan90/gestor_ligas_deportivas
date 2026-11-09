# Confirmación del nuevo correo — PDGLD-118

La ruta pública `/email-change/confirm` confirma propiedad mediante el endpoint
existente `POST /api/account-maintenance/email-change/confirm`. No exige login ni
crea una sesión. Reutiliza PublicShell, ActionLink y los tokens existentes; con sesión usa
AccountMenu y sin sesión ThemeSelector. Permanece fuera del shell de gestión
porque el destinatario puede no tener sesión.

## Enlace y acción explícita

El enlace de una futura plantilla debe ser HTTPS, directo y de origen confiable:
`/email-change/confirm#token=<secreto>`. El secreto no pertenece a query strings,
rutas, props de servidor, HTML, logs o almacenamiento del navegador. La pantalla
lee el fragmento solo en cliente y reemplaza la entrada actual de historial para
retirarlo de la barra. Conserva el valor únicamente en memoria. Una recarga pierde
la captura; se debe abrir de nuevo el enlace original.

Abrir, renderizar, hidratar o recargar no envía confirmación ni consulta el token.
Solo el botón «Confirmar correo» envía `{token}` en el cuerpo JSON del POST. La
petición omite cookies, usa no-store/no-referrer y no sigue redirecciones. El
backend conserva validación de origen, propósito, vencimiento, uso único,
revisión, unicidad y autoridad vigente del solicitante.

La captura admite un único token con el formato del contrato. Se atienden también
nuevos fragmentos en la misma página, sin sustituir una escritura en curso. No se
muestra el correo anterior/nuevo ni el secreto en esta pantalla. Metadata excluye
indexación y referrer. El enlace a login no transmite el secreto.

## Resultados y accesibilidad

- Éxito solo tras acuse `CONFIRMED` con revocación: el nuevo correo está vigente;
  las sesiones anteriores terminaron y se debe iniciar sesión de nuevo.
- Ausente, mal formado, vencido, usado, reemplazado o rechazado por el servidor:
  mensaje genérico de enlace no válido y solicitud de ayuda administrativa. No se
  revela si existe la cuenta ni el motivo privado de invalidación.
- Timeout, red, 5xx o acuse incompleto: resultado incierto, sin afirmar éxito ni
  fracaso definitivo. No hay reintento automático; la administración puede
  consultar el estado antes de iniciar otro cambio.

El botón impide doble envío; el estado pendiente tiene texto accesible. El
resultado recibe foco y se anuncia como status/alert. El monitor de sesión
reconoce esta ruta pública para conservar el resultado tras una revocación,
mientras las rutas de gestión siguen redirigiendo al perder sesión.

## Validación y límites

Ver [evidencia saneada y bloqueo del proveedor](../validation/account-email-confirmation-ui.md).
No se incorpora un proveedor, remitente o plantilla real mediante esta pantalla.
