# Firma de padre, madre o tutor en el expediente

Se reutiliza la captura de PDGLD-109 en `components/ui/direct-signature-field.tsx`.
La entrada anterior de afiliaciones sigue disponible y exporta el mismo componente.
No se duplican el lienzo, la vista previa, la confirmación ni la conservación de trazos.

En el expediente de un menor, seleccionar el requisito configurado
`GUARDIAN_CONSENT` presenta nombre del firmante, relación declarada, lienzo y
confirmación de que la firma corresponde a ese registro. No exige adjuntar otro
PDF: el portal prepara uno con los datos, el identificador del jugador, la firma
y la versión `GUARDIAN_AUTHORIZATION_V1`. Los cambios en nombre, relación,
confirmación o firma invalidan el archivo preparado. No se transmite nada al
dibujar o preparar; el envío requiere pulsar «Guardar documento» o «Sustituir documento».

La declaración autoriza el registro y participación y queda sujeta a revisión.
Por decisión expresa de Víctor, Secretaría o Administración debe comprobar
identidad del firmante, relación con el menor, firma y autorización; registra una
justificación y aprueba o solicita corrección. La recepción por sí sola no crea
`guardian_consents`, no valida documentos y no habilita al menor. No se afirma
certificación legal ni se inventa una versión de aviso de privacidad.

La revisión vive en `/players/review/[registrationId]/documents`, con permisos
READ/APPROVE y alcance del servidor. Una aprobación comprobada registra
`PLAYER_DOCUMENT_REVIEWED` ligada al documento, archivo e identidad vigentes y
presenta `ACCREDITED`. Sustituir el archivo o cambiar la identidad invalida esa
acreditación. Se conserva `approvalAllowed=false` para la habilitación deportiva.

El PDF reutiliza la preparación, carga, confirmación, huella, versiones,
idempotencia, descarga privada y autorización del expediente. Los campos
capturados son declaraciones del firmante, no una identidad autenticada por el
portal. La fecha de recepción confiable procede del acuse del servidor; las
propiedades de creación del PDF no acreditan el momento de firma.

La credencial escolar o constancia de estudios pertenece al menor y no prueba
la relación del firmante. Para el menor es obligatorio entregar **una credencial
escolar o una constancia de estudios**: basta una alternativa vigente y revisada.
No se obliga a entregar ambas. El grupo escolar se evalúa aparte de la autorización.

Prueba manual: entrar como delegado autorizado, abrir el expediente de un menor
pendiente y seleccionar su requisito de autorización del tutor; completar datos,
dibujar, revisar, confirmar captura, preparar documento y cargarlo. Revisar el
acuse y descargar el PDF. Si no hay requisito explícito, el servidor ofrece la
posición de tutor y ambas alternativas escolares sin insertar configuración de
categoría. Recargar pierde los datos y
trazos no enviados. Ante incertidumbre, consultar acuse y reintentar la misma
intención según el flujo existente. Entrar luego como Secretaría, abrir Revisiones
de jugadores y decidir con las cuatro comprobaciones y motivo. No interpretar la
recepción como autorización aprobada ni la revisión como habilitación deportiva.

Validación automatizada: canvas y React reales en Chrome, transporte sintético;
PostgreSQL local desechable verifica que recibir el documento conserva PENDING,
no crea consentimientos acreditados y no habilita al menor. No se emplearon
documentos personales, Supabase ni consultas a CURP/INE.
