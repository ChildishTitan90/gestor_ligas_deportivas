# PDGLD-97 — Integración CURP con Verificamex, entrega 2

31 de octubre de 2026. Complementa el [contrato de identidad e inscripción](player-identity.md). Esta entrega no implementa las vistas de PDGLD-98 ni INE/selfie.

## Contrato externo revisado

[Documentación de Verificamex](https://identity.docs.verificamex.com/renapo/curp-validation/), consultada el 31/10/2026: POST a `https://api.verificamex.com/identity/v1/scraping/renapo`, Bearer en `Authorization`, JSON `{ curp, pdf_required: false }`. La página indica 3 tokens por datos y 20 si se solicita PDF. No se solicita PDF, no se sigue un webhook ni se consulta al escribir. Aunque aparezca un PDF no solicitado en el JSON, no se conserva ni se entrega.

El adaptador `features/players/server/verificamex-curp.ts` tiene transporte obligatorio en su constructor. Las pruebas proporcionan un transporte sintético; la conexión real se construye de forma diferida con `VMX_API_KEY`, exclusivamente en servidor y después de autorización. No se leen credenciales desde el navegador ni se registran headers, cuerpos o errores originales. El modo de pruebas del runner elimina la clave heredada y el cableado real se bloquea con `AUTH_TEST_RUN=1`.

La documentación ofrece el sobre de éxito `data.object=citizeninformations`, `citizen.status=true`, `codigo=0` y `registros`. Se valida su forma con Zod, se exige un único registro para contrastar y se comparan CURP, nacimiento, nombres y apellidos. Se aceptan diferencias de mayúsculas, acentos y separadores; el segundo apellido puede faltar. No se genera identidad a partir de la respuesta ni se sobrescribe Persona. Un HTTP 200 aislado no verifica nada.

Límite de respuesta: 128 KiB. Tiempo máximo: 10 segundos, incluyendo lectura del cuerpo. No se siguen redirecciones ni se hacen reintentos automáticos. El proveedor se llama fuera de toda transacción de base.

## Resultados

| Estado | Interpretación |
| --- | --- |
| `NOT_PERFORMED` | No hay intento para esa persona |
| `NOT_CONFIGURED` | Falta la clave; no se envió consulta ni se creó un intento con costo |
| `PENDING` | Intención persistida, todavía sin resultado definitivo |
| `VERIFIED` | Respuesta de éxito válida y los cinco datos contrastados coinciden |
| `DISCREPANCY` | Difieren campos; se devuelven solo sus nombres, sin valores del proveedor |
| `NOT_FOUND` | Sobre de consulta exitoso pero colección de registros vacía |
| `INVALID_CREDENTIALS` | HTTP 401/403, clasificado como acceso no autorizado al proveedor |
| `INSUFFICIENT_BALANCE` | Clasificación defensiva de HTTP 402; pendiente de contrastar la respuesta real de saldo |
| `UNAVAILABLE` | HTTP 429 o error 5xx del proveedor |
| `UNEXPECTED_RESPONSE` | JSON, tipo de respuesta, código o cantidad de registros no admitidos |
| `UNCERTAIN` | Corte de red/timeout, o intención pendiente durante más de 30 segundos: cobro y resultado inciertos |
| `STALE` | Cambió la versión o huella de identidad; la comprobación no es vigente |

La documentación no publica aquí todos los códigos sin coincidencia ni los errores de saldo. Un `status=false` o código distinto de cero no se adivina como CURP inválida o persona inexistente: queda como respuesta inesperada. La ausencia de registros se prueba con un sobre sintético de éxito vacío. Los mapeos reales pendientes deben confirmarlos los humanos; no se extrapolan códigos de otros productos del proveedor.

La web comercial menciona entorno de pruebas, pero no se verificó un sandbox específico de este endpoint ni sus condiciones. Las pruebas locales son simulaciones propias. No se ha comprobado saldo o cobro real ni se interpreta el saldo de 100 tokens como 100 consultas.

## Permisos y persistencia

El delegado registra jugadores de sus equipos inscritos. Para consultar CURP se exige sesión operativa, `players:READ` y `players:UPDATE` en el ámbito real de la inscripción. No se confía en club/liga/usuario enviados por el navegador. Secretaría puede operar con sus permisos vigentes y alcance; la consulta no concede aprobación deportiva ni facultad de resolver coincidencias a un delegado.

El servicio `curp-verification-service.ts` prepara una intención en transacción: bloquea inscripción y Persona, comprueba versión, contexto y permisos, arbitra cuotas en PostgreSQL y crea `player_curp_checks`. Libera la transacción antes de llamar al proveedor. Después guarda únicamente estado, versión, huella, campos discrepantes y tiempos. Vuelve a autorizar antes de responder; si se revocaron permisos durante la red, conserva el acuse para evitar otro cobro y deniega la lectura.

Cada intención lleva una clave UUID estable por actor. Reenviar esa misma clave devuelve el intento anterior; usar otra clave sin `retryOf` tampoco reenvía una consulta pendiente o fallida. Una coincidencia vigente se reutiliza para la misma Persona incluso entre temporadas, siempre con autorización sobre la inscripción destino. Ninguna lectura llama al proveedor.

Un reintento deliberado requiere una clave nueva, la misma versión, `retryOf` apuntando al intento más reciente y `confirmCharge=true`. Si el anterior quedó incierto exige además `acknowledgePossiblePreviousCharge=true`. Esta confirmación advierte de un posible cobro anterior; no lo revierte ni demuestra que no ocurrió. La vista futura debe conservar la clave ante pérdida de respuesta y ofrecer primero consulta de estado. Un intento pendiente reciente no se reenvía ni con una confirmación nueva.

Límites conservadores de esta entrega, compartidos por todos los procesos: **3 intentos globales por día, 2 por usuario y 60 segundos entre intentos de una Persona**, con día de `America/Mexico_City` calculado por PostgreSQL. Los intentos inciertos/fallidos cuentan; las lecturas y la reutilización de resultados no cuentan. Son límites técnicos de gasto, no reglas deportivas. Se revisan con el equipo antes de ampliarlos; no los puede elegir el navegador.

`people.identity_version` se incrementa por trigger al cambiar CURP, nombres, apellidos o nacimiento. No se puede disminuir por UPDATE; restaurar los valores anteriores tampoco restaura una comprobación vieja. Una respuesta que llega después de un cambio se guarda `STALE`. El frontend solo recibe versión/resultado, nunca una bandera que el servicio acepte como prueba.

Los intentos no se borran y un resultado terminal no se reescribe. Los triggers auditan una inserción pendiente y su cierre con el contexto del actor, sin CURP, nombres, nacimiento, acta, PDF o clave. No se duplica manualmente esa auditoría. Ningún resultado externo cambia el estado deportivo `INELIGIBLE` o resuelve una coincidencia local. Una falla no produce rechazo automático, aprobación ni política nueva de revisión manual de CURP.

## Entrada HTTP para la futura captura

- `GET /api/player-registrations/{registrationId}/curp-verification`: estado local, versión y resultado mínimo; opcional `?checkId=UUID` para recuperar un intento concreto de esa Persona.
- `POST` a esa misma ruta: JSON estricto con `operationKey`, `identityVersion`, `confirmCharge: true` y, solo si corresponde, los campos de reintento. Requiere origen propio, sesión y permisos. Máximo 2 KiB.
- Respuestas privadas `no-store`. Errores de contrato, alcance, versión y cuota tienen códigos controlados. Un resultado de proveedor devuelto por HTTP 200 debe interpretarse por `status`.

Todavía no hay enlace del menú ni pantalla de captura de jugadores. El endpoint necesita una inscripción existente y autorizada; no crea jugadores ni evita las ventanas de alta del baseline. Si no hay una inscripción adecuada, la prueba humana integrada espera la captura de PDGLD-98. No crear personas residuales ni modificar registros ajenos para obtener un ID de prueba.

## Migración y seguridad

La migración aditiva `20261031020000_pdgld97_curp_checks` añade la versión de identidad, su trigger y una tabla específica de intentos. No altera migraciones compartidas, ventanas, categorías ni RLS de Docker. En Supabase activa RLS en la tabla nueva, revoca PUBLIC y los tres roles API, y no crea políticas para esos roles.

`CURP_PLAN` reconoce únicamente el SQL exacto por checksum y conserva los controles de ACL iniciales, RLS y permisos antes/después del despliegue. Otra creación de tabla o cambio de SQL sigue bloqueada. El plan del backend limitado de Preview añade solo lectura/inserción de intentos y actualización de resultado/tiempos; no concede borrado ni actualización de contratos/versiones. Incluye la columna inicial de versión de Persona porque Prisma materializa ese default en INSERT.

El plan se entrega para revisión; no ejecuta mantenimiento remoto ni despliegue. En esta sesión la migración se aplica únicamente en bases desechables. La base habitual y Supabase requieren su flujo humano de migración revisado antes de utilizar el endpoint.

## Decisiones que se conservan

Las llamadas reales a CURP/INE las ejecutan exclusivamente Víctor o sus compañeros. Los agentes no ejecutan el POST real ni usan la clave aunque esté configurada. La prueba humana debe contrastar respuesta y cobro sin publicar PII o tokens en evidencias.

INE + selfie con comparación automática corresponde a categorías de veteranos en una entrega posterior. Imagen borrosa o sin coincidencia pasa a revisión administrativa, sin rechazo ni aprobación automáticos. Fotos en bucket privado separado de firmas; no se aprovisiona Storage en esta entrega.
