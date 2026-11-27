# Borrador de PR hacia develop

**Título:** PDGLD-77 — Cargos únicos y semanales con persistencia, acuses y pruebas de integración

Tesorería puede crear cargos para un club afiliado o equipo de temporada, revisarlos antes de confirmar, consultar su saldo y corregir importe/vencimiento con motivo y versión. Guardar un plan semanal conserva su configuración; la generación explícita de cada periodo crea o recupera su cargo. Crear un cargo mantiene el adeudo pendiente y no registra pagos.

La rama conserva las vistas y el diseño de PDGLD-174, conecta los servicios de PDGLD-175 y agrega la validación de PDGLD-176. PostgreSQL protege la unicidad por temporada, concepto, destinatario y periodo; la transacción conserva efecto, auditoría y acuse por intención. Reutilizar una clave con otros datos se rechaza. Cada lectura/escritura comprueba sesión, permiso, acción y ámbito en servidor.

## Validación

- `npm run test:billing` y `npm run test:billing -- --postgres=17`: **18/18 en PostgreSQL 15.19 y 18/18 en 17.12**. NextAuth, HTTP/Server Actions, Chrome y PostgreSQL desechable, con backend limitado y RLS. Incluyen concurrencia, rollback, revocación, IDOR, precisión, historial y recuperación tras cortar una respuesta después del commit.
- Typecheck, lint y regresiones pertinentes; resultados y capturas en [PDGLD-77.md](PDGLD-77.md).
- Job de matriz `billing` requerido por `CI listo para integrar`. El shell del gate se prueba con éxito, fallo, cancelación y omisión. La ejecución remota de Actions queda pendiente de publicar la rama.

## Pendientes de aceptación

Mantener como borrador. Falta la integración de multa con una resolución válida de PDGLD-27; FINE permanece bloqueado. La generación automática de arbitraje por partido necesita contrato de devengo e importes. Las pruebas protegidas no acreditan esas integraciones ausentes. Falta revisión humana de las vistas/backend y revisión del PR por otra persona.

Revisar la migración aditiva existente `20261125010000_pdgld175_charge_integrity`, duplicados históricos y el plan privado de ACL/RLS antes de Preview/Production. No se modificó Supabase ni se implementaron los recorridos completos de pagos, semáforo o avisos.
