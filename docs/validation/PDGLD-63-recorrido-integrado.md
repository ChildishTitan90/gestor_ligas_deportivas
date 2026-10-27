# PDGLD-63 — procedimiento de aceptación con página real

Preparado el 26/10/2026. **No ejecutado. No autoriza escrituras por sí mismo.**
No se han iniciado Next con base, migraciones, seeds ni scripts de integración.
Las pruebas de Chrome de esta entrega siguen usando negocio simulado.

## Puerta de entrada: confirmar el entorno antes de escribir

El responsable debe confirmar y registrar, sin contraseñas ni conexiones completas:

1. Revisión que combina PDGLD-63 con [PR #31](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/31),
   contrato revisado en 9eb5373. Actualmente origin/develop está en b99730c y no
   contiene esos endpoints/migración. No validar contra una mezcla de contratos.
2. PostgreSQL desechable y aislado, en loopback, con base exclusiva de esta prueba,
   nombre inequívoco aleatorio, puerto y versión identificados. No usar
   gestor_ligas_dev, bases del equipo ni Supabase. Confirmar que puede descartarse.
3. Configuración del proceso Next dedicada a esa base, origen/puerto de pruebas
   distinto y secreto de sesión exclusivo suministrado por el responsable, sin
   editar .env del proyecto ni imprimir credenciales. Confirmar que Storage de
   firmas y cualquier integración apuntan a recursos locales/de prueba aislados.
4. Plan revisado de preparación y limpieza, cuentas sintéticas y asignaciones de
   delegado/Secretaría del ámbito de prueba. Mantener autorizador y políticas
   reales; no conceder privilegios ni saltarse autenticación para hacer pasar UI.
5. Confirmación explícita del entorno y autorización para preparar datos y hacer
   las escrituras del recorrido. Hasta entonces, detenerse aquí.

Después de esa confirmación, el responsable podrá reconstruir la base desde las
migraciones compartidas en el checkout integrado y generar el cliente, siguiendo
`docs/migraciones.md`. Incluye la migración de operaciones de PR #31; no editar
baseline ni aplicar cambios en una base existente compartida. No usar db push,
reset o seeds de demostración como sustituto de esta preparación.

El runner `npm run test:team-enrollments` crea PostgreSQL temporal y prueba HTTP,
pero **no es este recorrido visual**: modifica datos y lee configuración local.
No ejecutarlo sin la confirmación anterior ni afirmar que deja un entorno abierto
para navegar; su ciclo incluye limpieza. Preparar la instancia navegable por el
mismo procedimiento revisado de fixtures aislados, sin reutilizar datos personales.

## Preparación de fixtures aislados (tras confirmación)

Preparar liga/deporte, club activo, temporada abierta, dos categorías con grupos,
reglamento y usuarios sintéticos en el PostgreSQL exclusivo. Las asignaciones y
permisos se preparan como fixtures por el responsable del backend usando las
políticas existentes. No establecer por SQL afiliación APPROVED ni marcas de
autorización: deben obtenerse mediante el flujo real. Reservar una temporada
histórica sintética para comprobar nombres y filtros cerrados sin tocar historia
real. Registrar IDs técnicos solo en evidencia privada de prueba, nunca secretos.

Iniciar la aplicación Next con variables de entorno del proceso apuntando al
destino aislado y NEXTAUTH_URL del origen de pruebas. No arrancar el servidor
habitual sin comprobar su destino. Usar perfiles de navegador separados para
Delegado A, Secretaría y otro usuario B; sin cookies de cuentas reales.

## Recorrido principal desde la página

1. Delegado A inicia sesión por login real y completa cambio de contraseña si
   corresponde. Desde el panel abre solicitud de afiliación y envía la solicitud
   real del club con las categorías previstas y firmas sintéticas válidas. Verificar
   PENDING sin inscripciones ni activación automática. No sustituirlo por SQL.
2. Secretaría inicia sesión por el acceso real y abre el detalle/bandeja. Obtiene
   version y categoryOptions del servidor. Aprueba con una selección explícita de
   categorías solicitadas. Verificar PATCH de review con expectedVersion y
   authorizedCategoryIds, historial y categoría no autorizada excluida.
3. Delegado A entra por /access a /teams/registrations. Cambia club/temporada.
   Comprobar capabilities correspondientes al club, solo categorías aprobadas y
   grupos válidos. Mientras carga, no se habilita escritura; ningún GET hace alta.
4. Inscribir equipo nuevo mediante formulario real. Verificar que el request
   contiene una clave estable, modalidad excluyente y X-Expected-Actor-Id de A.
   Esperar recibo 201 REGISTERED y ver el equipo en la lista, sin ACTIVE automático.
5. Iniciar otra inscripción y registrar otro equipo en esa temporada. Intentar
   repetir un equipo existente y comprobar conflicto sin segundo grupo ni efectos
   parciales. Para otra temporada abierta/aprobada, elegir existing y comprobar
   identidad de equipo conservada con inscripción nueva.
6. Consultar con filtros de /catalogs. Verificar nombres, temporadas cerradas,
   seasonName histórico del listado y paginación. Ningún selector debe requerir UUID.
   Comprobar rol de solo READ: consulta accesible sin inscripción habilitada.

## Incertidumbre, consulta y cancelación reales

En DevTools o proxy **del entorno de prueba**, perder el acuse de un POST sin
convertir una respuesta en un éxito ficticio. Conservar cuerpo y clave originales.

1. Recargar y cerrar/retomar formulario: mismo pendiente y bloqueo; cero claves
   nuevas, cero reintentos automáticos. «Consultar resultado» hace GET de operación
   con club/key originales y header de actor. Un listado vacío no lo resuelve.
2. Caso UNRESOLVED: bloquear/demorar el POST antes de entregarlo y consultar con
   la misma sesión. Verificar que el cuerpo permanece y la UI no anuncia fracaso
   definitivo. Si se permite reintentar, solo acción explícita y mismo JSON/clave.
3. Caso CONFIRMED: dejar completar un alta y perder solo su acuse. Consultar:
   comprobar inscripción única, replayed=true y estado vigente, sin nueva auditoría
   de alta por consulta. Con recuperación explícita tampoco duplicar inscripción.
4. Caso CANCELLED: con intención aún no aplicada, confirmar el diálogo de
   cancelación real. Verificar POST /operations/{key}/cancel con cuerpo original y
   header, acuse CANCELLED y limpieza local. Liberar el POST demorado y comprobar
   OPERATION_CANCELLED sin inscripción; no editar la clave para sortearlo.
5. Carrera confirmación/cancelación: si la inscripción ganó, cancelar devuelve
   CONFIRMED y no elimina ni retira al equipo. Si se pierde el acuse de cancelación,
   conservar pendiente hasta nueva consulta válida. Fallo de limpieza local deja
   aviso y bloqueo; reconsultar limpia sin otra intención.
6. Cambio a usuario B, pérdida de sesión o READ/CREATE retirado en fixtures aislados:
   no mostrar ni enviar datos de A como B. READ vigente sin CREATE permite consultar
   o cancelar intención propia, sin alta. Probar respuesta tardía después de cambiar
   identidad y mismatch del header contra sesión: el backend debe rechazarlo.

## Evidencia y cierre

Guardar resultados y capturas redactadas, SHA de frontend/backend, versiones,
matriz de escenarios y respuestas técnicas sin cookies, tokens, contraseñas,
conexiones, cuerpos personales ni firmas reales. Verificar conteos, unicidad,
rollback y auditoría mediante lecturas en la base aislada por el responsable.
Registrar fallos sin corregir producción ni debilitar políticas. Revisar foco,
teclado, carga, errores, confirmaciones y móvil con otra persona.

Solo declarar aceptación tras este recorrido, revisión del equipo y CI remoto
aprobado. Limpiar exclusivamente los recursos desechables confirmados en el plan;
no eliminar volúmenes ni bases por semejanza de nombre. Este documento no ejecuta
la preparación, la prueba ni la limpieza.
