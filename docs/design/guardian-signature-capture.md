# Firma de padre, madre o tutor en el expediente

Se reutiliza la captura de PDGLD-109 en `components/ui/direct-signature-field.tsx`.
La entrada anterior de afiliaciones sigue disponible y exporta el mismo componente.
No se duplican el lienzo, la vista previa, la confirmación ni la conservación de trazos.

En el expediente de un menor, seleccionar el requisito configurado
`GUARDIAN_CONSENT` presenta nombre del firmante, relación declarada, lienzo y
confirmación de que la firma corresponde a ese registro. No exige adjuntar otro
PDF: el portal prepara uno con los datos, el identificador del jugador, la firma
y la versión `GUARDIAN_SIGNATURE_V1`. Los cambios en nombre, relación,
confirmación o firma invalidan el archivo preparado. No se transmite nada al
dibujar o preparar; el envío requiere pulsar «Cargar y confirmar archivo».

La declaración es un registro de captura, **no un texto de autorización aprobado
por la liga**. Ese texto y la acreditación de la identidad/relación del tutor
siguen pendientes de acuerdo. El documento indica esa limitación. La recepción
no crea `guardian_consents`, no marca documentos como validados y no habilita al
menor. Se conserva `REQUIRES_ACCREDITATION` y `approvalAllowed=false`.

El PDF reutiliza la preparación, carga, confirmación, huella, versiones,
idempotencia, descarga privada y autorización del expediente. Los campos
capturados son declaraciones del firmante, no una identidad autenticada por el
portal. La fecha de recepción confiable procede del acuse del servidor; las
propiedades de creación del PDF no acreditan el momento de firma.

La credencial escolar o constancia de estudios pertenece al menor y no prueba
la relación del firmante. La aclaración de Víctor queda registrada aquí; esta
entrega no cambia la configuración documental de categorías ni implementa una
nueva regla de equivalencia entre esos dos tipos. La configuración anterior de
credencial opcional sigue en código hasta integrar esa política expresamente.

Prueba manual: entrar como delegado autorizado, abrir el expediente de un menor
pendiente y seleccionar su requisito de autorización del tutor; completar datos,
dibujar, revisar, confirmar captura, preparar documento y cargarlo. Revisar el
acuse y descargar el PDF. Si falta el requisito configurado, debe configurarse
antes; la captura no sustituye esa configuración. Recargar pierde los datos y
trazos no enviados. Ante incertidumbre, consultar acuse y reintentar la misma
intención según el flujo existente. La acreditación y aprobación permanecen
pendientes; no interpretar la recepción como autorización aprobada.

Validación automatizada: canvas y React reales en Chrome, transporte sintético;
PostgreSQL local desechable verifica que recibir el documento conserva PENDING,
no crea consentimientos acreditados y no habilita al menor. No se emplearon
documentos personales, Supabase ni consultas a CURP/INE.
