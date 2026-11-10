# PDGLD-97 — Prueba de integración CURP, entrega 2

31 de octubre de 2026. No se han ejecutado consultas reales a Verificamex. La clave configurada por el usuario no se ha leído, impreso ni utilizado por el agente. La UI y su enlace del menú siguen pendientes de PDGLD-98.

## Pruebas automáticas sin consumir tokens

```powershell
npm run test:curp-provider
npm run test:player-registrations
```

La segunda requiere Docker/PostgreSQL local y `DIRECT_URL` loopback según la configuración existente. Crea y elimina exclusivamente una base aleatoria del runner; no aplica migraciones en la base habitual. El runner elimina `VMX_API_KEY` del entorno de sus hijos. La prueba proporciona siempre transporte sintético y el cableado real está bloqueado en modo de pruebas.

Resultados esperados: **8 pruebas del adaptador y 17 reportadas por integración** (16 casos y su contenedor), sin fallos. Prisma debe informar `No difference detected` al comparar la base desechable con el esquema.

Se cubren contrato HTTP exacto, PDF desactivado, nombres/fecha/CURP contrastados, apellido materno ausente, falta de configuración, respuesta sin registros, discrepancias, códigos no documentados, múltiples registros, JSON incorrecto y demasiado grande, credenciales, HTTP 402, indisponibilidad, corte de red y timeout sin reintentos. Son respuestas sintéticas, no confirmación del comportamiento real de cobro/saldo del proveedor.

La integración usa servicio Prisma y PostgreSQL real con datos sintéticos: permisos y club ajeno, versión antigua, intención forjada, concurrencia con una sola invocación al transporte, ausencia de locks durante la red, reutilización entre temporadas, auditoría mínima, inmutabilidad, cambio/restauración de identidad, revocación de permisos durante la consulta, cuotas y reintento incierto explícito. El bloque de seguridad real de la migración se ejecuta en transacción sobre marcadores Supabase simulados y se comprueba RLS/ACL de `anon`, `authenticated` y `service_role`; se revierte todo al salir.

Esta suite no es un recorrido de la UI de jugadores ni autentica una consulta real del proveedor. Los comandos están integrados al workflow de CI; ejecutar localmente no equivale a haber corrido GitHub Actions o PostgreSQL 17.

## Comprobaciones ejecutadas

| Comando | Resultado local |
| --- | --- |
| `test:curp-provider` | 8/8 con transporte sintético |
| `test:player-registrations` | 17/17 con PostgreSQL 15 desechable; migraciones/esquema sin diferencias |
| `test:player-identity` | 4/4 |
| `test:ci` | 27/27, incluido checksum exacto del plan CURP |
| `typecheck` / `lint` | Aprobados |
| `build` | Aprobado; incluye la nueva ruta dinámica. En Windows requirió salir del sandbox para crear el junction local de argon2 |
| `test:preview-runtime` | 64 aprobadas, 2 omisiones previstas; regresión HTTP local de cuentas/afiliaciones/equipos con rol limitado y RLS |

La regresión de Preview verifica los recorridos existentes y la provisión del rol. No equivale a haber probado la nueva pantalla de jugadores, que todavía no existe, ni la respuesta real de Verificamex. Las dos omisiones del runner se refieren a controles de migración/seguridad de equipos que su suite asigna a Docker y a su verificador específico; no son casos de CURP declarados aprobados sin ejecución.

## Preparación humana para el entorno habitual

1. Conservar `VMX_API_KEY` privada en `.env`, sin prefijo `NEXT_PUBLIC_` ni pegarla en consola/navegador. `.env.example` solo contiene un marcador comentado.
2. Confirmar que `DIRECT_URL` apunta a **Docker local**, nunca Supabase. Aplicar las migraciones pendientes mediante `npx --no-install prisma migrate deploy`, generar con `npx --no-install prisma generate` y reiniciar el servidor de desarrollo. El agente no ejecutó estas migraciones sobre tu base habitual.
3. Entrar con una cuenta operativa que tenga lectura y actualización de jugadores en su club, por ejemplo el delegado correspondiente. Necesitas el UUID de una inscripción de jugador existente, autorizada y en un equipo/temporada disponibles. No usar datos reales sin autorización.

Si todavía no existe una inscripción adecuada, se puede probar toda la lógica mediante las suites sintéticas. La primera prueba real de captura completa requiere la vista pendiente de PDGLD-98; no aparecerá “Registrar jugadores” en la sidebar por tener la clave.

## Consulta humana de estado, sin llamar al proveedor

Desde la consola del navegador en la aplicación local, sustituye únicamente el UUID de una inscripción propia:

```js
const registrationId = "UUID_DE_INSCRIPCION_AUTORIZADA";
const endpoint = `/api/player-registrations/${registrationId}/curp-verification`;
const localResponse = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });
const current = await localResponse.json();
```

Comprobar `localResponse.ok` y los campos `status`/`identityVersion`. No copiar cookies, claves ni datos personales a evidencias. GET solo consulta nuestra base, no consume consultas de Verificamex.

## Una consulta real, ejecutada exclusivamente por un humano

Ejecutar solo después de revisar el estado anterior y decidir consumir la consulta. La documentación indica 3 tokens para datos sin PDF. Conservar `request` y su clave si se pierde la respuesta; no generar otra para un reenvío accidental.

```js
const request = {
  operationKey: crypto.randomUUID(),
  identityVersion: current.identityVersion,
  confirmCharge: true,
};
const response = await fetch(endpoint, {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request),
});
const result = await response.json();
```

Interpretar `response.ok` y `result.status`; HTTP 200 no equivale a `VERIFIED`. La respuesta no debe incluir nombres, nacimiento, CURP, acta, PDF, token ni valores del proveedor. Contrastar la operación y su cobro en el panel de Verificamex antes de decidir cualquier reintento. El resultado no acredita que quien presentó la CURP sea su titular ni aprueba al jugador para competir.

Si hay respuesta incierta, consultar GET; no ejecutar otro POST por recarga, renderizado, escritura o cambio de red. El contrato de reintento deliberado y los límites de **3 globales/día, 2 por usuario/día y 60 segundos por Persona** están en la [decisión de integración](../architecture/player-curp-verification.md). No bajar esos controles para hacer pasar una prueba.

## Cierre y pendientes

Falta la comprobación humana de respuesta/cobro y de los códigos reales sin resultado o saldo, ya que el contrato publicado no describe todos ellos. Se conserva el criterio de respuesta inesperada ante códigos desconocidos. No se presume un sandbox del endpoint.

La revisión de coincidencias, la captura visual del delegado y su navegación siguen pendientes. Esta entrega no agrega INE, selfie, fotos, Storage ni aprobación deportiva. Detenerse tras entregar este avance y esperar la prueba/confirmación humana antes de PDGLD-98, conforme al trabajo por entregas.
