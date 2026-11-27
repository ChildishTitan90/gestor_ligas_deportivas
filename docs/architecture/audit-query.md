# Consulta autorizada de bitácora — PDGLD-91

Referencia: [historia y criterios de aceptación](https://victoranhernandez.atlassian.net/browse/PDGLD-91).

## Base y contrato

La consulta reutiliza audit_logs, los eventos de negocio, los triggers de
inmutabilidad y la autorización compartida. No agrega tablas, migraciones,
eventos duplicados ni escrituras de auditoría por consultar.
La matriz existente concede audit:READ a SUPERADMIN, EXECUTIVE_PRESIDENT y
SECRETARY; el servicio evalúa las concesiones efectivas, no nombres de roles.

Las páginas `/audit` y `/audit/[id]` llaman directamente a la capa de servidor.
`GET /api/audit` y `GET /api/audit/[id]` reutilizan esa misma capa y obtienen
la identidad de la sesión. No aceptan otro actor ni un rol enviado por cliente.
Las API son privadas, sin caché compartida; los métodos de escritura reciben 405.
Los helpers ForActor e InTransaction son exclusivamente de servidor.

## Ámbito comprobable

- Una concesión de liga cubre únicamente sus eventos; una concesión global
  efectiva permite seleccionar ligas o actividad general de cuentas.
- Las concesiones limitadas a un club no se amplían a auditoría general de liga.
- Las cuentas son actividad general: su pertenencia actual o el rol del autor
  no se utilizan para atribuir cambios globales de una persona a una sola liga.
- Cada tipo registrado resuelve su entidad y las relaciones reales hasta la
  liga. Los snapshots que contradigan esa relación se rechazan.
- Para clubes y temporadas se exige también una referencia histórica de liga.
  Si un club/temporada padre tiene transferencias contradictorias registradas,
  se omiten sus eventos dependientes en lugar de reasignar su historia.
- Entidades eliminadas sin relación comprobable, tipos no registrados y
  contexto histórico ambiguo permanecen fuera de la consulta, incluso global.
  No se completa el contexto usando el usuario que produjo el evento.

El registro explícito abarca cuentas, clubes, equipos, ligas, temporadas,
afiliaciones, inscripciones de jugadores, correcciones de identidad, propuestas,
partidos, resultados, expedientes, sanciones, bajas y cargos. No inventa datos
cuando esos módulos aún no emiten eventos. Incorporar otra fuente exige declarar
su relación autorizada y la proyección de campos, no habilitar SQL arbitrario.

Los casos históricos sin contexto no se modifican ni enriquecen automáticamente.
Requieren una regla/evidencia de atribución antes de ampliar la consulta. Por
ejemplo, el registro antiguo de eliminación de un club que no conserva liga
no puede abrirse por pertenencia actual del autor.

## Datos y paginación

La respuesta enumera campos permitidos. No devuelve JSON anterior/posterior,
identidad personal, documentos, contraseñas, hashes, tokens ni conexiones.
El listado ni siquiera recupera los snapshots como columnas de salida SQL.
El detalle proyecta exclusivamente una lista positiva por tipo; objetos y
campos adicionales se omiten. Textos con patrones reservados se sustituyen
por un mensaje de privacidad. Los textos se renderizan como texto, nunca HTML.

El motivo tiene una política más restrictiva: solo se muestran literales exactos
del servidor aprobados en una lista por entidad y acción. Inicialmente incluye
los motivos fijos de alta, revisión y reenvío de afiliación. Cualquier otro motivo,
incluso un texto sin patrones de secretos, se sustituye por «Motivo reservado por
privacidad.». No se intenta detectar nombres o direcciones con una expresión
regular. Añadir una variante exige revisar su procedencia y autorizar el literal;
no se incorporan observaciones ni nombres desde el snapshot.

Las acciones ya emitidas de aprobación, solicitud de correcciones y reenvío de
afiliación tienen etiquetas distintas. Las acciones desconocidas mantienen una
etiqueta neutral sin reflejar el código recibido. Listado y detalle incluyen
`reference`, el UUID completo del registro afectado, distinto del `id` del evento.
Se selecciona de `entity_id` únicamente en las filas que pasan el mismo control
de permiso, contexto histórico y liga. No da acceso a otro módulo ni concede
permisos; no agrega consultas a nombres personales o documentos.

Los filtros son ámbito, tipo de entidad, usuario exacto sin distinguir mayúsculas
y fechas inclusivas en la zona del ámbito. Validación y errores no reflejan
datos privados. La paginación usa 25 registros con orden fecha/id descendente,
microsegundos conservados y cursor ligado al actor/filtros. El cursor no concede
autoridad: todas las peticiones vuelven a comprobar permisos. El límite superior
evita que inserciones recientes desplacen los resultados ya recorridos.

La lista y el detalle se leen en transacciones RepeatableRead. Los bloqueos de
autorización existentes mantienen las concesiones durante la lectura. Una
revocación se respeta en la siguiente petición; no hay una caché de permisos.

## Permisos SQL y validación

Se agregan al plan del backend solamente la lectura de id/case_id de resoluciones,
ruling_id de sanciones y season_team_id de bajas, necesarios para resolver
contexto. No se agregan privilegios de edición o borrado sobre audit_logs.
Los triggers existentes siguen rechazando modificaciones incluso para la
conexión propietaria utilizada en la prueba.

`npm run test:audit` comprueba proyección y filtros. `npm run test:audit:browser`
comprueba el recorrido de interfaz. `npm run test:audit:integration` crea una
base y un rol temporal sobre PostgreSQL local, reconstruye las migraciones y
comprueba permisos, privacidad, paginación con microsegundos, inserciones entre
páginas, contexto contradictorio, revocación, rollback y auditoría única de un
mantenimiento real. Después abre Next con sesiones reales y el rol SQL limitado,
comprueba listados/detalles, 401/403, cabeceras privadas y escritura 405 sin
alterar historial. En Chrome, con esa sesión, recorre las páginas reales de
listado a detalle y de regreso, conservando filtros y el paso actual.
El runner elimina sus bases, roles y procesos de prueba.

Estas pruebas están incorporadas al workflow de aplicación y a la matriz de
PostgreSQL 15/17. La verificación local utilizó ambos motores y datos sintéticos;
Docker conserva RLS desactivado conforme a la configuración del proyecto.
No se consultaron proveedores externos de identidad ni se modificó producción.
La aceptación del equipo y el CI remoto del PR siguen siendo pasos de revisión.

Validación local: TypeScript y ESLint sin errores; dos pruebas puras, cinco
pruebas de regresión de ACL y cuatro pruebas de componentes en Chrome pasaron.
La integración completa con HTTP y navegación real pasó en PostgreSQL 15 y 17
temporales. El YAML del workflow también se analizó correctamente.

Después de integrar `develop` en `b5fa2e6`, volvieron a pasar TypeScript,
ESLint, las dos pruebas puras, las cinco regresiones de ACL y las cuatro
pruebas de interfaz en Chrome. El workflow conserva también las pruebas de
transiciones incorporadas por el equipo. La repetición de la integración
PostgreSQL 15/17 de esta versión quedó pendiente: el motor local de Docker
devolvió un error interno antes de crear las bases. El resultado anterior no
sustituye la ejecución del CI sobre la versión final.

## Correcciones de revisión — 26/11/2026

Se integró `develop` en `373ee72` y se atendieron los tres hallazgos del PR #69:
motivos de lista cerrada por entidad/acción, etiquetas distintas de afiliación
y referencia autorizada del registro afectado. Pasaron TypeScript, ESLint,
cuatro pruebas puras y cuatro recorridos de componentes en Chrome (390/1440 px,
claro/oscuro). También pasó la integración completa HTTP y navegación con
NextAuth y rol SQL limitado en PostgreSQL 15 y 17 temporales.

La prueba de API verifica motivos con nombre y dirección ficticios, observaciones
privadas en snapshots, motivos literales permitidos, las tres acciones de
afiliación y dos registros distintos de partidos, resultados y expedientes.
Comprueba referencias exactas y rechazo por ámbito ajeno, además de conservar
la cobertura de paginación, revocación, inmutabilidad y rollback. Las bases y
procesos temporales se retiraron al finalizar. Las pruebas siguen conectadas
al workflow existente de aplicación y PostgreSQL 15/17.

El CI remoto anterior de `0d50673` pasó bitácora en ambos motores, pero falló en
cédula PG17. No se atribuye ese fallo a `develop` sin reproducirlo; esta corrección
no modifica cédula. Falta ejecutar el CI sobre el nuevo commit y la revisión
del equipo antes de aprobar o cerrar la historia.
