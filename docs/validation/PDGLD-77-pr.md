# Borrador de PR hacia develop

**Título:** PDGLD-77 — Cargos con acuses y emisión automática por afiliación, inscripción y jornada

Tesorería puede crear cargos para un club afiliado o equipo de temporada, revisarlos antes de confirmar, consultar su saldo y corregir importe/vencimiento con motivo y versión. Guardar un plan semanal conserva su configuración; la generación explícita de cada periodo crea o recupera su cargo. Crear un cargo mantiene el adeudo pendiente y no registra pagos.

La rama conserva las vistas y el diseño de PDGLD-174, conecta los servicios de PDGLD-175 y agrega la validación de PDGLD-176. PostgreSQL protege la unicidad por temporada, concepto, destinatario y periodo; la transacción conserva efecto, auditoría y acuse por intención. Reutilizar una clave con otros datos se rechaza. Cada lectura/escritura comprueba sesión, permiso, acción y ámbito en servidor.

Tesorería también puede autorizar políticas por temporada, importe y vencimiento: afiliación aprobada del club, inscripción del equipo y arbitraje por equipo con partido programado en la jornada regular. Los hooks comparten la transacción del trámite, verifican el mandato vigente y usan `charges`; no conceden permisos financieros al operador del trámite. Las tarifas tienen revisiones inmutables y jornada inicial explícita; conservan todos los cargos emitidos. Una referencia única de origen evita repetirlos. Los partidos de etapa/liguilla quedan excluidos y su cobro permanece manual.

La configuración utiliza shell, encabezado, SelectField, FormDialog y tokens existentes, con revisión, descarte y recuperación de la misma intención tras perder la respuesta. Corrige además fechas hidratables y el ancho de reglas anidadas sin reemplazar el diseño.

## Validación

- Revisión del PR #74: Tesorería conserva consulta de saldo e historial de cargos de club/equipo después de desactivar su club. La regresión comprueba también ámbito, falta de permiso, bloqueo de escrituras y conservación de registros. La resolución de contexto operativa no se amplía para otros módulos.
- `npm run test:billing` y `npm run test:billing -- --postgres=17`: 30/30 en PostgreSQL 15.19 y 30/30 en 17.12, incluida la regresión de club inactivo del PR #74, emisión automática, 280 cargos, doble jornada en fechas iguales y colisión manual/automática. NextAuth, HTTP/Server Actions, Chrome y PostgreSQL desechable, con backend limitado y RLS. Incluyen concurrencia, rollback, revocación, IDOR, precisión, historial y recuperación tras cortar una respuesta después del commit.
- Typecheck, lint y regresiones pertinentes; resultados y capturas en [PDGLD-77.md](PDGLD-77.md).
- Job de matriz `billing` requerido por `CI listo para integrar`. El shell del gate se prueba con éxito, fallo, cancelación y omisión. La ejecución remota de Actions queda pendiente de publicar la rama.

## Pendientes de aceptación

Mantener como borrador. Falta la integración de multa con una resolución válida de PDGLD-27; FINE permanece bloqueado. La automatización de arbitraje ya usa el devengo acordado al programar, con tarifa explícita de Tesorería. La integración oficial de clasificación/llaves del PR #75 requiere validación conjunta cuando se integre; una fixture PLAYOFF_8 solo demuestra exclusión. Falta revisión humana de las vistas/backend y revisión del PR por otra persona.

Revisar la migración aditiva existente `20261125010000_pdgld175_charge_integrity`, duplicados históricos y el plan privado de ACL/RLS antes de Preview/Production. No se modificó Supabase ni se implementaron los recorridos completos de pagos, semáforo o avisos.

Revisar además `20261128010000_billing_automation` y `20261128020000_billing_matchday_identity`, su plan exacto de seguridad y las concesiones del backend. Migración nueva aplicada al Docker local conservando cuentas, clubes y cargos. Instalador Supabase Cron preparado con TLS, Vault y verificación de proyecto/entorno/contrato; instalación remota pendiente de acceso administrativo y despliegue del nuevo endpoint. No se activaron tarifas reales ni se publicaron cambios desde esta sesión.
