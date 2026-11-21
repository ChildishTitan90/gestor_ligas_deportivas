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

## Continuación del 20–21 de noviembre: actualización del PR #64

Se revisaron los criterios vigentes de [PDGLD-32](https://victoranhernandez.atlassian.net/browse/PDGLD-32), sus comentarios (ninguno), el PR #64 y sus revisiones/hilos (ninguno registrado). La petición de Checo procede de la instrucción humana de esta sesión; no se atribuye a un comentario inexistente. El último commit publicado c650a6c tuvo CI aprobado, ejecución [44730278269](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/44730278269).

Se integró origin/develop 6139dba mediante el commit local 9db9a4614a74c389211be90822d91422306c7b32. El único archivo en conflicto fue `scripts/preview/runtime-plan.mjs`: se conservaron las cuotas de recuperación y los nuevos permisos de canchas, decisiones de propietario, asignación de localías e historial de partidos. No se editaron migraciones compartidas ni las regresiones publicadas de rollback/seed. PDGLD-29 y las carpetas originales en Documents permanecieron intactos.

La política numérica fue aprobada expresamente por la persona usuaria en esta sesión: 15 minutos; 3 solicitudes por destinatario/cuenta por hora; ventana de 60 segundos; cuotas por origen 5 solicitudes/10 confirmaciones y globales 50/100. La continuación del 21 de noviembre autoriza aplicarla al modo local existente, únicamente desarrollo/loopback, sin simular Vercel. No es una política productiva.

### Pruebas automatizadas

- `npm run test:password-recovery-isolated`: 3/3 en PostgreSQL 15 y 3/3 en PostgreSQL 17, con RLS, rol limitado y transporte simulado. Nuevo runner que reutiliza la suite existente sin compose ni bases habituales; ambos contenedores propios fueron eliminados.
- Incluye consumo concurrente, vínculo vencido/manipulado/usado, contraseña anterior rechazada, revocación, rollback conjunto ante fallo de auditoría, FAILED/UNKNOWN, equivalencia pública y límites atómicos.
- `npm run test:seed`: 19/19 más 7/7 del perfil demo, en PostgreSQL 15 propio, eliminado al terminar. Conservación de cuotas, rollback, idempotencia y concurrencia.
- `npm run test:ci`: 97/97, incluidos permisos de recuperación y préstamos de cancha.
- Política inicial 4/4; tras añadir la regresión específica HTTPS local, `npm run test:password-recovery`: 5/5.
- `npm run test:email-transport`: 7/7; ninguna llamada real al proveedor.
- TypeScript, ESLint completo, validación Prisma con URL sintética y guardia de migraciones: aprobados tras integrar develop. El primer typegen sin escalación falló por permisos de escritura del sandbox; se repitió correctamente con el permiso correspondiente, sin modificar los controles.
- `git diff --check`: correcto.
- La compilación local imprimió “Compiled successfully” y después terminó con código 143 sin completar todas sus fases: **no se considera build aprobado**. El resultado del CI del commit nuevo se debe consultar en el PR, no inferirlo del build parcial.

### Entorno local realmente preparado

Por instrucción humana se abandonó Vercel para esta aceptación. Los accesos anteriores dieron 404 en configuración y “You Need Access” en Preview; no se aplicaron cambios remotos. No se presenta la preparación documental de Preview como configuración ejecutada.

`npm run recovery:local -- prepare` creó PostgreSQL 17 exclusivo con tmpfs en loopback, aplicó 51 migraciones, activó RLS y preparó dos veces la provisión del rol limitado. Preparó una sola cuenta sintética, sin habilitar correo. Secretos/contraseña inicial/certificados están en `.env-recovery-local/`, fuera de Git y con permisos privados.

`npm run recovery:local -- serve` levantó Next.js en desarrollo, solo 127.0.0.1, en `https://127.0.0.1:34432`, con recuperación y correo apagados. HTTPS devolvió 200 para `/login` con validación TLS estricta y CA explícita; `openssl verify` aprobó la cadena. La verificación de confianza de macOS devolvió `CSSMERR_TP_NOT_TRUSTED`: falta importar/confiar manualmente en la CA, sin saltar advertencias del navegador.

El estado saneado inicial confirmó 51 migraciones, 0 solicitudes, 0 sesiones y 0 cambios de contraseña. La inspección de presencia confirmó que todavía faltaban clave Resend, remitente, buzón y confirmación privada de control. Se pidió introducirlos en el archivo privado, no en el chat. No se enviaron correos reales en esta continuación.

**Pendiente:** configuración privada de Resend y confianza del certificado; después, activar el proceso local, recepción efectiva en buzón, recorrido real con navegador, nueva contraseña, rechazo de la anterior, revocación de sesión previa y reutilización rechazada. Los resultados automatizados anteriores no sustituyen esa aceptación. El equipo debe aceptar explícitamente el entorno local alternativo; no se declara validado un despliegue ni se cierra Jira.

Procedimiento y comandos: [aceptación HTTPS local](../operations/pdgld32-local-acceptance.md). La [preparación anterior de Preview](../operations/pdgld32-preview-acceptance.md) se conserva como antecedente sin ejecución remota.

Comprobación HTTP adicional sobre HTTPS local con validación TLS: `/api/access` respondió 401 sin sesión; `/api/auth/recovery/request` respondió 503 con el proceso aún deshabilitado. No se emitió correo. Tras añadir el runner local y la regresión HTTPS, TypeScript y ESLint completo volvieron a pasar.
