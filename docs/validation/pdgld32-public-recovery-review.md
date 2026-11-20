# PDGLD-32: corrección posterior a PR #61

Base: `edf0122` (develop, PR #61 integrado). Rama:
`fix/PDGLD-32-politica-abuso`.

La recuperación pública necesita cuotas previas a la consulta de cuentas y
una configuración explícita antes de activarse. Se añaden presupuestos
atómicos compartidos en PostgreSQL por origen, destinatario/token y global.
Las solicitudes limitadas conservan el 202 genérico sin encolar correo;
la confirmación limitada responde 429 sin cambiar la contraseña.

Se conserva la recuperación ante rechazo confirmado y entrega incierta,
la revocación de sesiones, RLS, las ACL de recuperación y los permisos de
préstamos de cancha. La migración es nueva; no cambia migraciones publicadas.
La recuperación permanece deshabilitada por defecto.

Validación local: integración PostgreSQL 15.19 y 17.11, tres casos principales
por versión con rol Preview/RLS y correo simulado; política 4/4; transporte
7/7; controles de CI 95/95; tipado, lint y compilación de producción aprobados. El build utilizó un secreto
sintético generado para la prueba; emitió un aviso de seguridad de la versión
de Next.js ya presente, sin cambiar dependencias en esta corrección. La prueba del contrato
público invoca los mismos handlers de las rutas con Request/Response y base
real; no constituye un recorrido de navegador en el entorno desplegado.

Pendiente antes del cierre: documentar los valores de política del entorno,
aplicar allí migración y permisos, validar con buzón controlado y navegador,
obtener revisión humana y CI del nuevo PR. No activar producción ni dar Jira
por terminada solo porque PR #61 se fusionó.

## Descripción para el PR nuevo

Agregar cuotas públicas compartidas y exigir configuración completa antes de
habilitar la recuperación de contraseña. Conserva el reintento tras rechazo
confirmado, el enlace ante entrega incierta y los permisos de préstamos de
cancha. Incluye regresiones con PostgreSQL 15/17 y RLS.

La validación y configuración del entorno de pruebas siguen pendientes;
la funcionalidad continúa apagada por defecto.
