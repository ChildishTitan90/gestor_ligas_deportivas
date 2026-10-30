# PDGLD-107 — Alta de representantes con cargo explícito

Implementación sobre la rama de PDGLD-106, sin reescribir sus migraciones ni alterar
facultades del subdelegado, propiedad de solicitudes o acceso a firmas. La evidencia
SQL 15/17 de PDGLD-106 sigue siendo válida para el modelo. La ampliación HTTP/SSR
de esta entrega ya aprobó en 15/17 en el entorno autorizado; véase la
[evidencia HTTP/SSR](../validation/account-delegate-http-isolated.md).

## Formulario y contrato

`/accounts/new` conserva AccountForm, controles/estilos y reglas de sesión existentes.
CLUB_DELEGATE muestra un selector requerido, inicialmente vacío, de Titular (PRIMARY)
y Subdelegado (DEPUTY). Nunca se selecciona el único cargo libre automáticamente.
Cambiar liga, club, perfil o periodo descarta el cargo seleccionado y las opciones
anteriores; se abortan/ignoran respuestas tardías. El envío permanece bloqueado
hasta disponer de opciones vigentes y una selección explícita.

El formulario envía `delegatePosition` en la raíz de POST /api/accounts, como en
PDGLD-106. Para consultar y crear sobre el periodo elegido añade opcionalmente:

```json
{
  "delegatePosition": "DEPUTY",
  "delegatePeriod": {
    "startsAt": "2035-01-01T18:00:00.000Z",
    "endsAt": "2035-02-01T18:00:00.000Z"
  }
}
```

Son campos adicionales al resto del contrato de cuenta, persona, roles, liga y
club. delegatePeriod solo se admite con CLUB_DELEGATE. endsAt admite NULL; si es
finito debe ser posterior al inicio. Los instantes deben incluir zona horaria y
se normalizan a Date antes de consultar/escribir. Las fechas datetime-local se
capturan en la hora local del dispositivo, indicado junto a los campos, y se envían
en UTC. La interfaz permite inicio explícito y fin opcional. Si se omite todo el
periodo, se mantiene el alta desde ahora y sin fin del contrato anterior.

Solo la asignación de CLUB_DELEGATE recibe esas fechas: otros perfiles combinados
conservan su semántica existente. No se abre una edición/reemplazo de asignaciones
existentes ni se modifica historial. La autoridad permanente exigida actualmente
por assertCanGrantRole sigue exigiéndose aunque el nuevo periodo sea finito.

## Opciones autorizadas

GET /api/accounts/delegate-options acepta:

- leagueId UUID.
- clubKind=existing y clubId UUID; o clubKind=new, sin adoptar un club existente.
- startsAt ISO y endsAt ISO opcional; sin ambos, consulta desde el reloj del servidor
  y con fin abierto. Un fin aislado sin inicio se rechaza.

Devuelve únicamente el periodo consultado y dos opciones con value, label,
available y reason (OCCUPIED, LEGACY o NULL). No devuelve personas, cuentas,
documentos ni identidades de ocupantes. No modifica ni reserva cupos.

El servidor obtiene la identidad operativa y exige users READ, CREATE y capacidad
de conceder CLUB_DELEGATE (users UPDATE y cobertura/aprobación existentes) en el
ámbito real. Para club nuevo exige además clubs CREATE en la liga. Las relaciones,
actividad de club/liga y coherencia del ámbito se verifican por el motor actual.
Las opciones y el endpoint no aceptan rol o autoridad desde el navegador.

La consulta filtra por club/perfil reales y solapamiento tstzrange [inicio, fin).
Un legado ambiguo bloquea ambos cargos para ese periodo; no se infiere cuál ocupa.
Un cargo conocido bloquea solo su posición. Las restricciones PostgreSQL siguen
siendo la autoridad final: se puede perder una carrera aunque una opción estuviera
libre al consultarla. Todas las respuestas son private, no-store.

POST mantiene autorización y transacción existentes; persiste el periodo explícito
solo para el delegado. Ante DELEGATE_POSITION_OCCUPIED, DELEGATE_ACCOUNT_OVERLAP o
DELEGATE_LEGACY_OVERLAP se muestra el mensaje de dominio, se limpia la selección
y se recarga disponibilidad sin promover ni sustituir un cargo. Los errores quedan
asociados al selector. La contraseña continúa limpiándose tras cada envío y no se
reintenta una creación automáticamente.

## Presentación y navegación PDGLD-110

readAccountPresentation consulta roleCode y delegate_position guardados. El DTO de
cuenta propia y el encabezado/menu existentes presentan Titular/Subdelegado junto
al perfil; NULL muestra «Cargo no identificado». Otros perfiles mantienen sus
etiquetas. No se reconstruye un cargo a partir de vigencia, orden o actividad.
Las lecturas mantienen validación de ámbitos y vigencia actuales; los datos de
presentación no participan en la autorización.

La conexión con PDGLD-110 conserva estos puntos, sin crear otro panel ni cambiar
rutas o facultades:

- CreateAccountLink autorizado del panel /access → /accounts/new.
- Retorno «Volver al panel» → /access.
- AccountHeader/AccountMenu compartidos y sus destinos /access y /futbol.
- Estados de sesión/cambio de contraseña y de acceso denegado actuales.

PDGLD-110 puede consumir esos puntos de navegación y el DTO existente de cuenta;
no debe deducir permisos del cargo ni depender de texto para autorizar. Esta es la
coordinación de contratos/rutas en código, no una afirmación de revisión humana o
cierre del ticket PDGLD-110. Véase la [decisión visual](../design/account-delegate-position.md).

## Preview y pruebas

Crear un periodo finito necesita INSERT sobre ends_at además de las columnas de
PDGLD-106. Se añade únicamente esa columna a la lista permitida de Preview, con
prueba pura de lista cerrada; no se añade UPDATE, DELETE ni facultad de negocio.
Durante la implementación inicial no se aprovisionó Preview. El 30 de octubre
se verificó el runtime limitado/RLS exclusivamente en PostgreSQL desechable 15/17;
no se modificó Supabase real.

Pruebas sin base: selector vacío/accesible, carga/error/sin cupos, legados, DTO real,
validación/envío de periodos, ausencia de PII en la consulta, respuestas tardías y
revocación/error de opciones. Comandos: test:account-form, test:ci, typecheck, lint.

## Alta HTTP/SSR aislada: ejecutada y aprobada en 15/17

Se amplía el supervisor separado con --account-integration; el modo SQL por defecto
de PDGLD-106 y scripts/test-auth.mjs conservan su comportamiento. Nuevo alias:

```sh
# Solo plan, sin Docker ni SQL:
npm run test:account-isolated -- --run-id c3d52110-9e44-4472-aebc-500a02f72a12

# Ejecución ya autorizada y completada para este identificador:
npm run test:account-isolated -- --execute --run-id c3d52110-9e44-4472-aebc-500a02f72a12
```

Para ese identificador:

| Versión | PostgreSQL | Next HTTP | Base padre | Base de aplicación temporal |
| --- | --- | --- | --- | --- |
| 15 | 127.0.0.1:55415 | 127.0.0.1:56515 | pdgld48_test_c3d521109e444415 | pdgld106_model_c3d521109e444415 |
| 17 | 127.0.0.1:55417 | 127.0.0.1:56517 | pdgld48_test_c3d521109e444417 | pdgld106_model_c3d521109e444417 |

Usa el socket Docker local y las imágenes postgres:15-bookworm y postgres:17-bookworm
(mismo aislamiento/nombres pdgld106-<run-id>-pg15/17 y redes -net). Cada versión es
secuencial y debe aprobar/limpiarse antes de la siguiente. Puede descargar imágenes
faltantes. No monta volúmenes del proyecto: PostgreSQL permanece en tmpfs.

El hijo aplica SQL exclusivamente en la base temporal, crea fixtures sintéticos,
instala allí las concesiones reales del catálogo y prepara un legado antes de
PDGLD-106, sin tocar legados reales. No invoca CLI seeds ni usa bases de desarrollo.

Next arranca con --webpack desde una copia privada de src/public/prisma y archivos
explícitos de configuración. Se excluyen .env y variantes, .git, compose.yml y
prisma.config.ts; se rechazan symlinks de origen. Solo node_modules se reutiliza
por symlink hacia las dependencias ya instaladas. La copia contiene sus propios
artefactos .next-auth-tests. No instala paquetes ni modifica las fuentes originales.
El layout conservado usa next/font/google y puede solicitar esas fuentes durante
la compilación de desarrollo. Este recorrido valida HTTP/SSR, no estilos compilados
ni interacción gráfica en un navegador automatizado.

El entorno del hijo se construye explícitamente, sin cargar .env ni heredar
conexiones/PG*/NODE_OPTIONS. Credenciales efímeras viajan por IPC. La suite verifica
login real, opciones autorizadas, altas PRIMARY/DEPUTY, cambio obligatorio de clave,
presentación real y de legado, cupos, periodos contiguos, rollback de conflictos y
revocación con la misma sesión. Este recorrido aprobó en ambas versiones;
no sustituye una revisión visual o un recorrido gráfico del formulario.

La copia está predeterminada en /private/tmp/pdgld106-<run-id>/app-pg15/17, bajo el
registro exclusivo de ejecución. Se detiene/espera Next, se eliminan bases y copia,
y el supervisor retira solo contenedor/red propios. Al cancelar concede hasta
15 segundos al hijo para detener Next antes de forzarlo; cada versión tiene límite
de 600 segundos. La recuperación --cleanup del registro también elimina únicamente
esas copias si la suite registrada es HTTP/SSR. Se mantienen metadatos sin secretos
e imágenes en caché. No se usa gestor_ligas_dev, .env o compose.yml.

## Evidencia actual, 30 de octubre de 2026

Navegador y Preview/RLS temporal aprobaron en 15/17 con node_modules propio por
copia, npm ci y Turbopack; se reutiliza account-independent-dependencies.mjs.
Se verificó limpieza y se archivaron los originales privadamente. Los perfiles
HTTP históricos descritos arriba conservan su procedencia; no se presenta su
arranque Webpack/enlace como configuración de los perfiles nuevos.

La [matriz por criterio](../validation/account-delegate-acceptance-matrix.md)
identifica aserciones y brechas: este endpoint sigue siendo de alta, no implementa
reemplazo/baja ni consulta de historial, y no amplía facultades de subdelegado o
propiedad de solicitudes y firmas.
