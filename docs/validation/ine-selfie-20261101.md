# INE y selfie: comprobación de la integración

Fecha: 1 de noviembre de 2026. Código local sin commit, despliegue ni cambios de Jira. PDGLD-13 se conserva en pruebas. [Contrato, recuperación y pasos humanos](../architecture/player-ine-verification.md).

## Ejecutado

- `npm run test:ine-provider`: 11 pruebas puras/con transporte simulado. Contrato V2, QR desactivado, extracción mínima sin direcciones/MRZ PersonalNumber, comparación de cinco campos, Ñ, ausencias/contradicciones/fechas sin siglo, apellido materno ausente, subvalidaciones negativas, errores, timeout, respuesta acotada y bloqueo de cableado real.
- `npm run test:player-registrations`: 24 pruebas en PostgreSQL local desechable. Incluye regresiones de PDGLD-13, documentos y nuevo escenario INE con Storage/proveedor simulados: Veteranos por tipo real, autorización de otro club, imágenes inválidas, aceptación explícita de costo, envíos concurrentes y replay con una llamada, evidencia privada con hash, revisión administrativa sin activar/rechazar, cuotas, fallo de Storage, incertidumbre, cambio de identidad, revocación durante consulta y resultado favorable sin habilitar otro cobro.
- `npm run test:ine-browser`: Chrome headless local, viewport 375×812, datos/respuestas sintéticos. Comprueba cuenta de solo lectura, captura y confirmación requeridas, doble envío, bloqueo después de respuesta incierta y GET de acuse sin repetir POST. No es revisión visual de temas ni recorrido con sesión/backend reales; no se probó cámara física.
- Regresiones puras: identidad 4, CURP simulada 8, expediente 8, Storage simulado 5 y controles de CI 27.
- Typecheck, lint y compilación de Next.js. Windows requirió ejecutar Chrome y la compilación con permisos para iniciar procesos/enlaces locales. Docker se inició para la suite local tras aviso del usuario.
- Referencia `origin/develop` actualizada y comparada antes y después; sin nuevos commits ajenos pendientes de integración respecto a la base de trabajo.

## Pendiente de aceptación humana

Actualización de captura por pasos: se implementó frente → reverso con giro 3D → selfie → revisión final. Pasaron nuevamente Chrome sintético (secuencia, volver/repetir conservando fotos, foco, sin solicitudes entre pasos, doble envío e incertidumbre), lint, tipos y build. Las capturas del componente aislado usan CSS real y datos sintéticos, sin sesión/backend; cámara física pendiente. La animación respeta movimiento reducido.

Cámara integrada añadida: Chrome usa getUserMedia simulado con video generado por canvas, sin permisos ni hardware real. Comprueba activación solo por clic, ausencia de audio, preferencia trasera/frontal, captura JPEG sin llamadas HTTP, tracks detenidos tras captura/cambio de paso y cierre de stream cuyo permiso llega después de desmontar. La denegación conserva el campo de archivo. Se repitieron lint/tipos y compilación. Esto no acredita permisos, calidad, enfoque, orientación o funcionamiento de una cámara física en móvil.

No se ejecutó ninguna API real de CURP o INE, ni se comprobó la credencial o saldo. No se subió evidencia a Supabase real en esta entrega. La infraestructura y transporte documental probados anteriormente siguen documentados por separado en PDGLD-100; eso no acredita la nueva verificación INE.

Actualización de cotejo automático: 24 pruebas de PostgreSQL desechable incluyen adaptador real con transporte simulado y respuesta favorable cuyos datos faltan, difieren o coinciden. Solo la igualdad completa genera IDENTITY_VERIFIED, omite el caso en revisión INE y bloquea otro cobro. Se comprueban acuses antiguos sin promoción retroactiva, estado deportivo INELIGIBLE y auditoría sin CURP/datos extraídos. Chrome sintético comprueba el mensaje de identidad verificada y captura deshabilitada.

Validar manualmente proveedor, costo vigente, calidad de imágenes, cuenta de Secretaría, temas claro/oscuro, teclado y móvil con sesión real. La documentación publica 20 tokens con selfie sin QR, no 3; ningún agente debe probarlo. El certificado del proveedor no se conserva. Ahora existe cotejo automático conforme a los campos documentados, probado con respuestas sintéticas; falta confirmar el contrato y sus variantes reales por un humano. No acredita elegibilidad deportiva.

La resolución administrativa formal de INE y el plazo de retención de su evidencia siguen pendientes. La bandeja permite consultar evidencias/acuse, sin presentar esos pendientes como resueltos. No se modifican los requisitos documentales ni la acreditación del tutor. No hay limpieza automática ni objetos remotos creados para eliminar.
