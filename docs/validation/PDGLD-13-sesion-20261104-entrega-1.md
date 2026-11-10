# PDGLD-13/14 — primera entrega de la sesión del 04/11/2026

Diagnóstico y decisiones: [participaciones por categoría](../architecture/player-category-participations.md).
Esta entrega termina en backend y HTTP. La política documental se revisará en la
entrega 2 y la integración de pantallas en la 3, después de la revisión de Víctor.

Se conservan los cambios y commits anteriores de la rama, incluido `7ac9125`, y
todo el trabajo sin commit de documentos/cámara/firmas. No se hicieron commits,
push, merge, despliegues ni cambios de Jira. La migración
`20261104020000_pdgld13_category_participations` es nueva y aditiva. No elimina ni
cambia `unique_player_per_season` ni las migraciones compartidas. No configura
edades, familias o jerarquías reales. Se aplica solo a bases temporales del runner.

## Comprobar automáticamente

Comprobación local realizada en PostgreSQL 15 aislado: **35/35** en la regresión
de jugadores/documentos y **7/7** en el perfil HTTP de esta entrega, incluido el
modo de revisión con manifiesto privado. Comprueba también que una baja no permite
reinscribir al jugador en una categoría inferior de la misma familia/torneo.
El reloj del servicio y trigger se sustituye solo en la base sintética para
comprobar lunes/sábado; no hay un parámetro HTTP de reloj ni una excepción en
producción. Migraciones y Prisma coinciden, sin diferencias detectadas.

Preview: **126 aprobadas, 2 omisiones preexistentes del perfil, cero fallos**;
se verificó el plan limitado y los recorridos existentes. Los nuevos contratos
HTTP se validaron con conexión propietaria local y RBAC de aplicación; no se
declara una prueba de esos contratos contra Supabase. Controles de planes de
producción/privilegios: **13/13**; el plan real continúa rechazando la migración
nueva para despliegue hasta su revisión de seguridad. Los fixtures positivos de
planes históricos se conservaron separados y se añadió el rechazo explícito de
esta migración, sin autorizarla en production-plans.mjs. Tipos, lint y conservación
de migraciones compartidas comprobados. Sin llamadas reales a CURP/INE o Storage.

Con Docker/PostgreSQL local disponible:

```powershell
npm run test:player-participations
```

El runner valida loopback, crea `pdgld48_test_<aleatorio>`, aplica migraciones,
comprueba correspondencia con Prisma y arranca Next aislado en un puerto libre.
Las credenciales de proveedor están vacías y AUTH_TEST_RUN bloquea el transporte
real. Comprueba sesión, origen, permisos, contratos y respuestas HTTP además de
los servicios. Al terminar elimina solo su base y servidor. No tocará la base
habitual, Supabase ni el puerto 3000.

Casos cubiertos: identidad de presidente reutilizada sin otra Persona/cuenta;
CURP exacta no duplicada ni nueva solicitud pendiente; familia explícita, tipos
compatibles y versión; superior consecutiva, inferior e igual rechazadas, salto
directo rechazado; mismo club/torneo; reenvíos con claves iguales/distintas y
carreras; conservación de origen, unicidad/auditoría; edad/política pendiente;
revisión de identidad; sanción vigente; lunes–miércoles; documentos todavía
pendientes sin habilitación; acceso anónimo/club ajeno/origen falso/campos de
autoridad; nuevas tablas privadas frente a roles API en Supabase **simulado**.

Para toda la regresión previa con servicios de identidad y Storage simulados:

```powershell
npm run test:player-registrations
```

Ejecutar estas suites y `test:preview-runtime` en serie: los roles ficticios de
PostgreSQL del harness son globales al clúster. No lanzar en paralelo ni contra
una instancia que tenga esos roles ajenos. No usar verify:player-document-storage,
que es una comprobación histórica de Storage real y no corresponde a esta entrega.

## Revisar los contratos manualmente, sin pantallas nuevas

En una terminal:

```powershell
$env:PLAYER_PARTICIPATIONS_KEEP_SERVER = '1'
npm run test:player-participations
```

Después de pasar las pruebas, conserva Next y la base temporal. Imprime la ruta
de un JSON privado de TEMP con cuentas sintéticas, contraseña e identificadores.
No publicar ni versionar ese archivo. No son tus cuentas de la base habitual.

En otra terminal, reemplaza únicamente la ruta por la que imprimió el runner:

```powershell
$fixture = Get-Content -LiteralPath 'RUTA-DEL-JSON-PRIVADO' -Raw | ConvertFrom-Json
$account = $fixture.accounts | Where-Object kind -eq 'delegate'
$csrf = Invoke-RestMethod ($fixture.baseUrl + '/api/auth/csrf') -SessionVariable reviewSession
Invoke-WebRequest ($fixture.baseUrl + '/api/auth/callback/credentials') -Method Post -WebSession $reviewSession -ContentType 'application/x-www-form-urlencoded' -Body @{
  csrfToken = $csrf.csrfToken
  email = $account.email
  password = $account.password
  json = 'true'
  callbackUrl = $fixture.baseUrl + '/players/registrations'
} | Out-Null
$endpoint = $fixture.baseUrl + '/api/player-registrations/' + $fixture.originRegistrationId + '/category-participations'
$intent = @{
  operationKey = [guid]::NewGuid().ToString()
  targetSeasonTeamId = $fixture.targetSeasonTeamId
  reason = 'Revisión sintética de participación superior por Víctor'
}
$json = $intent | ConvertTo-Json -Compress
Invoke-RestMethod $endpoint -Method Post -WebSession $reviewSession -Headers @{ Origin = $fixture.baseUrl } -ContentType 'application/json' -Body $json
Invoke-RestMethod $endpoint -Method Post -WebSession $reviewSession -Headers @{ Origin = $fixture.baseUrl } -ContentType 'application/json' -Body $json
Invoke-RestMethod $endpoint -WebSession $reviewSession
```

Esperado: primer acuse pendiente de habilitación, segundo mismo id con replayed
true, GET con una sola participación y sportsEligible=false. No se crea otra
inscripción ni se aprueban documentos. Un nuevo operationKey con el mismo resto
del cuerpo recupera la misma participación. No reutilices una clave cambiando
destino o motivo: debe dar conflicto.

Para probar el salto prohibido, usa el mismo origen y un nuevo operationKey con
targetSeasonTeamId tomado de skipSeasonTeamId, conservando el cuerpo estricto:
debe rechazar SUPERIOR_CATEGORY_REQUIRED y el listado seguirá con una sola fila.
Ese destino es un nivel más alto sin escalón intermedio, no una promoción del
origen por haber solicitado la primera participación. Con originSeasonTeamId
como destino debe rechazar también la categoría igual.

La prueba automática cubre el caso inverso (origen de nivel 2 → nivel 1), otro
club, permisos y sanciones; no se agregaron pantallas para fabricarlos manualmente.
Para consultar la jerarquía, GET
`/api/competitions/seasons/{seasonId}/player-pathways`; el delegado solo la lee,
no la configura. La cuenta admin del fixture puede reenviar su definición
`pathway` con Origin correcto y recuperar el resultado sin duplicar niveles.

Enter o Ctrl+C en la primera terminal detiene únicamente este servidor y elimina
la base temporal. El archivo privado conserva solo datos sintéticos de revisión;
no subas documentos personales a este perfil. No hay APIs reales habilitadas.

## Pendiente de las siguientes revisiones

- Entrega 2: política documental por categoría/torneo, comprobantes de nacimiento
  admitidos, identificación configurable opcional y habilitación que respete todos
  los requisitos vigentes. INE + selfie disponible no equivale a obligatorio.
- Edad de Veteranos 35/37 y firma de adultos siguen sin decisión; no se alteraron.
- Entrega 3: pantallas/recorrido y consumo de participaciones; la pantalla actual
  de registrar origen no se convierte en otra alta para simular la participación.
- Consulta de responsables y reglas de árbitros están fuera de estas historias.
