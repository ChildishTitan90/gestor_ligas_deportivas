# PDGLD-119 — restablecimiento administrativo integrado

## Alcance y criterios

Criterios vigentes consultados el 7 de noviembre de 2026:
[PDGLD-119](https://victoranhernandez.atlassian.net/browse/PDGLD-119) y
[PDGLD-117](https://victoranhernandez.atlassian.net/browse/PDGLD-117).
Se exige identidad comprobada mediante procedimiento operativo, entrega privada,
credencial aleatoria de un uso/caducidad, revocación y cambio obligatorio, con
permisos, concurrencia y auditoría sin secretos. No sustituye recuperación
por correo de PDGLD-32 ni modifica persona, roles, cargos o identidad deportiva.

## Correcciones al parche

- Se retiró `userVersion` del DTO y tipos de sesión pública. La prueba original
  de autenticación conserva su prohibición de ese campo. Un control nuevo llama
  al callback real y exige únicamente id y mustChangePassword.
- El cambio de contraseña obtiene identidad privada desde la cookie cifrada de
  NextAuth 4, revalida sesión en base y compara la versión bajo bloqueo de cuenta.
  Ignora Authorization y no acepta versión/identidad del cuerpo del navegador.
- La sesión restringida se acota por la caducidad administrativa al crearla,
  consultarla y renovar actividad. El cambio de contraseña revalida vencimiento
  antes de escribir y limpia los campos administrativos al completar.
- El reset anula también solicitudes de correo pendientes, además de sesiones y
  recuperaciones anteriores, dentro de la misma transacción/auditoría. Usa reloj
  SQL después del bloqueo para emitir la credencial.
- El formulario reutiliza SelectField con nombre, etiqueta y ayuda/error asociados;
  la confirmación/atestación se valida también en servidor. Después del acuse se
  elimina de la vista la solicitud de correo anterior y se exige nueva revisión.

## Resultado real de la ejecución .237

Run-id consumido: `119e2026-1107-4a18-8a15-000000000237`.
Perfil `--account-administrative-reset` del supervisor existente.

| Versión | HTTP/base real + Chrome real | TypeScript en copia independiente | Limpieza |
| --- | --- | --- | --- |
| PostgreSQL 15 | Aprobado | Aprobado | Verificada antes de iniciar PG17 |
| PostgreSQL 17 | Aprobado | Aprobado | Verificada al terminar |

Casos comprobados en ambas versiones:

- Sin sesión o con SUPERADMIN limitado a liga: denegación; cuenta propia, inactiva
  y canal no verificado rechazados. Motivo, método, confirmación y atestación son
  obligatorios; no se acepta un destino aportado por el navegador.
- Operador con UPDATE global y sin rol SUPERADMIN no puede restablecer el último
  SUPERADMIN operativo. Se conserva el bloqueo RF22 común.
- Sin transporte: HTTP NOT_CONFIGURED y snapshot de cuenta/sesiones/recuperaciones/
  solicitudes/auditoría intacto. Esta comprobación fue HTTP/SQL real; la
  presentación de NOT_CONFIGURED también tiene control de UI sin servicios.
- Fallo sintético de auditoría revierte hash, revisión, versión, sesiones y
  recuperaciones sin entregar una credencial.
- Dos resets de misma revisión: un 202, un 409, una modificación y una entrega.
  Dos logins con la misma credencial: solo uno abre sesión restringida.
- Credencial de 32 bytes aleatorios, vencimiento rechazado y sesión restringida
  invalidada al vencer. Su expiración pública no excede la de la credencial.
- Entrega FAILED/UNKNOWN conserva el commit, no repite con revisión anterior y
  una nueva operación manual invalida la credencial temporal anterior. Los
  registros de auditoría no contienen las credenciales emitidas.
- En Chrome, formulario real de /accounts con SelectField por teclado,
  atestación/motivo/confirmación, Escape, foco dentro del diálogo, retorno al
  disparador y reapertura por Enter. Revisión obsoleta rechazada y revisada.
- Se descartó mediante CDP la respuesta del POST real después del commit:
  interfaz incierta, cierre/reapertura y consulta sin reenviar; solo un POST y
  una entrega. No se simuló la escritura ni se atribuyó éxito a una respuesta
  ausente.
- El único destinatario fue el correo vigente verificado, nunca el pendiente.
  Sesiones, recuperaciones y solicitud de correo previa quedaron invalidadas.
- Login anterior denegado, cuenta temporal redirigida a cambio obligatorio y API
  de gestión denegada. Cambio desde el formulario real de contraseña, nuevo login
  funcional y credencial temporal inutilizable. Las sesiones públicas siguen
  excluyendo userVersion, sid y secretos en todas las comprobaciones Browser.

El diálogo se capturó a 1280/390 px, claro/oscuro, sin desbordamiento horizontal
del documento. El agente inspeccionó claro/escritorio y oscuro/móvil de PG15;
no equivale a revisión humana completa o regresión exhaustiva de accesibilidad.

## Aislamiento y evidencia

Antes de ejecutar se comprobó ausencia del run-id y listeners en los cuatro
puertos. PostgreSQL: 127.0.0.1:55415/55417; Next: 127.0.0.1:56515/56517; Chrome
con perfil propio y CDP loopback efímero. Contenedores tmpfs sin volúmenes o
montajes del repositorio, dependencias exactas del lockfile y copias sin .env.
La migración nueva del parche se aplicó únicamente en esas bases desechables;
no se modificaron migraciones compartidas ni se usó la base habitual/Supabase.

El transporte sintético se sustituye exclusivamente en el archivo server-only
DE LA COPIA desechable: un servidor loopback efímero autenticado guarda mensajes
y credenciales solo en memoria. El hijo de pruebas controla la activación dentro
de esa copia y obtiene las credenciales por el canal privado de prueba, nunca
por la UI, respuestas de aplicación, logs o archivos. No se añade un flag de
proveedor simulado al código de producción. El fixture se cierra y vacía al
limpiar; el repositorio conserva getEmailTransport() = null.

Evidencia original fuera de Git: registro de ejecución, resultados booleanos,
instalación y capturas sintéticas. No se publican credenciales, conexiones,
logs, capturas o archivos de la copia. No hubo envíos reales ni consultas reales
CURP/INE. No se repitieron las matrices anteriores .221/.230 o .236.

Controles sin servicios: mantenimiento 28/28, UI 22/22, aislamiento/ACL Preview
32/32 y lint aprobados. TypeScript aprobó en cada copia con cliente Prisma
regenerado; no se atribuye ese resultado a dependencias antiguas del workspace.
El CI del commit se informa por SHA en el PR #43.

## Bloqueo operativo

El proveedor real sigue sin implementación/configuración: getEmailTransport()
devuelve null y no hay evidencia disponible de remitente/dominio verificados.
Faltan selección de proveedor/cuenta, verificación del remitente, secretos de
servidor por canal privado, plantillas y límites/timeouts/operación de entregas
inciertas. No se consultaron ni utilizaron credenciales de correo real.

El único canal soportado por esta entrega es email vigente con propiedad ya
verificada. Las cuentas históricas sin esa prueba permanecen bloqueadas para
reset; no se marca propiedad por defecto ni se usa un correo pendiente como
atajo. La atestación de identidad es responsabilidad del operador y se audita;
no es una consulta externa de identidad.

Ante respuesta incierta se consulta el estado sin repetir la escritura, pero esa
lectura no recupera el acuse de entrega ni demuestra por sí sola que el reset
anterior ocurrió. La credencial no puede recuperarse desde su hash; una nueva
emisión requiere otra decisión manual, revisión vigente y verificación de
identidad. El PR permanece Draft mientras falten criterios de su alcance.
