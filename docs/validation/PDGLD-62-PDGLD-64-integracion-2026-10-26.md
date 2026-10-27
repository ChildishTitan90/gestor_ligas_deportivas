# Integración de inscripción — 26/10/2026

## Estado y alcance comprobado

Rama `fix/PDGLD-62-PDGLD-64-integracion-inscripcion`, iniciada limpia en
`b99730c4a7853958b942de0c291f6ed6291de44f`, igual a origin/develop actualizado.
PR #27 (backend de inscripción) y #29 (autorización explícita de Checo) ya
integrados. No fue necesario otro merge ni resolver conflictos.

Se revisaron las referencias de todas las ramas remotas y los heads de PR: no
contienen la entrega visual PDGLD-63. Víctor confirmó que sigue en la computadora
de Nick. No se creó una pantalla equivalente ni se alteró ese trabajo no recibido.

## Cambios para revisión

- Opciones con capabilities del club seleccionado, calculadas con el mismo
  autorizador del POST. CREATE de otra asignación/club o rol no sustituye la
  asignación vigente del delegado. Ambas modalidades conservadas; estado REGISTERED.
- Catálogos READ sin CREATE para clubes/temporadas, incluyendo CLOSED y temporadas
  sin afiliación; paginación por cursores. Listado con seasonName y los nombres ya
  existentes de equipo/categoría/grupo. No depende de aprobación actual para leer.
- GET autorizado por actor/club para recuperar la operación, sin POST silencioso.
  UNRESOLVED conserva incertidumbre; CONFIRMED/CANCELLED son resultados definitivos.
- Cancelación persistente serializada con inscripción/reintentos. Una petición
  tardía no crea tras CANCELLED; si la inscripción ganó, cancelar devuelve CONFIRMED
  y conserva su participación/auditoría. Repetir cancelación no duplica eventos.
- Adaptador del cliente que guarda la captura normalizada antes de enviar, conserva
  cuerpo/clave en reintentos y ante red incierta, distingue abandonar/cancelar y
  separa pendientes por usuario/club/operación. Aún no conectado a las vistas de Nick.
- Migración aditiva de resultados inmutables, recuperación de claves legadas y
  RLS/ACL condicionado al destino. Migraciones compartidas intactas; no se amplió la
  excepción de despliegue a producción. El plan de la tabla nueva necesita revisión.
- Nuevo comando test:team-enrollment-client incorporado al trabajo app del workflow.
  Las nuevas pruebas HTTP/migración entran en test:team-enrollments, ya en la matriz
  PostgreSQL 15/17. No se ejecutó un CI remoto nuevo.

Contrato final, JSON de ejemplo y procedimiento exacto:
[team-enrollment.md](../architecture/team-enrollment.md).

## Entorno de pruebas

Docker Desktop estaba apagado y quedó en arranque del motor. Se usó PostgreSQL 17
ya instalado en Windows con un clúster independiente, loopback 5433, contraseña
aleatoria de prueba y autenticación SCRAM. El runner crea bases desechables con
migrate deploy y compara el esquema con migrate diff. Se generó el cliente Prisma
7.10.1. Se detuvo y eliminó el clúster al terminar. No se tocó gestor_ligas_dev ni
Supabase; ninguna conexión o contraseña se agregó a los artefactos.

La primera regresión en el clúster nativo con zona America/Mexico_City falló en
fechas de sesiones/bloqueo. El adaptador instalado requiere UTC para esos valores:
se observó un desfase de seis horas. Se repitió en un clúster temporal configurado
en UTC, como Docker/CI, y pasó. No se cambió autenticación ni la zona del sistema.

Faltaba el ejecutable local de esbuild 0.28.2: Node tomaba una copia 0.25.10 de
una carpeta superior. Se repuso el paquete oficial exacto del lockfile, sin cambiar
versiones ni el lockfile. El build dentro del sandbox falló al crear un junction de
sharp; la misma compilación fuera del sandbox pasó.

## Resultados locales

| Comprobación | Resultado |
| --- | --- |
| Prisma validate / generate | Correctos, Prisma 7.10.1 |
| migrate deploy + migrate diff en base temporal | Sin diferencias |
| test:team-enrollments | 27 pruebas aprobadas, incluido grupo principal |
| test:team-enrollment-client | 9 aprobadas |
| Componente HTTP de test:auth: node scripts/test-auth.mjs | 93 aprobadas |
| Autorización TypeScript, ejecutada por el mismo runner | 39 aprobadas |
| test:session-policy / test:login-policy | 6 / 3 aprobadas |
| test:affiliation-input / test:affiliation-review | 15 / 28 aprobadas |
| test:signatures | 42 aprobadas; proveedor aislado/simulado |
| test:ci / test:database-config | 19 / 6 aprobadas |
| typecheck / lint | Correctos |
| build Next 16.4.3 | Correcto fuera del sandbox |

La prueba de migración reconstruye el SQL anterior en otra base desechable,
prepara una inscripción legada y una categoría sin autorización, aplica únicamente
la migración nueva y compara registros/auditoría anteriores. Recupera la misma
clave como CONFIRMED, sin inventar autorizaciones ni modificar esas filas.
Esta fixture de migración no se presenta como aprobación real.

## Evidencia funcional y límites

El primer recorrido usa NextAuth y HTTP/PostgreSQL reales: delegado solicita por
POST; se rechaza la inscripción PENDING; Secretaría consulta detalle vigente y
aprueba con authorizedCategoryIds explícitos; delegado inscribe por POST y recibe
REGISTERED. La categoría no elegida se rechaza. Aprobar no activa equipos. Los
metadatos de firmas son fixtures sintéticos y Storage permanece aislado.

La recuperación se prueba descartando deliberadamente el acuse después del commit,
reinicializando el adaptador sobre el almacenamiento conservado y recuperando por
GET con la misma sesión, sin otro POST. Se verifican reintento idéntico, conflicto
de contenido, cancelación concurrente/tardía e invariantes de auditoría.
**Reinicializar el adaptador no equivale a recargar la página real en Chrome.**

No se ejecutó solicitud → aprobación/autorización → inscripción desde las vistas
de PDGLD-63 porque no están disponibles. Tampoco se verificaron aquí sus 55 pruebas,
foco, navegación o accesibilidad, ni se probó carga de firmas contra Storage real.
Se requiere recibir la entrega de Nick, conectar los contratos/adaptador conservando
su UI y ejecutar la [aceptación de navegador](../../tests/integration/team-enrollment-acceptance.md).
**HU01-03 permanece sin aceptación visual completa.**

## Producción y entrega

La tabla nueva revoca PUBLIC y, solo con marcadores completos de Supabase, activa
RLS y revoca los tres roles API. Marcadores parciales abortan; Docker sigue sin RLS.
La simulación de seguridad se ejecuta dentro de una transacción local que revierte
los marcadores/roles. Falta revisar ACL/políticas del rol de servidor en el plan de
producción; el CD rechaza la creación de esta tabla hasta esa revisión.

ACTIVE y la ampliación delegado/subdelegado no se implementaron. No se realizaron
commit, push, merge de PR, despliegues ni cambios en Jira. La preparación es local
para revisión, sin presentar como completada la integración visual pendiente.
