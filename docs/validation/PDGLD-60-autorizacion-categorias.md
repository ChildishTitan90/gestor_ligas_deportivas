# PDGLD-60 — Autorización explícita de categorías

Fecha: 25/10/2026. Base: `origin/develop` en `425f45e`, que integra los PR #28 y #27.

## Decisión para revisión de Vic y Nick

Sergio confirmó en esta conversación: **selección explícita de categorías
solicitadas**. Secretaría selecciona una o varias, sin selección predeterminada,
y revisa sus nombres en la confirmación. Solo esas permiten inscribir equipos.
Las demás siguen registradas como solicitadas, sin autorización. Esta es una
decisión de implementación para revisión del equipo; no se atribuye una nueva
validación al profesor/Liga ni se deduce habilitación por pago o jugadores.

Si cambia el acuerdo, revisar conjuntamente `affiliationReviewSchema`,
`reviewAffiliation`, modelo/adaptador/controlador y bandeja de revisión, además de
las pruebas HTTP. No cambiar solo la interfaz ni autorizar todo por migración.
La interfaz añadida está en la bandeja existente de PDGLD-61. Nick debe considerar
el contrato actualizado al continuar la interfaz de inscripción PDGLD-63.

## Contrato y conservación

- PATCH `/api/affiliations/{id}/review`: APPROVE añade `authorizedCategoryIds`.
  Correcciones mantiene observaciones y expectedVersion, sin selección.
- GET detalle conserva `categoryIds` y `categories`, y añade `categoryOptions`
  con id, nombre y booleano authorized. No expone credenciales ni claves Storage.
- Se usan las columnas de la migración de Vic; no se crea ni edita migración.
- Autor y fecha proceden del servidor. Se mantienen Secretaría, permiso vigente,
  contexto, separación de funciones, bloqueo de solicitud y expectedVersion.
- Un evento de aprobación registra categorías autorizadas antes/después y actor/
  fecha. Un fallo de auditoría revierte estado, versión y marcas. Una carrera
  produce un ganador y un único conjunto autorizado.
- No cambia la activación de equipos. No se rellenan autorizaciones de afiliaciones
  aprobadas anteriormente; deben seguir bloqueadas si no tienen marcas. Su eventual
  autorización posterior necesita un flujo acordado, sin repetir aprobación ni SQL
  manual para aparentar una validación.

## Comprobaciones

Todas las siguientes comprobaciones pasaron localmente con Node 24.22.1 y las
dependencias del lockfile integrado (Next 16.4.3):

| Comprobación | Resultado |
| --- | --- |
| Revisión/corrección (modelo, adaptador, controlador y renderizado) | 28 pruebas |
| Captura/contratos | 15 pruebas |
| Firmas (proveedor simulado, sin nueva conexión a Storage real) | 42 pruebas |
| Afiliaciones HTTP/PostgreSQL temporal | 27 resultados, incluidos 2 contenedores |
| Inscripción HTTP/PostgreSQL temporal | 17 resultados, incluido contenedor |
| Controles del pipeline | 18 pruebas |
| Lint, typecheck y build | Correctos |
| Guard de migraciones | Migraciones existentes intactas |

La suite de afiliación comprueba selecciones vacías, ausentes, repetidas y de
otra solicitud/temporada; denegación por rol/ámbito/permiso revocado; rollback
de las marcas al fallar la auditoría; y tres aprobaciones simultáneas con
selecciones diferentes: un solo ganador cuyo conjunto coincide con detalle e
historial. En el primer intento una prueba nueva falló por una variable fuera de
ámbito; se corrigió y la suite completa pasó después.

El recorrido de inscripción usa POST real de solicitud, GET detalle, PATCH de
aprobación con una categoría, GET opciones e inscripción REGISTERED por HTTP.
Confirma responsable/fecha, rechaza la otra categoría, conserva el equipo legado
REGISTERED y recupera un reintento sin duplicar. No usa UPDATE para simular esa
aprobación/autorización. Otros escenarios mantienen sus fixtures aislados.

En navegador con datos ficticios y PostgreSQL temporal: casilla inicialmente
vacía; intento sin selección muestra error y lleva el foco a la casilla; selección
con teclado; confirmación muestra el nombre; selección bloqueada durante la
confirmación; cancelar devuelve foco a Aprobar y conserva PENDING; confirmar
presenta aprobación y categoría autorizada. Se cerró el navegador y se detuvo el
servidor de demostración con limpieza de su base temporal. La inscripción positiva
se verificó por HTTP; no se atribuye un recorrido visual de PDGLD-63.

El build local terminó correctamente. Next aún informa que deshabilita
workerThreads en Node 24.22.1 y utiliza childProcesses; en esta ejecución ese
aviso no impidió compilar. No se forzó el modo experimental.

La CI remota y revisión independiente del nuevo cambio requieren su publicación
por PR. No se cambió Jira, no se aplicaron migraciones a la base habitual ni se
modificó Supabase. Las afiliaciones ya aprobadas sin autorización individual
conservan la limitación descrita arriba; este cambio no las autoriza retroactivamente.
