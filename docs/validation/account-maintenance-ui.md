# PDGLD-118 — validación de la interfaz de cuentas

## Alcance publicado

`/accounts` incorpora consulta, búsqueda, paginación, detalle, cambio de username,
solicitud de correo y baja/reactivación. Reutiliza ManagementShell, navegación por
capacidades del servidor, SelectField, FormDialog, ActionLink y tokens existentes.
No modifica contratos de escritura, migraciones o configuración de proveedores.
Ver [decisiones de interfaz](../design/account-maintenance.md).

## Resultado integrado — 6 de noviembre de 2026

| Versión | API/SQL real | Chrome real `/accounts` | Limpieza |
| --- | --- | --- | --- |
| PostgreSQL 15 | Aprobada en `.221`; no repetida | Aprobada en `.230` | Verificada antes de iniciar PG17 |
| PostgreSQL 17 | Aprobada en `.230` | Aprobada en `.230` | Verificada al terminar |

Referencias de ejecución: `.221` corresponde a
`118e2026-1106-4a18-8a15-000000000221` y `.230` a
`118e2026-1106-4a18-8a15-000000000230`. Son ejecuciones consumidas; no reutilizar
esos identificadores. `.230` terminó con código 0 y ambas versiones registradas
como aprobadas y limpiadas, sin recursos pendientes.

Chrome ejercitó Next y NextAuth con backend PostgreSQL real y datos sintéticos:

- SUPERADMIN global: listado, segunda página, búsqueda desde el formulario y
  detalle autorizado.
- Cambio de username con motivo y confirmación, persistencia al volver a cargar
  `/accounts` y revocación de una sesión previamente válida de la cuenta afectada.
- Baja/reactivación con motivo y confirmación; revocación de sesión tras la baja.
- Revisión obsoleta provocada en PostgreSQL con el formulario abierto: rechazo
  visible, consulta de la versión actual y nueva confirmación.
- Solicitud pendiente de correo: correo vigente conservado en SQL y mensaje
  explícito `NOT_CONFIGURED`, sin afirmar envío ni entrega.
- Cuenta sin permiso: denegación y ausencia del formulario de búsqueda.
- Foco dentro del diálogo, Escape, retorno al disparador, reapertura con Enter,
  Tab entre campos/confirmación y foco visible.
- Diálogo en 1280 y 390 px, claro y oscuro, sin desbordamiento horizontal del
  documento. Se generaron cuatro capturas sintéticas por versión y el agente
  inspeccionó las cuatro de PG15; no se atribuye revisión visual humana completa.

## Aislamiento y limpieza

Antes de la primera ejecución se comprobó que `.221` no estaba consumido y que
los cuatro puertos estaban libres. PostgreSQL usó `127.0.0.1:55415/55417` y Next
`127.0.0.1:56515/56517`; Chrome utilizó perfil propio y CDP loopback efímero.
Los contenedores PostgreSQL 15/17 fueron secuenciales, con tmpfs, límites de
recursos y sin volúmenes persistentes ni montajes del repositorio.

El supervisor verifica puertos libres e identidad ausente antes de crear; no
adopta ni detiene servicios existentes. Al limpiar comprueba ausencia de
contenedor, red, aplicación, dependencias de trabajo y perfil Chrome, además de
liberación de puertos, antes de permitir la siguiente versión. Una comprobación
final independiente confirmó ausencia de esos recursos y de procesos propios
en todos los intentos, y bind exclusivo disponible en los cuatro puertos.

No se usaron base habitual, Supabase real, APIs reales CURP/INE ni correos reales.
Los registros, logs y capturas originales permanecen fuera de Git; aquí se publica
solo este resumen saneado. Tampoco se incluyen documentos internos, respaldos,
secretos o artefactos de prueba.

## Verificador y correcciones

`--account-maintenance` incorpora el recorrido de Chrome al worker existente.
`--account-maintenance-ui` es la continuación usada tras aprobar HTTP/SQL PG15:
prepara únicamente fixtures en PG15 y ejecuta HTTP/SQL completo en PG17 antes de
Chrome. Su etapa `fixtures-only` no acredita una aprobación HTTP nueva de PG15.

Los fallos intermedios se limitaron a la preparación y al driver del verificador;
se limpiaron sus recursos antes de usar otro run-id. PG17 no arrancó hasta aprobar
y limpiar PG15 en `.230`:

| Intento | Causa y ajuste |
| --- | --- |
| `.221` | HTTP/SQL PG15 aprobó; la preparación UI buscaba un username renombrable y falló con SQLSTATE 23503. Se usa una identidad fixture estable y actor de auditoría existente. |
| `.225` | EPERM al señalar el grupo de Chrome después de terminar su padre; se tolera exclusivamente tras observar la salida del padre. |
| `.226` | Captura de búsqueda antes de hidratación; se esperan los manejadores React. |
| `.227` | `element.click()` no enfocaba el disparador; se usan clics nativos de Chrome. |
| `.228` | Enter sin carácter nativo; keyDown incluye `text: '\r'`. |
| `.229` | Se confundía el estado «Esperando la respuesta» con el acuse; se exige «Cambio guardado» antes de comprobar persistencia/sesiones. |

## Controles complementarios y límites

Resultados conservados, sin repetir matrices locales para publicar:

- `test:account-maintenance-ui`: 21/21, con respuestas sintéticas del controlador,
  adaptador y renderizado React; no sustituye la prueba integrada de navegador.
- `test:account-maintenance`: 25/25, contratos y correo en memoria.
- Supervisor/aislamiento: 37/37; Chrome y cierre: 6/6.
- Copia limpia sin servicios: npm ci exacto, Prisma generate, Next typegen y
  typecheck aprobados. Lint y comprobación de diff aprobados.

El workflow de Aplicación incorpora la suite de UI sin servicios. Las ejecuciones
integradas `.221/.230` son evidencia local, no jobs de CI ni validación de RLS en
Supabase. El CI anterior sobre `73612fb` corresponde a la corrección del harness;
el CI del nuevo commit se informa por SHA en el PR #43.

La entrega posterior de [confirmación pública](account-email-confirmation-ui.md)
incorpora su pantalla. Quedan pendientes transporte real, remitente verificado y
plantillas. El [restablecimiento administrativo posterior](administrative-reset.md) conserva
su validación propia; la corrección de identidad queda fuera de esta entrega. No se declara regresión completa de
accesibilidad, todos los estados visuales o todos los recorridos de navegación.
