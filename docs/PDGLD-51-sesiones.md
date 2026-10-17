# PDGLD-51 — Cierre y expiración de sesiones

## Funcionamiento

- Las sesiones se guardan y validan en PostgreSQL.
- AUTH_IDLE_TIMEOUT_MINUTES configura el límite de inactividad.
  El valor predeterminado es 30 minutos.
- Consultar la sesión o una ruta protegida no renueva la actividad.
- POST /api/session/activity renueva únicamente sesiones vigentes.
- Una sesión vencida o revocada no puede reactivarse.
- Cerrar sesión invalida su cookie en el servidor y conserva otras sesiones.
- Si falla la revocación, el cierre devuelve 503 y conserva las cookies
  para permitir un reintento.
- Se valida el estado de la cuenta, su versión y el cambio obligatorio
  de contraseña.

## Auditoría y coordinación

Esta implementación registra LOGIN_OK al crear la sesión persistente
y LOGOUT al cerrarla. Repetir el cierre no duplica el evento.

Coordinar con PDGLD-48 y PDGLD-49 para evitar registros duplicados.
Los eventos de credenciales fallidas, bloqueo y cambio de contraseña
corresponden a sus respectivos flujos.

La validación de versión está cubierta. Falta verificar la integración
con el incremento de versión durante el cambio real de contraseña
de PDGLD-49. Los roles y el contexto corresponden a PDGLD-54.

## Pruebas

Ejecutar:

- npm run test:auth
- npm run lint
- npx tsc --noEmit --incremental false
- git diff --check origin/develop

test:auth ejecuta las pruebas de política y las pruebas HTTP
con PostgreSQL temporal.

Se cubren límites de inactividad, renovación por actividad,
sesiones vencidas, reutilización de cookies después del cierre,
sesiones independientes, fallos de revocación y auditoría sin duplicados.

## Alcance

Corresponde a PDGLD-51. No incluye la matriz completa de permisos,
recuperación por correo ni PWA.