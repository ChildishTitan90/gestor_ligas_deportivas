# PDGLD-56 — Escenarios de aceptación y requisitos de fixtures

Estado: dos pruebas independientes implementadas y ejecutadas.
También se ejecutaron las suites existentes de autorización y seed demo.
Revisión: 18 de octubre de 2026, America/Mexico_City.
Entrega pendiente de revisión del equipo.

## Fuentes y versión revisada

- ERS aprobado: RF22 y requisitos de seguridad, auditoría y privacidad.
- PDGLD-55 integrado en develop mediante PR #12, commit 872b42a.
- Motor de PDGLD-54 revisado y probado en el commit e176527,
  rama feat/PDGLD-54-autorizacion-compartida, PR #13.
- Las pruebas se ejecutaron sobre esa implementación; el PR #13
  aún no estaba integrado en develop durante la comprobación.
- Se conservaron AGENTS.md, el catálogo y el motor existentes.

## Oráculo independiente

Las expectativas no deben calcularse llamando al motor ni copiando su decisión.
Mantener constantes de casos, referencias a celdas y aserciones propias.
Instalar los datos reales con el instalador autorizado cuando esté disponible;
comparar sus efectos con estas expectativas, sin reimplementar el seed.

Ejemplos legibles de la matriz que sostienen los casos:

| Fila | Rol | Celda | Expectativa inicial |
| --- | --- | --- | --- |
| Usuarios y roles, RF22 | SUPERADMIN | CRUA | CREATE y READ para cuentas, sujetos al contrato de PDGLD-54 |
| Usuarios y roles, RF22 | SECRETARY / CLUB_DELEGATE | - | No obtienen alta de cuentas por tener estos roles |
| Clubes y equipos, RF01/RF21 | SUPERADMIN | CRUA | Puede existir una concesión inicial de READ |
| Clubes y equipos, RF01/RF21 | SECRETARY | CRUA | Otra asignación vigente puede conceder legítimamente READ |
| Clubes y equipos, RF01/RF21 | CLUB_DELEGATE | CRU* | Acceso solo al club y liga autorizados |
| Jugadores, RF02 | PLAYER | R* | Lectura propia; no de otros jugadores |
| Programación y partidos, RF05/RF09 | REFEREE | R* | Partido designado, sin universalizar por rol |
| Publicar en portal, RF16 | SCHEDULER | C (propone) | CREATE no implica PUBLISH |
| Publicar en portal, RF16 | SECRETARY | P (revisa) | No convertir P en APPROVE ni agregar READ |

Los identificadores técnicos del PR #12 son `users`, `clubs`, `players`,
`scheduling` y `portal`; la clave es `${module}:${action}`. Confirmarlos contra
la versión integrada antes de escribir imports. No conceder IMPORT por analogía.

## Aceptación

Todos los casos con autorización comienzan con cuenta activa, sesión operativa,
recurso existente, datos válidos y controles de origen/CSRF satisfechos. Un 403
de CSRF no constituye evidencia de una denegación por permisos. Para casos de
negación, comprobar ausencia de datos ajenos y ausencia de escrituras de negocio.

| ID | Preparación y operación | Resultado esperado | Capa |
| --- | --- | --- | --- |
| AUTHZ-01 | SUPERADMIN vigente con users:READ y users:CREATE. GET /api/accounts y POST con alta sintética válida. | GET 200 y POST 201; persistencia y contexto iguales a la solicitud autorizada. | HTTP existente |
| AUTHZ-02 | SUPERADMIN conserva su rol vigente, pero carece de users:CREATE y no tiene otra vía válida. POST con la misma estructura válida. | 403; no crea persona, club, cuenta o asignación. No hay bypass por nombre de rol. | HTTP existente |
| AUTHZ-03 | Iniciar sesión una sola vez; POST autorizado. Retirar users:CREATE mediante administración autorizada, sin quitar rol ni cambiar versión de usuario. Repetir POST con otro correo sintético y exactamente la cookie guardada. | Segunda petición 403; cookie e identidad siguen siendo las mismas y el rol continúa vigente. La denegación procede del permiso actual, no de una sesión expirada. | HTTP + BD |
| AUTHZ-04 | Retirar clubs:READ de SUPERADMIN. Mismo actor también tiene SECRETARY vigente con clubs:READ en liga A. Consultar recurso de liga A. | El guard permite por la asignación SECRETARY. Retirar esa segunda vía provoca denegación. No inventar users:CREATE para SECRETARY. | Guard real |
| AUTHZ-05 | Delegado de club A1 y liga A, con clubs:READ/UPDATE. Consultar/editar A1 y luego sustituir solo el identificador por A2, club distinto de la misma liga. | A1 permitido y A2 denegado; sin lectura privada ni modificación de A2. Usar el guard y servicios reales; HTTP solo si existe esa ruta. | Guard / servicio existente |
| AUTHZ-06 | Repetir con B1 de liga B. Incluir combinaciones manipuladas liga A + club B1 y liga B + club A1. | Denegación por relación real; no aceptar el contexto declarado por el cliente. | Guard / servicio existente |
| AUTHZ-07 | Actor con rol que concede clubs:UPDATE solo en liga A y otro rol de solo READ en liga B. Intentar UPDATE de B1. | Denegación: no combinar el permiso de una asignación con el contexto de otra. UPDATE de A1 sirve de control positivo. | Guard real |
| AUTHZ-08 | Asignación futura; después asignación vencida. Probar también starts_at=ahora, ends_at=ahora y ends_at=null con reloj controlado del mecanismo real. | Futura/vencida no autorizan; inicio inclusivo, fin exclusivo, sin fin vigente si las demás condiciones se cumplen. Si no hay reloj inyectable, registrar esa cobertura de borde como pendiente, sin sleeps. | Guard real |
| AUTHZ-09 | GET y POST válidos sin cookie. Después repetir con sesión operativa sin permiso. | 401 UNAUTHENTICATED frente a 403 FORBIDDEN, respectivamente; sin escrituras ni datos privados. No confundir cuenta restringida con ausencia de permiso. | HTTP existente |
| AUTHZ-10 | Retirar solo users:READ y conservar users:CREATE; después invertir la configuración. Probar GET y POST por separado. | Cada operación consulta su permiso específico. Una escritura no concede lectura ni viceversa. GET 403/POST 201 y GET 200/POST 403 si PDGLD-54 mantiene ese contrato. | HTTP existente |
| AUTHZ-11 | Actor sin users:CREATE envía SUPERADMIN, actorId o identidad ajena en el cuerpo. Actor autorizado intenta contexto liga/club inconsistente o un alcance superior al autorizado. | Ningún campo del cliente cambia la autoridad del actor. Rechazo controlado por esquema o autorización, cero elevación y cero escrituras parciales. Probar una petición válida sin permiso para exigir 403 sin interferencia de validación. | HTTP existente |
| AUTHZ-12 | Usuario sin autoridad de administración intenta modificar concesiones usando la operación real de PDGLD-54. | Denegación; permisos efectivos sin cambios. Comprobar el permiso específico de administración acordado; no inferirlo únicamente por SUPERADMIN. | Administración real |
| AUTHZ-13 | Administrador autorizado retira una concesión usando el servicio/endpoint real. Consultar BD y repetir operación con la sesión afectada. | Cambio efectivo y auditoría con actor, objeto afectado, antes/después, motivo y tiempo; sin secretos. No duplicar eventos que ya generen triggers. | Administración + auditoría |
| AUTHZ-14 | En base nueva ejecutar seed demo real, retirar concesión legítimamente y repetir exactamente el mismo seed. | La concesión continúa ausente, el rol permanece y la petición continúa denegada. Tampoco se sobrescribe context_only administrado. El test no implementa un seed alternativo. | Instalador real |
| AUTHZ-15 | Asignación acotada con context_only=false. Intentar recurso fuera de su liga/club. | No obtiene alcance global por falta de asterisco. | Guard real |
| AUTHZ-16 | Jugador consulta registro propio y ajeno del mismo club; árbitro consulta partido designado y no designado. | Propio/designado permitido con concesión; ajeno/no designado denegado. Usar relaciones reales del esquema. | Guard real; HTTP solo si existe |

AUTHZ-01/02 también deben cubrir users:READ como permiso ausente. En AUTHZ-03
capturar asignación, versión, sesión y configuración antes/después; usar una
copia de las cookies para descartar una renovación accidental como explicación.
Las pruebas no deben ejecutarse en paralelo sobre concesiones compartidas.

## Separación de funciones y notas

- El cambio administrativo no introduce un bypass SUPERADMIN.
- READ/UPDATE/APPROVE/PUBLISH son acciones distintas: no derivar un CRUD completo.
- R A (bajas), P (revisa), C (castigados), C (propone) y R U [PV] conservan
  su significado particular; la asignación plana no autoriza toda operación.
- La interpretación técnica del PR #12 sobre grupos mixtos C* R, C U* y C R*
  no convierte las letras sin marca en permisos globales.
- Conservar las reglas documentadas de autor distinto del aprobador/publicador,
  correcciones de cédulas confirmadas y prohibición de elevar a capturista a
  resolución de sanciones. Cubrirlas sobre operaciones existentes; si faltan,
  documentar cobertura pendiente sin construir endpoints para la prueba.
- Los estados que constituyen designación efectiva de árbitro, la lectura de
  canchas compartidas y el alcance de [PV] requieren el contrato concreto
  señalado en PDGLD-55. No inventar expectativas aprobadas para esas variantes.

## Fixtures requeridos

Datos sintéticos, identificadores aleatorios por ejecución y contraseñas
generadas que no se imprimen. No reutilizar las cuentas habituales de seed:dev.

| Fixture | Requisito y finalidad |
| --- | --- |
| Ligas A/B | Dos ligas reales distintas y activas para aislamiento cruzado. |
| Clubes A1/A2/B1 | A1 y A2 en A, B1 en B. Deben existir antes de mutar identificadores. |
| Administrador de control | Cuenta operativa con autoridad real para administrar concesiones. Se mantiene separada del actor cuyo permiso se retira. |
| SUPERADMIN bajo prueba | Rol vigente conservado durante la retirada; sesión y versión observables. Sin otros roles que oculten la retirada, excepto AUTHZ-04. |
| SECRETARY y multirrol | Una vía legítima de clubs:READ en A; escenario adicional con UPDATE en A y READ en B. |
| Delegado | user_roles vinculado a A1/A. Sin permisos de creación de cuentas. |
| Temporalidades | Asignaciones vigente, futura y vencida; límites exactos solo con reloj controlable del guard real. |
| Jugadores propio/ajeno | Dos personas/inscripciones del mismo club para impedir que coincidir en club abra datos personales. |
| Árbitro y partidos | Persona/árbitro enlazados y dos partidos con relaciones completas; designación efectiva para uno según contrato. Crear solo lo requerido para ejercitar políticas reales. |
| Permisos iniciales | Catálogo real de Sergio aplicado por el instalador real; expectativas declaradas independientemente en los tests. |
| Auditoría | Capturar IDs previos y eventos nuevos de la operación; comparar actor/antes/después sin registrar datos personales ni claves. |

Crear relaciones y dependencias con las restricciones y los triggers vigentes.
Configurar app.user_id/app.reason con alcance transaccional donde el esquema
lo exija. No desactivar triggers, RLS ni restricciones para cargar fixtures.

## Seguridad, aislamiento y limpieza

El runner compartido es dueño de crear y destruir la base local temporal.
Verificar loopback y la marca/nombre de base desechable que ese runner entregue,
antes de cualquier escritura. No aceptar DATABASE_URL de una base habitual
como prueba de aislamiento. No inventar una marca incompatible con el runner.

La suite crea solo sus fixtures, registra sus IDs y utiliza credenciales de
prueba. No hace TRUNCATE, borrados masivos por tabla, resets ni conexiones a
Supabase. Si debe limpiar filas, limitarse a IDs propios y al orden permitido
por FK; no borrar auditoría inmutable. La destrucción final de la base pertenece
al runner que demuestre haberla creado.

Las retiradas de role_permissions afectan una configuración compartida: ejecutar
secuencialmente en una base exclusiva, restaurar lo necesario para casos
posteriores con motivo/auditoría y no alterar concesiones ajenas al caso. Si una
prueba falla, el finally no debe esconder el fallo ni debilitar las guardas.

## Integración con el runner existente

Archivos entregados:
- tests/integration/authorization-independent.test.ts
- tests/integration/authorization-http.test.ts

Comando: npm run test:authorization

El runner existente detecta authorization-*.test.ts y los ejecuta
secuencialmente con PostgreSQL temporal y condiciones react-server.

La prueba HTTP reutiliza Browser de auth.test.mjs.
No se modificaron package.json, workflows, scripts compartidos,
el motor ni la suite de cuentas.

## Resultado y reporte de defectos

Ejecutado:
- Dos pruebas independientes: aislamiento de clubes y autorización HTTP.
- Suites existentes de catálogo, motor, administración y cuentas.
- Suite existente de seed demo, incluida conservación de revocaciones.
- TypeScript y ESLint.

Los resultados compartidos no reportaron fallos.

Límites:
- Las pruebas independientes comprueban READ de clubes y GET de cuentas.
- POST, administración, roles múltiples, vigencias y seed se respaldan
  con las suites existentes ejecutadas.
- Los 16 escenarios de este documento son más detallados que la
  cobertura ejecutada: no se consideran todos aprobados íntegramente.
- Quedan pendientes los límites temporales exactos con reloj controlado,
  la comparación explícita de cookies/identificador interno de sesión
  y cualquier variante sin evidencia concreta.
- No se declara terminada toda HU22-02.

Para cada fallo reproducible registrar: ID del escenario, SHA del motor y
catálogo, fixture/relaciones anonimizadas, preparación, petición u operación,
estado y resultado esperados, resultado real, efectos observados en BD y
evidencia sin cookies ni secretos. Reportar a Víctor sin cambiar su motor.
Una dependencia ausente o un endpoint futuro no se reporta como test aprobado
ni como vulnerabilidad ya demostrada.
## Ejecución inicial de las pruebas existentes

Comando: npm run test:authorization
Fecha: 18 de octubre de 2026

Resultados observados:
- Resumen del motor: 12 pruebas aprobadas, 0 fallidas.
- Resumen de catálogo, administración y cuentas:
  34 pruebas aprobadas, 0 fallidas.
- Sin cancelaciones ni pruebas omitidas.
- Aviso MODULE_TYPELESS_PACKAGE_JSON sin impedir la ejecución.

Esta ejecución corresponde a las pruebas existentes de PDGLD-54
y cuentas. No sustituye las pruebas independientes de PDGLD-56.

Pendiente:
- Relacionar los escenarios de aceptación con la cobertura existente.
- Añadir y ejecutar la validación independiente de PDGLD-56.
- Verificar que repetir el seed demo conserve permisos retirados.
## Estado actual

Se ejecutaron las suites existentes de autorización y seed demo,
y las dos pruebas independientes de PDGLD-56, sin fallos reportados.
TypeScript y ESLint también aprobaron.
La entrega queda pendiente de revisión del equipo.