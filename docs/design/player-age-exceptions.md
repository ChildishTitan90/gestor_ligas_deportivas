# PDGLD-104: recorrido de excepción de edad

El formulario de registro ofrece una casilla explícita para abrir un expediente
pendiente de excepción. Explica el bloqueo y muestra la regla configurada al
rechazar un alta. No transforma silenciosamente un registro ordinario en petición.

En el expediente, el delegado carga Carta de excepción de edad mediante los
controles privados existentes. Actualizar estado reconoce el archivo confirmado;
no basta seleccionar un archivo. Presentar la petición exige motivo.

Secretaría encuentra el caso en Excepciones de edad de la bandeja de jugadores.
La página de revisión conserva el management shell y enlaza el expediente.
El panel muestra motivo, estado y carta privada. Aceptar/rechazar reutiliza
FormDialog con confirmación explícita y motivo. No tiene un selector nuevo.

Se reutilizan tokens de superficie/borde/texto y primary-action, sin paletas
particulares. Los controles tienen etiqueta, foco y estado de envío; el motivo
vacío recibe foco. La captura extensa permanece en página y solo la confirmación
usa diálogo. El contenedor admite ajuste de texto y botones en móvil.

Un envío sin acuse conserva cuerpo, clave y versión en memoria. Ofrece consulta
sin reenvío y reintento del mismo cuerpo; no permite otra operación mientras se
resuelve. Cerrar el diálogo no cancela ni descarta el envío incierto. La captura
no se anuncia como borrador guardado entre recargas. Al perder acceso se retiran
motivos, estado, intención y visor; cambiar de inscripción reinicia el panel.

Pruebas de navegador con transporte sintético cubren foco, confirmación,
incertidumbre, recuperación y pérdida de acceso. La revisión visual manual en
ambos temas, escritorio y móvil, y el recorrido con sesión real siguen pendientes.
