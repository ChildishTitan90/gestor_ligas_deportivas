# PDGLD-60 — Revisión de accesos y seguimiento de afiliaciones

Revisión del 27/10/2026 sobre develop `abe87a1`, incluido PR #33 de despliegue/
Preview. Se conservaron los cambios locales de navegación al actualizar la rama.
Esta revisión cubre las páginas implementadas de acceso, cuentas, afiliaciones e
inscripción; las tarjetas de permisos no significan que todos los módulos tengan UI.

## Flujo confirmado con Sergio

El usuario aclaró que Secretaría aprueba la **afiliación**, antes de que el delegado
inscriba equipos. Secretaría puede pedir correcciones; el solicitante delegado
consulta observaciones, modifica y reenvía con el mismo folio. Inscribir termina
en INSCRITO. No se incorpora una segunda aprobación del equipo ni transición a
ACTIVO: PDGLD-12/PV-02 conservan esa definición de negocio como pendiente.

## Accesos revisados y ajustes

| Destino | Acceso y resultado |
| --- | --- |
| Panel `/access` | Portal, inscripción/consulta, revisión de afiliaciones, solicitudes propias y crear cuenta según disponibilidad autorizada |
| Revisión `/affiliations/review` | Enlace visible con ligas consultables según el servicio de la página; PATCH conserva autorización independiente |
| Solicitudes `/affiliations/new` | Enlace de delegado con CREATE o UPDATE vigente en su club; UPDATE sin CREATE conserva entrada a correcciones |
| Corrección `/affiliations/{id}/correct` | Enlace contextual al solicitante con correcciones pendientes; retorno a solicitudes existentes |
| Crear cuenta `/accounts/new` | Acceso autorizado existente; se añade retorno visible al panel |
| Inscripción `/teams/registrations` | Acceso existente desde panel; se añade encabezado de cuenta y se sustituyen links de login/cambio obligatorio por panel/portal |
| Portal e inicio | Conservan login/espectador y menú de cuenta con retorno al panel y cierre de sesión |
| Preview `/dev/team-registration` | Exclusiva de desarrollo; no se incorpora al menú de negocio |

La bandeja de Secretaría permite elegir Pendientes o Aprobadas. GET ya soportaba
ambos estados; se conecta el filtro a la UI, conserva paginación/ámbito y permite
reabrir el detalle/historial de aprobadas sin ofrecer una nueva aprobación.
Después de aprobar, la solicitud sale de Pendientes y se encuentra en Aprobadas.
El delegado ve el estado de su solicitud y el acceso a inscripción cuando está
aprobada; si tiene correcciones, ve la explicación y el enlace existente para
consultarlas y reenviar. Se explica que las etiquetas del resumen de permisos
son informativas y las herramientas se abren desde los botones del panel.

Los módulos de jugadores, canchas, programación, disciplina, cobranza, arbitraje
y publicación no tienen páginas operativas en el árbol actual. No se agregan
enlaces a destinos inexistentes ni se declara implementado su negocio.

## Validación

- `npm run test:affiliation-review`: 29 pruebas aprobadas, incluida la consulta de
  aprobadas sin ofrecer otra aprobación y los controles de firmas privadas.
- `npm run test:team-registration`: 73 pruebas aprobadas.
- `npm run test:affiliations`: 27 resultados aprobados con PostgreSQL temporal;
  incluye navegación según ámbito, UPDATE sin CREATE, consulta de aprobadas y
  retorno a inscripción desde la solicitud aprobada. Base temporal eliminada por
  el runner; esquema sin diferencias respecto de las migraciones.
- `npm run lint`, `npm run typecheck` y `npm run build`: aprobados. El aviso de
  Turbopack sobre workerThreads mantiene su alternativa childProcesses y no
  impidió compilar con Node 24.22.1. La primera comprobación de tipos coincidió con
  la limpieza de tipos generados del servidor de pruebas; se repitió una vez
  terminado el runner y pasó sin modificar la configuración.
- Recorrido en navegador local con Secretaría: panel → Revisión de afiliaciones
  → Aprobadas → detalle de Halcones → Directivos y firmas privadas/historial.
  Se comprobó que no se ofrece aprobar nuevamente la solicitud.
- Comprobación HTTP con la cuenta ficticia del delegado local: panel con acceso
  a solicitudes propias y sin enlace de revisión, solicitud Aprobada con acceso
  a inscripción, retornos al panel y encabezado de cuenta en inscripción. Se
  cerró únicamente la sesión HTTP creada para esta comprobación.

Las firmas se cargan en la solicitud/corrección del delegado. Secretaría las
consulta en el detalle, sección **Directivos y firmas privadas**, mediante
**Consultar firma** y después **Descargar firma**. La página explica cómo llegar.
El enlace es temporal y conserva la autorización del servidor. Los datos locales
de Halcones no tienen archivos de firma: muestran **Sin firma registrada**; esta
revisión de navegación no crea firmas ni repite la prueba contra Storage real.

No se cambian
permisos, datos locales de Halcones, migraciones ni configuración de despliegue.
La aprobación e inscripción del servidor se conservan; nuevos cambios requieren
publicación por PR, CI remoto y revisión independiente.
