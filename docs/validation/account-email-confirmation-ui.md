# PDGLD-118 — confirmación pública del correo

## Criterios consultados

El 7 de noviembre de 2026 se consultaron Jira
[PDGLD-118](https://victoranhernandez.atlassian.net/browse/PDGLD-118), su historia
[PDGLD-117](https://victoranhernandez.atlassian.net/browse/PDGLD-117) y
[PDGLD-120](https://victoranhernandez.atlassian.net/browse/PDGLD-120).
Se conservan separación persona/cuenta/rol, autorización de servidor,
normalización/unicidad, preservación de referencias, revocación y evidencia
con base aislada. La confirmación complementa el mantenimiento; no acredita el
restablecimiento administrativo o la corrección de identidad pendientes. El PR
#43 debe permanecer Draft mientras falten criterios de su alcance.

## Navegador y backend real

La iteración inicial `.232` (`118e2026-1107-4a18-8a15-000000000232`) aprobó
PG15/17 y quedó limpia. La composición final con PublicShell aprobó en `.236`
(`118e2026-1107-4a18-8a15-000000000236`), sin reutilizar identificadores. Perfil nuevo
`--account-email-confirmation` del supervisor aislado existente. No repite la
matriz anterior de mantenimiento `.221/.230`.

| Versión | Chrome + Next + endpoint + PostgreSQL | Limpieza |
| --- | --- | --- |
| PostgreSQL 15 | Aprobado | Verificada antes de iniciar PG17 |
| PostgreSQL 17 | Aprobado | Verificada al terminar |

Solicitudes creadas con el servicio real y transporte sintético de servidor que
recoge los mensajes únicamente en memoria. Las identidades y direcciones fueron
sintéticas. El navegador usa la pantalla real y el endpoint existente, sin mocks
de confirmación HTTP o React. No hay inyección de transporte por env ni desde el
navegador. El aviso posterior a la confirmación conserva `NOT_CONFIGURED` en la
aplicación: la prueba no acredita envío real ni aviso aceptado por un proveedor.

Casos aprobados en ambas versiones:

- Correo anterior vigente y login válido mientras la solicitud está pendiente;
  el nuevo no autentica antes de confirmar.
- Abrir el enlace y recargar no envía POST ni consume el token. El fragmento se
  retira del historial actual; no se recupera desde almacenamiento tras recargar.
- Acción explícita confirma; el nuevo correo queda verificado y permite login,
  el anterior deja de autenticar, sesiones previas dejan de autorizar y la base
  no conserva sesiones activas anteriores.
- Reutilización rechazada sin nuevos cambios; enlace vencido rechazado sin
  alterar la cuenta; solicitud reemplazada rechazada y enlace vigente confirmado.
- Reloj/límite de aplicación conservados. Vencimiento y reemplazo se preparan
  cambiando fechas exclusivamente en las filas sintéticas de la base desechable.
- El secreto no aparece en HTML, URL de peticiones HTTP o referrer observado.
  Las respuestas y diagnósticos guardados no contienen tokens ni direcciones.
- La página pública conserva su resultado tras observar la revocación. Capturas
  de éxito a 1280/390 px, claro/oscuro, sin desbordamiento horizontal. El agente
  inspeccionó claro/escritorio y oscuro/móvil de PG15; no se declara una revisión
  humana completa de todos los estados o accesibilidad.

El supervisor comprobó run-id nuevo, puertos libres e identidades propias.
PostgreSQL en loopback 55415/55417, Next en loopback 56515/56517 y Chrome con perfil
propio/CDP efímero. Contenedores tmpfs, copias sin .env y npm ci exacto. Se conserva
la secuencia PG15 → aprobación/limpieza → PG17 → limpieza y la evidencia original
fuera de Git. No se usaron base habitual, Supabase ni APIs reales CURP/INE.

## Comprobaciones sin servicios

- Confirmación: 4/4 controles de parser, contrato POST y tratamiento de errores.
- Actividad de sesión: 6/6, incluida conservación del resultado público y
  redirección mantenida en gestión después de revocar sesión.
- Supervisor/aislamiento: 37/37. Lint aprobado.
- Tipado en copia independiente `.235`: npm ci exacto, Prisma generate, Next
  typegen y TypeScript aprobados; copia/dependencias retiradas. La composición
  final también ejecuta TypeScript en cada copia del perfil `.236`.

El intento de tipado `.233` se detuvo antes de instalar por EEXIST del directorio
de captura; se retiraron copia/dependencias y no hubo base ni servicios. El
reintento `.234` aprobó instalación pero se detuvo por el prefijo de captura no
permitido, antes de ejecutar TypeScript. `.235` completó la comprobación. Los
tres quedaron limpios y no ejecutaron bases, Next dev o navegador.

## Bloqueo concreto del correo real

`src/server/email/transport.ts` sigue devolviendo `null`. No hay adaptador de
proveedor, dependencia específica o configuración de correo documentada en
`.env.example`. Tampoco hay evidencia disponible de dominio/remitente verificados.
No se consultaron credenciales privadas de correo ni se intentaron envíos reales.

Para conectar correo falta una decisión verificable del equipo: proveedor/cuenta,
dominio y dirección remitente aprobados, verificación DNS/remitente en ese
proveedor, URL pública HTTPS de la aplicación y secretos de servidor aprovisionados
por el canal privado. Después se necesita el adaptador con límites/timeouts,
plantillas (confirmación al nuevo destino y avisos sin secreto al anterior),
idempotencia y tratamiento de acuses inciertos. Las plantillas deben usar el enlace
directo en fragmento sin registrar payloads ni convertir el secreto a query string.

Sin ese adaptador y remitente verificado la aplicación no puede entregar enlaces;
la pantalla ya permite consumirlos de forma explícita cuando estén disponibles.
Las solicitudes antiguas sin transporte requieren una nueva operación autorizada:
el token en claro no se puede reconstruir desde su hash. Este bloqueo no se
resuelve añadiendo un fallback simulado o afirmando entrega por `ACCEPTED` sintético.

No se han modificado proveedores, migraciones, contratos de servidor, compose.yml,
documentos internos, respaldos o stashes. El CI del commit de esta entrega se
informa por SHA en el PR; las matrices anteriores no se atribuyen al nuevo CI.

## Cierre de la entrega

La composición final `.236` terminó con código 0 en ambas versiones, con
TypeScript aprobado dentro de cada copia. La comprobación independiente de
limpieza confirmó ausencia de contenedores/redes, copias/dependencias y
perfiles/procesos Chrome de `.232`–`.236`, y disponibilidad de los cuatro puertos.
Solo permanecen registros y evidencia privada fuera de Git. No se repitió la
matriz previa `.221/.230`; `.236` comprobó la composición pública final afectada.
