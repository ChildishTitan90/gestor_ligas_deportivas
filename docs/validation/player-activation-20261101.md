# Comprobación de habilitación automática

1 de noviembre de 2026. [Reglas y recuperación](../architecture/player-automatic-activation.md).

- 27 pruebas de jugadores en PostgreSQL temporal desechable: regresiones PDGLD-13/expediente/INE, activación sin archivo CURP, ausencia de doble historial ante reintentos/concurrencia, carga posterior de constancia, permiso de club, menores, Veteranos, edad configurada, suspensión, coincidencias y resolución administrativa vigente. Rollback de habilitación conserva la comprobación CURP y permite reevaluar localmente sin otro proveedor.
- Backend limitado con RLS: 65 pruebas correctas, dos omisiones previstas por el runner y prueba adicional RF22 de autorización correcta. Provisión repetible; columnas de Persona/equipo inmutables y ledger denegado. Se comprueban los permisos SQL nuevos de estado/historial. No se aplicaron concesiones remotas.
- Chrome: captura de fotos/INE, incertidumbre, un selector de foto y panel CURP con confirmación explícita, mensaje Jugador activo y actualización de listado usando respuestas sintéticas. No se inicia consulta al abrir el panel. Cámara/video exclusivamente simulados en la suite.
- CURP simulada: 8 pruebas; expediente puro/recuperación: 8; controles de CI: 27. Typecheck, lint y build correctos. Referencia develop comprobada antes y al cerrar.

No se ejecutaron CURP/INE reales, no se comprobó saldo/clave y no se crearon objetos de Storage. Sin migraciones nuevas ni modificación de la base habitual. Las pruebas de servicios usan el cliente propietario de la base temporal; los controles de runtime verifican ACL/RLS, no una aceptación humana completa del nuevo recorrido con cuenta de producción.

La demostración local ofrece componentes reales con respuestas simuladas y no sustituye esas pruebas: no analiza documentos ni modifica una base. La pestaña anterior se conserva. Reproducción con backend real: registrar un adulto en categoría/equipo autorizados en la ventana de altas, verificar CURP con confirmación humana de cobro, comprobar ACTIVE y constancia pendiente, completar CURP/foto y reconsultar sin otro gasto. Casos de duplicado deben resolverse por Secretaría; no provocar más consultas pagadas para simular fallos.

Siguen pendientes revisión documental formal, acreditación del tutor y habilitación de menores/Veteranos; no se presentan como implementadas por esta ampliación. PDGLD-13 conserva su estado de pruebas; sin commit, publicación o cambios de Jira.
