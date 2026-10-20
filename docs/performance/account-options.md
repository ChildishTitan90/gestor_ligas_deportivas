# PDGLD-54: rendimiento de opciones de cuentas

Medición del 19/10/2026 para PR #13. Cabeza remota inspeccionada:
`e1765270d6dda5b8883fb26a834dbfb601a28278`, base `develop`.
El PR #10 ya estaba fusionado en `65a445cad980c06889a53227c82141b761819c38`;
se incorporó mediante merge local sin commit antes de medir. El merge no tuvo
conflictos y conserva sus correcciones de monitor y sus regresiones de sesiones.

## Entorno y método

- Windows, Node.js 24.9.0, Next.js 16.4.0, Prisma/adapter-pg 7.10.0, PostgreSQL 15.
- `next dev`, loopback, contenedor PostgreSQL independiente con tmpfs, sin
  volúmenes persistentes. Cada ejecución del harness creó y eliminó su propia
  base `pdgld48_test_<aleatorio>`. Se detuvieron los servidores y contenedores.
- Perfil demo y catálogo RF22 real: 127 concesiones, 9 roles administrativos
  candidatos y 120 concesiones entre esos candidatos. GET con liga DEMO elegida,
  dos clubes y administrador global con permisos explícitos.
- Una primera petición después de reiniciar Next (pool y proceso fríos) y tres
  peticiones secuenciales adicionales. La cookie sintética se obtuvo antes del
  reinicio. La primera petición también incluye carga/compilación de la ruta;
  no representa un build limpio ni el tiempo exclusivo de abrir PostgreSQL.
  La caché de compilación en disco se conserva. Las comparaciones principales
  usan las tres peticiones con el pool preparado, no el arranque de desarrollo.
- HTTP medido desde el cliente hasta consumir el JSON. El preload de pruebas
  mide llamadas SQL reales del driver, duración acumulada, adquisición del pool,
  conexión nueva, inicio/cuerpo/final de las transacciones y sus opciones efectivas.
  No registra SQL, parámetros, filas, UUID, cookies, contraseñas ni conexiones.
- Un observador consulta `pg_stat_activity` aproximadamente cada 10 ms, usando
  otra conexión de la misma base desechable. Sus consultas quedan fuera del
  conteo del GET. No se observaron muestras `wait_event_type='Lock'`; esto no
  descarta esperas menores que la resolución del muestreo. No hubo carga externa
  ni bloqueo artificial durante las mediciones.

Las duraciones SQL son tiempos del driver que incluyen transporte/cola/servidor;
no son CPU SQL ni `EXPLAIN ANALYZE`. La espera del pool incluye la conexión nueva
cuando corresponde. El tiempo de iniciar la transacción incluye adquirir conexión,
BEGIN e inicialización de Prisma; esas métricas se solapan y no deben sumarse.
La instrumentación modifica prototipos del runtime instalado **solo** mediante
preload de prueba, con guardas de entorno y base local temporal. Una actualización
de Prisma requiere revisar esa instrumentación; no se carga en la aplicación normal.

Datos completos, tiempos individuales y resúmenes calculados:
[account-options-measurements.json](account-options-measurements.json).

## Consultas reales y origen de la repetición

| Parte | Antes | Después |
| --- | ---: | ---: |
| Cuerpo de transacción de opciones, sin BEGIN/COMMIT | 493 | 7 |
| Transacción de opciones con BEGIN/COMMIT | 495 | 9 |
| Transacción de sesión con BEGIN/COMMIT | 5 | 5 |
| GET completo | 500 | 14 |

La simulación de 493 coincidió con el cuerpo de esta transacción local real.
No representa por sí misma latencia ni consultas observadas en Supabase.

Antes, las llamadas a `assertAccountAdministrator → assertPermission` y
`assertCanGrantRole → getPermissionGrants` repetían 146 veces cada una de estas
tres sentencias: bloqueo de política, cuenta operativa y concesiones del actor.
Además había 32 resoluciones de liga, 9 lecturas de permisos candidatos, 9
verificaciones de existencia de rol y las consultas iniciales de opciones y
límites de transacción. El motor repetía la autorización por cada permiso de
cada candidato, aunque el actor, la política y la liga fueran los mismos.

El crecimiento anterior dependía de candidatos × contextos intentados × permisos
del candidato, con salida temprana cuando encontraba una vía válida. Por ejemplo,
la falta de CREATE obligaba a repetir guard y contexto en cada intento aunque
ningún candidato pudiera prosperar. No era correcto fijar 493 como constante
para todos los actores o peticiones.

Ahora las 7 sentencias del cuerpo son: bloqueo compartido, cuenta operativa,
concesiones vigentes del actor, ligas activas autorizadas, clubes de la liga,
roles candidatos y todos sus permisos. Una asignación limitada a club necesita
una lectura agrupada adicional de sus clubes; sin liga elegida se omite la lectura
del listado de clubes. Las opciones válidas usan como máximo 10 sentencias con
BEGIN/COMMIT en los escenarios de regresión, independientemente de las
concesiones y contextos adicionales. El volumen de filas, el trabajo en memoria
y el tamaño de respuesta sí pueden crecer; no se afirma coste constante total.

## Tiempos individuales (ms)

`Tx` incluye inicio y commit de la transacción de opciones. `SQL GET` es la suma
de duraciones de las sentencias de las dos transacciones. El JSON contiene además
el tiempo de cuerpo y espera inicial de cada transacción y las muestras de bloqueo.

| Versión / petición | HTTP | Tx opciones | SQL GET | Adquisición pool | Conexión nueva |
| --- | ---: | ---: | ---: | ---: | ---: |
| Antes / primera | 3210.283 | 1947.635 | 1415.828 | 23.573 | 18.409 |
| Antes / preparada 1 | 1064.359 | 1004.639 | 756.004 | 0.503 | 0 |
| Antes / preparada 2 | 916.397 | 861.255 | 645.925 | 0.388 | 0 |
| Antes / preparada 3 | 1277.836 | 1232.492 | 944.744 | 0.440 | 0 |
| Después / primera | 744.188 | 49.110 | 56.052 | 33.178 | 29.201 |
| Después / preparada 1 | 72.070 | 18.792 | 18.479 | 0.427 | 0 |
| Después / preparada 2 | 77.100 | 14.907 | 14.657 | 0.417 | 0 |
| Después / preparada 3 | 70.137 | 23.119 | 22.029 | 0.438 | 0 |

| Resumen del pool preparado | Antes: mediana / máximo | Después: mediana / máximo |
| --- | ---: | ---: |
| HTTP | 1064.359 / 1277.836 | 72.070 / 77.100 |
| Tx opciones | 1004.639 / 1232.492 | 18.792 / 23.119 |
| SQL GET acumulado | 756.004 / 944.744 | 18.479 / 22.029 |
| Adquisición de pool | 0.440 / 0.503 | 0.427 / 0.438 |

Mediana HTTP local aproximadamente 93.2% menor; 97.2% menos sentencias en el GET.
Con cuatro peticiones por versión no se estima un percentil de producción.
La mediana de las cuatro, incluyendo el primer acceso, fue 1171.0975 ms antes y
74.585 ms después; sus máximos fueron 3210.283 y 744.188 ms.

## Timeout comprobado

`getAccountCreationOptions` no pasa opciones particulares a `$transaction` y
`getPrisma` no configura `transactionOptions`. El runtime instalado y las muestras
de ambas versiones confirman `timeout=5000 ms`, `maxWait=2000 ms`. El adaptador
configura por separado `connectionTimeoutMillis=5000`. No son un único límite
HTTP ni equivalen a un `statement_timeout` de PostgreSQL. No se aumentó ninguno
de esos valores ni se cambió la configuración del pool.

## Conservación de seguridad

La identidad sigue obteniéndose mediante `requireOperationalUser()` antes de la
transacción. `readAccountCreationOptions` acepta únicamente identidad del servidor.
`getActorPermissionGrants` adquiere una vez el mismo bloqueo compartido, valida
cuenta activa/operativa y lee las concesiones con sus vigencias y la misma
asignación/contexto; retiene `FOR SHARE` sobre cuenta, asignaciones, roles,
concesiones y permisos. Las lecturas agrupadas de ligas, clubes y catálogo también
retienen bloqueos de fila hasta terminar. Un escritor de política que respete el
bloqueo exclusivo espera al commit; la siguiente petición ve la política nueva.

Los mapas de concesiones, permisos candidatos y contextos son variables locales
de esa transacción. No hay caché entre peticiones, Redis, permisos en JWT ni
excepción por nombre de rol. Cada vía conserva liga/club de su propia asignación.
CREATE no basta: UPDATE permanente sigue siendo obligatorio para conceder roles.
La misma función `assertRolePermissionCoverage` comprueba tanto opciones como el
guard de escritura: respaldo directo permanente de autoridad administrativa;
APPROVE permanente y del mismo ámbito como alternativa solo para operaciones.
Administrar programación no otorga el derecho a programar.

El contrato HTTP, orden/filtro de opciones, límite de 100 clubes, respuestas
401/403 y 400 para liga inválida se conservan. La entrada traduce el resultado
interno de liga inválida; no envía ese detalle interno como DTO. Las escrituras
siguen revalidando dentro de su propia transacción; mostrar una opción nunca
autoriza por adelantado una futura petición POST.

## Pruebas y reproducción

- Harness completo: **83 resultados**, 63 HTTP y 20 de autorización, cero fallos
  u omisiones. Conserva login, contraseña, cierre, expiración, cuentas y auditoría.
- Nueva suite `authorization-account-options.test.ts`: siete subcasos y su
  contenedor. Compara con los guards de escritura existentes, ámbitos global/
  liga/club, vigencias, autoridad insuficiente, revocación y bloqueo transaccional.
  Añadir 30 permisos a SCHEDULER o 20 ligas no aumenta el conteo SQL. La suite es
  descubierta por `test:auth` y por su paso existente en CI; no se añadió runner.
- Política de sesiones: 6/6. Pipeline: 12/12. ESLint, TypeScript e integridad de
  migraciones correctos. Build de producción correcto fuera del sandbox; dentro,
  Windows denegó el junction de `pg`. No se modifican migraciones ni esquema.

Con PostgreSQL local disponible y `DIRECT_URL` configurada de forma segura:

```powershell
# Crea su propia base desechable; nunca ejecutar contra Supabase.
node scripts/test-auth.mjs --benchmark-options

# Suites normales; descubren también la nueva regresión.
npm run test:auth
```

El benchmark reutiliza migraciones y perfil demo existentes dentro de su base
temporal. El preload se activa únicamente en ese modo y publica solo números.
El contenedor tmpfs usado en esta revisión envolvió el harness existente con
variables de proceso efímeras; no se guardaron sus credenciales ni se modificó `.env`.

## Supabase y conclusión

La configuración efectiva inspeccionada mediante el cargador de entorno de Next
identificó tanto DATABASE_URL como DIRECT_URL como PostgreSQL local, sin abrir
conexiones. No se disponía de una sesión administrativa autorizada de producción
para medir GET. **No se conectó a Supabase ni se midió allí HTTP, transacciones o
SQL.** No se trasladaron cuentas demo ni se ejecutaron operaciones remotas.
TLS, certificados y configuración de conexión permanecen intactos.

El crecimiento innecesario de consultas identificado en PR #13 queda corregido
y verificado localmente. Esto elimina ese riesgo concreto para su integración,
conservando las revisiones de autorización y CI requeridas. Latencia de red,
pool/concurrencia y distribución de datos de Supabase siguen sin medir; estos
resultados locales no certifican un SLA remoto. Tampoco se ejecutaron CI remoto
ni PostgreSQL 17 en esta revisión.
