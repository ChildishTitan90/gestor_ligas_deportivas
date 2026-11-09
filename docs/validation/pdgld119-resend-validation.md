# PDGLD-119 — validación del adaptador Resend

Decisión técnica del usuario ejecutada el 8 de noviembre de 2026. El proveedor
de pruebas elegido es Resend; [contrato y fuentes](../architecture/resend-test-provider.md).
No se configuró un proveedor falso como alternativa de producción.

La primera ejecución de `npm run test:email-transport` aprobó 4/4 pruebas: configuración
incompleta/insegura, petición/plantilla/idempotencia, rechazos e incertidumbre sin
reintentos y token de confirmación solo en fragmento. Cada prueba inyecta fetch;
ninguna consulta al proveedor. Mantenimiento de cuentas aprobó 28/28 pruebas
puras; los controles locales de CI aprobaron 91/91. El nuevo comando se añadió
a la comprobación de aplicación del workflow, sin ejecutar/publicar un CI remoto.

## Integración con el adaptador real y transporte simulado

Ejecución `7c7f2f80-a03c-46a7-a146-3ecc508f0119`:

| Comprobación | PG15 | PG17 |
| --- | --- | --- |
| NOT_CONFIGURED: cuenta/sesiones/tokens/pendientes/auditoría intactos | Aprobada | Aprobada |
| Adaptador Resend y petición HTTP con idempotencia | Aprobada | Aprobada |
| Permisos, ámbito, destino verificado y último administrador | Aprobada | Aprobada |
| Rollback sin entrega y una operación ante concurrencia | Aprobada | Aprobada |
| Expiración, uso único y cambio obligatorio en Chrome | Aprobada | Aprobada |
| FAILED/UNKNOWN, reemplazo y consulta sin reenvío | Aprobada | Aprobada |
| Auditoría sin credenciales, móvil/escritorio y ambos temas | Aprobada | Aprobada |
| Tipado de la copia y limpieza antes de continuar | Verificados | Verificados |

El fixture sustituye únicamente fetch del adaptador Resend en la copia
desechable. Valida endpoint fijo/cabeceras y transforma la petición de texto en
un acuse sintético en memoria. ACCEPTED usa respuesta con id; FAILED y UNKNOWN
se obtienen mediante estados HTTP 422 y 503. El endpoint real no recibe llamadas.
Los mensajes se vacían al cerrar y se eliminan las copias/perfiles/redes/bases.
PG17 solo comenzó después de aprobar PG15 y verificar limpieza y puertos libres.

Un primer intento falló una aserción HTTP en el escenario de expiración; no se
consideró aprobado. Se añadieron diagnósticos limitados a estados HTTP numéricos,
sin cuerpos o secretos. La repetición completa aprobó ambas versiones sin
cambiar reglas de sesión, expiración o validación ni omitir el escenario.

Resumen sin credenciales de esta ejecución simulada: `pdgld119-resend-results.json`.
Tipado y lint locales aprobaron. Estos resultados históricos no acreditan por sí
solos una entrega real. El seguimiento posterior amplió el adaptador a 6/6
pruebas y la matriz de restablecimiento a 19 comprobaciones por versión.

## Prueba real posterior, separada de la simulación

Un único envío desde `onboarding@resend.dev` recibió HTTP 200 / ACCEPTED y el
usuario confirmó su recepción en Hotmail. No hubo reintentos; envío deshabilitado
y limpieza verificada. El remitente fue de pruebas, limitado al correo de la
cuenta Resend. La configuración de producción con dominio propio sigue sin
validar. Véanse el [informe consolidado](pdgld119-single-email-preparation.md)
y la [evidencia saneada](pdgld119-real-email-results.json), sin claves,
credenciales, enlaces ni capturas sensibles. No se modifica Jira.
