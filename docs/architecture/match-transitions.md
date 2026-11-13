# PDGLD-132 — Primera transición de partido

Entrega parcial de PDGLD-132, dentro de PDGLD-85: servicio de servidor para
**BORRADOR → PROGRAMADO → CONFIRMADO → EN CURSO → SUSPENDIDO**. No completa la subtarea ni la historia. La interfaz
se integrará en PDGLD-133; todavía no existe una ruta pública o botón para invocarlo.

## Estados del esquema

| Nombre de la historia | Código existente |
| --- | --- |
| BORRADOR | `DRAFT` |
| PROGRAMADO | `SCHEDULED` |
| CONFIRMADO | `CONFIRMED` |
| ENCURSO | `IN_PROGRESS` |
| FINALIZADO | `FINISHED` |
| ENREVISIÓN | `UNDER_REVIEW` |
| NO_PRESENTADO | `NO_SHOW` |
| SUSPENDIDO | `SUSPENDED` |
| CANCELADO | `CANCELED` |
| REPROGRAMADO | `RESCHEDULED` |
| NO_PROGRAMADO | `UNSCHEDULED` |
| RESUELTO_ADMINISTRATIVAMENTE | `ADMINISTRATIVELY_RESOLVED` |

## Matriz de esta entrega

| Origen | Destino | Autoridad | Condiciones y efectos |
| --- | --- | --- | --- |
| DRAFT | SCHEDULED | SCHEDULER con `scheduling:UPDATE` vigente en la liga del partido y fila en `match_status_transitions` | Partido no eliminado, temporada no cerrada, versión esperada, cancha/horario completos. Incrementa versión, agrega historial y activa reservas mediante triggers. |
| SCHEDULED | CONFIRMED | SCHEDULER con `scheduling:UPDATE` vigente en la liga y fila de transición | Además exige exactamente una designación MAIN aprobada de árbitro activo. Conserva reservas e historial. |
| CONFIRMED | IN_PROGRESS | DATA_ENTRY con `match-reports:UPDATE` vigente en la liga | Registra lo observado en el encuentro o informado por el árbitro. |
| IN_PROGRESS | SUSPENDED | DATA_ENTRY con los mismos controles | Requiere motivo; el catálogo actual libera reservas al suspender. |
| SCHEDULED, CONFIRMED o SUSPENDED | CANCELED | EXECUTIVE_PRESIDENT o SUPERADMIN con `scheduling:APPROVE` y ámbito de liga | Requiere motivo. Se bloquea si existe cédula o resultado, hasta integrar su revisión. |
| Cualquier otro par | — | Ninguna en este servicio inicial | Denegado. No interpreta la existencia de una fila en la matriz como implementación de sus efectos. |

La migración incorpora estas transiciones. No asigna usuarios, no añade
permisos RBAC, no concede bypass a SUPERADMIN y no restaura concesiones revocadas.
La misma asignación debe cubrir el permiso y el rol de transición. Se excluyen
asignaciones restringidas a un club: programar es una operación de liga.

El 12 de noviembre la persona responsable aceptó como base de trabajo la siguiente
matriz funcional. Esta aceptación no sustituye la coordinación con programación,
arbitraje y cédula prevista en la historia ni acredita una implementación:

| Acción | Autoridad propuesta | Condición |
| --- | --- | --- |
| Programar | Programador de liga | Cancha y horario válidos. |
| Confirmar | Autoridad de programación de liga | Requisitos operativos completos. |
| Iniciar y suspender | Capturista autorizado | Registra lo ocurrido durante el encuentro o con las notas del árbitro; motivo para suspender. |
| Cancelar | Autoridad de liga con permiso | Motivo e historial. |
| Reprogramar | Programador de liga | Motivo, nuevo horario y comprobación de conflictos. |
| Registrar no presentación | Árbitro en cédula; capturista registra | La cédula documenta el incidente y el resultado correspondiente; la autoridad revisa los incidentes disciplinarios. |
| Resolver administrativamente | Autoridad de liga expresamente autorizada | Decisión y motivo; efectos una sola vez. |
| Finalizar | Confirmación autorizada de cédula | Resultados una sola vez; impedir edición directa. |
| Pasar a revisión | Autoridad de liga expresamente autorizada | Motivo; no alterar resultados silenciosamente. |

La asignación técnica de los permisos de autoridad de liga y los contratos de
designación, cédula y efectos deportivos aún requieren integración. El catálogo
actual no concede al árbitro `scheduling:UPDATE`; no se debe interpretar el acuerdo
como una concesión global ni permitir transiciones sin validar la designación.
Quedan por integrar no presentación,
reprogramación, revisión y resolución administrativa. La finalización
requiere el contrato de cédula y aplicación única de resultados (PDGLD-18/21).
No debe habilitarse agregando solamente un par a la matriz. FINALIZADO no se puede
reabrir por esta entrada; una corrección necesita su autorización y servicio propios.

## Contrato interno

`transitionMatch(input)` obtiene la identidad mediante `requireOperationalUser`.
`transitionMatchInTransaction(tx, actorId, input)` es interno, para composición y
pruebas: no exponer `actorId` en una acción o endpoint. La futura entrada HTTP debe
aplicar las defensas de sesión/origen y convertir errores a mensajes seguros.

```ts
{
  matchId: "UUID del partido",
  operationId: "UUID generado una sola vez por intención",
  expectedVersion: 1,
  toStatus: "SCHEDULED",
  reason: "Motivo operativo sin datos personales ni secretos"
}
```

El contrato estricto rechaza campos adicionales, actor/rol del cliente, motivos
vacíos o de más de 500 caracteres y versiones inválidas. El horario ya debe estar
guardado en el borrador por programación; esta transición no crea ni mueve partidos.
PostgreSQL verifica cancha activa de la liga, duración, holgura, disponibilidad y
conflictos con reservas de equipos/cancha mediante los controles de PDGLD-22.

El resultado contiene `operationId`, `matchId`, `toStatus`, `appliedVersion`,
`occurredAt` y `replayed`. **Es un acuse histórico, no una lectura del estado actual**.
Para repetir tras una respuesta incierta, conservar exactamente la operación,
versión, destino y motivo. Un acuse anterior solo se devuelve después de comprobar
de nuevo los permisos vigentes. Un UUID reutilizado con otro contenido se rechaza.

## Atomicidad e historial

La transacción bloquea autorización/actor, temporada y partido, en ese orden.
El bloqueo del partido serializa reenvíos: una solicitud aplica y las demás
recuperan su acuse. Dos operaciones distintas sobre la misma versión producen un
éxito y un conflicto `STALE_MATCH`. Una temporada cerrada no admite nuevas escrituras.

Se usa el UUID del historial como clave de operación y se agrega `expected_version`
nullable; las filas antiguas permanecen intactas. Un índice único por partido y
versión protege contra reutilizar una versión. El trigger existente impide modificar
o borrar el historial. La auditoría de `matches` registra actor, motivo y correlación;
no se escribe una segunda auditoría desde TypeScript. Reservas, auditoría, versión e
historial pertenecen a la misma transacción: cualquier fallo revierte todo.

Los campos de número, notas, baja lógica y descansos no se modifican. No se modifica
el baseline ni se aplica la migración a la base habitual o a Supabase en esta entrega.

## Verificación

- `npm run test:match-transitions`: contrato, horarios, versión obsoleta, baja,
  temporada cerrada, denegación del resto de caminos y contenido de reenvío.
- `npm run test:match-transitions-db`: servicio real con Prisma/PostgreSQL, alcance
  de liga, reenvío concurrente, una sola auditoría/historial, reservas, rollback por
  traslape, concurrencia entre operaciones e historial inmutable, revocación.
- Ambos comandos se incorporan al workflow; la suite de base corre en PostgreSQL 15/17.

La suite de base **requiere una base desechable explícita**: localmente acepta solo
`127.0.0.1:55432/pdgld132`, sin parámetros de conexión; en GitHub Actions acepta la
base temporal `gestor_ligas_ci`. No usa `.env`. Aplicar todas las migraciones antes
de ejecutarla. Los fixtures son sintéticos y permanecen en esa base desechable.

Ejemplo PowerShell para una terminal con acceso a Docker (contraseña solo de prueba):

```powershell
docker run --name pdgld132-tests -e POSTGRES_PASSWORD=pdgld132_test_only -e POSTGRES_DB=pdgld132 -p 127.0.0.1:55432:5432 -d postgres:15
# Esperar a que pg_isready informe que acepta conexiones.
docker exec pdgld132-tests pg_isready -U postgres -d pdgld132
$env:DATABASE_URL = 'postgresql://postgres:pdgld132_test_only@127.0.0.1:55432/pdgld132'
$env:DIRECT_URL = $env:DATABASE_URL
$env:PDGLD132_TEST_DATABASE_URL = $env:DATABASE_URL
npx --no-install prisma migrate deploy
npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
npm run test:match-transitions-db
```

Usar una terminal dedicada para no reutilizar sus variables al iniciar la aplicación.
No sustituir el destino por una base compartida. La revisión humana, el resto de
transiciones y la evidencia funcional integral siguen pendientes antes de cerrar 132.
