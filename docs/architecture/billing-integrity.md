# Cargos y acuses de tesorería · PDGLD-175

## Escrituras y autoridad

Las entradas de servidor reciben `BillingCommand`, validan Zod y obtienen la identidad desde NextAuth 4. El servicio vuelve a comprobar el permiso `billing` y el ámbito. Para equipo resuelve `season_teams.id` y obtiene el `teams.id` que necesita RBAC. Para club comprueba su afiliación en la temporada. Liga, autor y emisión proceden del servidor. Las lecturas limitan el catálogo y los registros al alcance efectivo de cada concesión.

La representación monetaria compartida es una cadena normalizada con dos decimales. Prisma conserva `Decimal(12,2)` y los cálculos usan `Prisma.Decimal`. El baseline exige MXN y vencimiento igual o posterior a emisión. La corrección modifica importe/vencimiento con versión esperada y motivo. El contexto y periodo originales permanecen como identidad del cargo.

## Unicidad, concurrencia y auditoría

La migración `20261125010000_pdgld175_charge_integrity` agrega índices únicos para club y equipo sobre temporada, concepto y ambas fechas del periodo. La liga y categoría del equipo se derivan de esa inscripción. Se conserva la unicidad original por sanción y por plan/inicio de periodo. Las filas canceladas siguen ocupando su clave de negocio. Su tratamiento futuro requiere la política correspondiente.

La operación toma el bloqueo compartido RF22 y un advisory lock transaccional por UUID de intención. El acuse inmutable usa ese UUID en `audit_logs`, acción `BILLING_OPERATION`, con autor, huella canónica y resultado. Reutilizarlo con datos distintos produce `OPERATION_KEY_REUSED`. La corrección bloquea el cargo y verifica versión. La generación serializa el destinatario y los índices protegen también conexiones concurrentes. Un duplicado con datos equivalentes recupera el cargo existente. Datos monetarios, vencimiento o plan diferentes requieren consultar y corregir.

El trigger original `record_audit` conserva cada alta/corrección del cargo. El trigger nuevo de planes registra su alta. El acuse tiene una acción y propósito propios. Los tres viven en la transacción de su efecto y desaparecen si hay rollback. Los planes quedan inmutables. Los movimientos y el historial se conservan.

El trigger de pagos toma el bloqueo del cargo antes de insertar. El trigger de corrección bloquea cambios si hay cualquier pago, incluidos movimientos anulados, conforme a la regla provisional aceptada por el usuario. Esto coordina conexiones distintas. PDGLD-78 deberá reutilizar el mismo orden de bloqueos al registrar pagos.

## Recurrencia y resolución disciplinaria

Se acordó generación manual por periodos de siete días inclusivos, con inicio, fin y vencimiento explícitos. Guardar el plan confirma su configuración. Cada generación crea o recupera un cargo dentro de la ventana. El calendario automático sigue pendiente de decisión y de un mecanismo de ejecución acordado.

El usuario propuso automatizar arbitraje por partido. Falta acordar el evento de devengo —programación o partido jugado—, el importe por equipo, el reparto y el tratamiento de reprogramación, cancelación e incomparecencia. Esa integración necesitará una referencia estable de partido y su unicidad. La generación semanal manual usa el contrato actual.

PDGLD-27 continúa sin servicio de resolución oficial. Las tablas de resoluciones y sanciones conservan referencias, pero falta su contrato de vigencia, sustitución y exigibilidad. El servicio rechaza `FINE` con `RESOLUTION_UNAVAILABLE`, incluso si un cliente envía un UUID o existe un plan histórico de multa. La unicidad original por `sanction_id` está disponible para la integración futura.

## Consumidores

| Historia | Contrato |
| --- | --- |
| PDGLD-78 | `readChargeBalanceForActor` entrega versión, importe, pagos vigentes, saldo, vencimiento y cancelación. El registro de pago deberá bloquear el cargo, verificar su propia intención y permiso y conservar el modelo monetario. |
| PDGLD-79/82 | La misma consulta privada devuelve cadenas decimales, sin información de identidad ni documentos. El semáforo y sus consecuencias pertenecen a sus historias. |
| PDGLD-83 | Cada INSERT confirmado de cargo produce el evento existente del trigger, con UUID estable. `readChargeCreatedEventForActor` autoriza su consulta y devuelve `CHARGE_CREATED` y el cargo. El descubrimiento confiable de eventos, entrega y deduplicación de avisos quedan para PDGLD-83. Un fallo de aviso ocurre después de confirmar el cargo. |

## Plan de seguridad de Preview y Production

La migración agrega índices, funciones de trigger y triggers sobre tablas existentes. Conserva RLS, sus políticas y el historial compartido. Retira EXECUTE de PUBLIC en las dos funciones nuevas. Docker mantiene su configuración local sin RLS.

Antes de aplicar a Preview o Production, revisar duplicados por la clave de negocio. El índice aborta ante datos duplicados, para que la conciliación se decida conservando historial. El rol privado de aplicación necesitará SELECT de `charge_concepts`, `billing_plans`, `charges`, `payments`, `payment_voids` y las relaciones de contexto ya usadas por RBAC. Necesita INSERT de las columnas de planes/cargos que escribe el servicio e INSERT de los acuses de auditoría, incluido su UUID. Para cargos, UPDATE se limita a `amount`, `due_on` y `version`. Las lecturas con FOR UPDATE/FOR SHARE requieren las capacidades de bloqueo ya documentadas en el runtime privado.

El plan de provisión de Preview todavía debe incorporar y comprobar esas ACL por columna y políticas del rol privado. Los roles `anon`, `authenticated` y `service_role` conservan la denegación de acceso directo a estas finanzas. El backend autoriza cada lectura y escritura. La migración se ensayó inicialmente en una base temporal y después se aplicó al Docker solicitado por el usuario. El servidor entregado utiliza Docker. El despliegue remoto sigue el flujo manual revisado desde main.
