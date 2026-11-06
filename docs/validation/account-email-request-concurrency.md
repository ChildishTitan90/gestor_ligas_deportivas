# PDGLD-118 — solicitudes concurrentes de correo en PostgreSQL

Estado actual: **aprobado contra PostgreSQL 15 y 17**, con conexión real
`gestor_ligas_preview` y RLS activo, dentro del run-id `.204`. Se ejecutó el caso
nuevo; no se atribuye esta aprobación al caso en memoria o al mantenimiento `.203`.

| PostgreSQL | Caso integrado | Perfil Preview/RLS | Limpieza |
| --- | --- | --- | --- |
| 15 | Aprobado | Aprobado | Runner e inspección independiente aprobados |
| 17 | Aprobado | Aprobado | Runner e inspección independiente aprobados |

Se confirmó la superposición de las dos conexiones esperando RF22. El perdedor
obtuvo 409 `ACCOUNT_CHANGED`, sin fila, auditoría ni aviso propios. El reemplazo
aceptado con revisión actual dejó la anterior SUPERSEDED; el token anterior
falló sin efectos y solo el vigente actualizó correo, revisión, versión, sesiones,
resets y auditoría. Su reutilización también fue rechazada.

La evidencia saneada por versión incluye `concurrentEmailRequests.passed=true`,
`overlap=two-postgresql-connections-waiting-on-rf22`,
`sameRevision=one-success-one-account-changed` y
`replacement=only-current-token-confirms`. Véase el [informe general](account-email-change.md).

Se incorpora en `tests/integration/account-email-change.mjs`, dentro del perfil
Preview/RLS ejecutado con run-id `118e2026-1105-4a18-8a15-000000000204`. No requiere
repetir el perfil de mantenimiento ya aprobado ni crear otros recursos.

## Expectativas del caso

1. Crear una cuenta sintética exclusiva del caso con sesiones y reset pendientes.
2. Mantener RF22 con la conexión propietaria de fixtures y lanzar dos solicitudes
   desde clientes Prisma independientes, con la conexión limitada de Preview,
   igual cuenta/revisión, distintos destinos y claves de operación.
3. Comprobar en `pg_stat_activity` que ambas conexiones esperan el bloqueo antes
   de liberarlo. El rol propietario solo prepara/observa fixtures; las solicitudes
   pasan por el servicio y su autorización reales con el runtime limitado.
4. Exigir un éxito y un 409 `ACCOUNT_CHANGED`: una solicitud PENDING, un evento
   de auditoría, una revisión reservada y solo los dos mensajes sintéticos del
   ganador. Correo vigente, versión de sesión, sesiones y resets siguen intactos.
5. Reintentar el perdedor con su revisión obsoleta: mismo conflicto, sin residuos.
6. Envejecer únicamente `created_at` del fixture 61 segundos, como en los demás
   casos de esta suite. No cambiar reloj del servicio, límites, revisión o versión.
   Solicitar reemplazo con la revisión recién consultada: anterior SUPERSEDED y
   una sola PENDING nueva.
7. El token del ganador inicial, ahora sustituido, debe fallar sin efectos. Solo
   el token vigente confirma: correo final esperado, incremento único de versión,
   revocación, resets invalidados, auditoría y ningún PENDING. Reutilizarlo falla.

El secreto existe solo en memoria del transporte de prueba. La respuesta IPC
contiene únicamente `concurrentRequestsPassed: true` después de todas las
aserciones; el supervisor exige esa marca y registra metadatos saneados en su
resultado. No se guardan tokens ni enlaces en evidencia o logs. ACCEPTED en el
transporte sintético no prueba entrega de correo real.
