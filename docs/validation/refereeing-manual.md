# Revisión manual de backend — PDGLD-86 / PDGLD-141

## Recorrido actual en el Docker local habitual

La aplicación real está en `/referees`. Ejecutar `npm run dev` e iniciar sesión
con una cuenta existente que tenga los permisos RF22 correspondientes en su
liga. Las migraciones se reciben con `prisma migrate deploy` y `prisma generate`,
verificando antes que ambas conexiones apuntan a `gestor_ligas_dev` en
localhost:5433. No reemplazar cuentas ni datos existentes. La carga aditiva de
designaciones descrita debajo fue solicitada expresamente para este Docker.
La demo fue retirada: su URL anterior redirige al flujo real.
Tras recibir el ajuste de cola de transacciones, reiniciar `npm run dev` una vez
para renovar el cliente Prisma conservado por Hot Reload. El orden de acciones
de cada ficha es **Acceso de árbitro → Editar → Historial**, sujeto a los permisos
y al contexto abierto. Véase [cola de transacciones](../architecture/prisma-transaction-queue.md).

En el perfil DEMO ya instalado de Docker se añadieron únicamente
`arbitraje_comision` (REFEREE_MANAGER) y `arbitraje_arbitro` (REFEREE), en
DEMO Liga de Fútbol Morelia. Usan la clave temporal del perfil local, declarada
en `DEMO_PASSWORD` de `prisma/seed-demo-data.ts`, y exigen cambiarla al iniciar.
Se reutilizan `demo-programador`, `demo-admin` y los delegados existentes.
`npm run seed:referee-accounts` es idempotente: no restablece claves ni roles al
repetirse, no crea registros de árbitro/designaciones y exige el perfil DEMO y
la autorización RF22 vigente del administrador para conceder esos roles.

Los usuarios y contraseñas sintéticos descritos debajo pertenecen exclusivamente
al recurso opcional de validación desechable; no son cuentas del Docker habitual.
Ese recurso no es necesario para el recorrido actual y no se ejecuta al iniciar
la aplicación con `npm run dev`.

## Prerregistro del club y renovación por temporada

1. Usar un delegado existente, por ejemplo `demo-delegado-a`, cuyo club tenga
   afiliación aprobada en la temporada. Entrar en **Arbitraje → Presentación de
   árbitros por club** (`/referees/presentations`). No se aprobaron afiliaciones
   ni cambiaron roles existentes automáticamente al instalar este recorrido.
2. Seleccionar club/temporada. Debe mostrar equipos válidos, requeridos,
   incorporados, faltantes y pendientes. Cinco equipos requieren dos árbitros.
   Si todavía no hay solicitudes, el aviso aparece junto a los filtros y la
   búsqueda y el filtro de estado quedan deshabilitados. El aviso distingue
   entre no tener solicitudes y no tener árbitros incorporados al padrón.
   Con solicitudes, buscar un nombre inexistente debe mostrar «No hay
   solicitudes que coincidan»; «Limpiar filtros» vuelve a mostrar la colección
   del contexto. El selector «Filtrar solicitudes por estado» solo filtra:
   no cambia el trámite ni permite que el delegado lo apruebe. Cambiar de
   club/temporada limpia la búsqueda y el filtro de estado.
3. «Presentar candidato»: reutilizar Persona vinculada al club o capturar sus
   nombres para revisión. Adjuntar cédula arbitral PDF, JPG o PNG de hasta 10 MB
   y enviar con motivo. Debe quedar pendiente; no debe
   crear cuenta, designación ni aumentar incorporados o reducir faltantes.
4. Como `arbitraje_comision`, completar el cambio inicial de contraseña si falta
   y abrir el mismo recorrido. Revisar candidato y club de origen. Seleccionar
   abrir «Ver cédula arbitral» y confirmar su revisión. Seleccionar la Persona
   existente correcta, o confirmar expresamente que es nueva.
   La coincidencia de nombres detiene el alta para verificación humana.
5. Incorporar con motivo: el padrón debe contener el árbitro asociado al mismo
   club/temporada y aumentar incorporados. La solicitud conserva revisor y
   motivo. También se puede no incorporar indicando motivo. El delegado no
   puede ejecutar estas decisiones mediante UI ni llamada directa a la API.
6. Como Comisión, abrir **Acceso de árbitro** en la solicitud incorporada o en
   el padrón. Si falta cuenta, capturar usuario, correo, contraseña temporal y
   motivo; confirmar. Debe crearse sobre la misma Persona, solo con REFEREE en
   esa liga y cambio de contraseña obligatorio. Si ya existe cuenta, debe
   ofrecer habilitar el acceso sin pedir nuevas credenciales ni cambiar las
   existentes. Si ya tiene acceso, solo informa. Una cuenta inactiva o una
   asignación vencida requiere revisión de Administración.
   En **Crear cuenta**, Administración también debe ver **Árbitro**, conservar
   Comisión y los demás roles autorizados. Árbitro fuerza Persona existente y
   verifica la incorporación vigente en la liga; no admite otra Persona nueva.
   El trámite de incorporación por sí mismo no crea cuentas ni concede roles.
7. Intentar cambiar su club en esa temporada: selector bloqueado y validación
   SQL/servidor. Mantener la prohibición de designaciones cuando cualquier equipo
   del club participa en el grupo del encuentro, aunque no juegue ese partido.
8. En la temporada siguiente, seleccionar el contexto nuevo del mismo club y
   presentar a la Persona existente desde el directorio. Comisión vuelve a
   validar. Deben conservarse Persona, árbitro y cuenta; se añade solo la relación
   de nueva temporada y se mantienen los antecedentes de la anterior.
9. Ante una respuesta incierta: consultar resultado sin reenviar; repetir solo
   la misma solicitud/clave cuando corresponda. Cambiar de cuenta no mezcla
   solicitudes conservadas en la pestaña.

Comprobación técnica puntual disponible:
`node --conditions=react-server --import tsx scripts/check-referee-presentations-local.mts`.
Exige el Docker local autorizado; usa datos sintéticos dentro de una única
transacción que termina con rollback. No crea otro contenedor/base ni deja
personas, cuentas o solicitudes de validación. Verifica alcance, idempotencia,
rechazo de aprobación por delegado, incorporación sin cuenta, cuota 5/4=2,
pendientes fuera del conteo, club fijo incluso por SQL y renovación sin duplicar.
Incluye creación y habilitación acotadas de acceso con las ACL por tabla/columna
del rol Preview: misma Persona, rol fijo, conservación de credenciales, versiones,
acuse idempotente y bloqueo de delegado/inactividad. El rol y los fixtures se
revierten. Docker conserva su RLS habitual; esto no verifica RLS de Supabase.

Para revisar incertidumbre del acceso en navegador, bloquear la respuesta de
POST tras enviarlo: no debe permitir otra alta. «Consultar resultado sin reenviar»
recupera el acuse. Si no existe acuse, el reintento conserva clave y versión;
tras recargar pide reescribir la misma contraseña temporal, que no aparece en
sessionStorage. Probar además dos pestañas: una sola cuenta por Persona y una
sola asignación efectiva REFEREE en la liga, aunque se envíen claves distintas.
Esta comprobación concurrente de navegador queda para revisión humana.

Validación puntual del acceso (14/11/2026): tipado, lint, formulario general de
cuentas y regresión de vistas arbitrales. Se comprobó en Chrome con respuestas
sintéticas el alta acotada, cuenta existente, rol Árbitro en alta general,
bloqueos, doble envío, recuperación/reintento y ausencia de contraseña en
sessionStorage a 390/1440 px en claro/oscuro. No es un recorrido autenticado
completo de NextAuth. En Docker habitual, el servicio y las ACL limitadas
pasaron la transacción sintética con rollback; los permisos retirados no se
restauraron al repetir la instalación. Tras reducir consultas repetidas, la
lectura real de presentaciones midió 56 ms para Comisión y 42 ms para delegado
en esta máquina (cinco y tres contextos), sin escrituras.

## Disponibilidad del árbitro

1. Iniciar sesión con la cuenta ligada a la Persona incorporada y con REFEREE
   en la liga. Completar el cambio inicial de contraseña. `arbitraje_arbitro`
   sirve solo si su misma Persona fue incorporada; la cuenta sola no lo registra.
2. Abrir **Arbitraje → Mi disponibilidad** (`/referees/my-availability`) y elegir
   liga/temporada. Debe funcionar sin partidos asignados. Sin incorporación
   vigente debe explicar el vacío, sin mostrar datos de otros árbitros.
3. Añadir intervalos disponible e indisponible. El motivo muestra ejemplos sin
   prellenado. Las fechas se interpretan en la zona indicada de la liga.
   Confirmar y recargar: deben mantenerse los mismos registros.
4. Como Comisión, consultar Disponibilidad en el padrón: debe mostrar los mismos
   intervalos. Una corrección autorizada conserva actor y motivo en auditoría.
5. Editar un intervalo propio. Un fin anterior al inicio o un cambio incompatible
   con un partido aprobado se rechazan sin revocar ni modificar la designación.
   Comisión debe revisar esa designación antes de aplicar el cambio incompatible.
6. Una llamada directa con árbitro/intervalo o temporada ajenos, kind approve o
   versión anterior debe rechazarse. UPDATE* no habilita la API general ni padrón.
7. Ante respuesta incierta, consultar el acuse antes de reintentar; se conserva
   clave, contenido y versión. Cambiar de cuenta no mezcla solicitudes.
8. Con varias ligas vigentes, los intervalos son globales. Si falta permiso propio
   en alguna, se bloquea captura y se solicita revisión de acceso; no se crean
   calendarios independientes ni se inventan excepciones.

`npm run test:referee-availability-ui` usa Chrome con datos, sesión y transporte
sintéticos. Comprueba zona, placeholders, doble envío, recuperación/reintento,
vacío/inactividad, lectura y foco a 390/1440 px en ambos temas. No prueba NextAuth
real ni proveedores. La comprobación transaccional local anterior valida
propiedad, versión, alcance multiliga y un conflicto real con una designación
aprobada, con ACL limitadas y rollback total. Son comprobaciones puntuales;
no se declara completada la etapa posterior de pruebas automáticas.

## Cédula del candidato y vista previa de Comisión

1. La migración `20261114060000_pdgld141_referee_credentials` ya se recibió en
   el Docker habitual. Los buckets **acreditaciones-arbitros** de pruebas y
   producción quedaron privados, con PDF/JPG/PNG y máximo 10 MB. La aplicación
   local usa únicamente el de pruebas. No se migraron tablas compartidas ni se
   subieron documentos a producción.
2. Con `demo-delegado-a`, en DEMO Club A / DEMO Registro de jugadores 2026,
   presentar candidato y adjuntar su acreditación. El motivo conserva su ejemplo.
   Enviar: la solicitud y la referencia confirmada del archivo se guardan juntas.
   Un archivo inválido o sin confirmar no permite presentar al candidato.
3. Con `arbitraje_comision`, abrir **Presentación de árbitros por club**. Se dejó
   **SINTÉTICO Cédula PDGLD86** pendiente con un
   [PDF de ejemplo sin validez](fixtures/cedula-arbitral-sintetica.pdf). Abrir
   «Revisar», «Ver cédula arbitral» y cerrar la vista previa: debe retornar el foco
   al botón de origen. Confirmar explícitamente que se revisó la cédula, elegir
   la Persona correcta o verificar que es nueva y proporcionar el motivo.
4. Antes de consultar/confirmar la cédula, **Incorporar al padrón** queda bloqueado.
   Una llamada directa sin documento o sin su hash revisado también se rechaza.
   El PDF sintético solo prueba la UI: no acredita profesionalmente a nadie.
5. Un pendiente anterior sin cédula ofrece **Adjuntar cédula arbitral** al delegado
   autorizado de su club. No sustituye datos del candidato. Los ya incorporados
   conservan su estado y muestran la ausencia de documento como antecedente.
6. Otro club no puede obtener la vista previa con el UUID. Si se pierde el permiso,
   una nueva consulta debe denegarse. El acceso firmado ya emitido vence en un
   máximo de 60 segundos; el visor retira su copia al cerrar o vencer.
7. Para incertidumbre, consultar el acuse antes de reintentar. Tras recargar, el
   archivo no está guardado en la pestaña: se requiere elegir el mismo archivo
   si todavía no hay acuse. No se envía otro documento usando la misma clave.

Comprobaciones puntuales ejecutadas: carga real de un PDF sintético en Storage
de pruebas, lectura verificada para Comisión, UUID rechazado para otro club y
acuse idempotente. Chrome con transporte sintético comprobó envío multipart,
recuperación, ambos temas a 390/1440 px, revisión obligatoria y foco entre
diálogos. El visor de expedientes de jugadores conservó imagen/PDF, teclado,
vencimiento y denegación. Docker comprobó carga en pendientes antiguos y las
ACL limitadas de Preview dentro de rollback. No equivale a ejecutar todo el
recorrido NextAuth en navegador ni a completar la etapa de pruebas automáticas.

Comandos explícitos: `npm run seed:referee-credential` conserva la solicitud ya
creada; `npm run test:referee-credentials-ui` usa respuestas sintéticas. Se
regeneró el cliente Prisma y se reinició Next.js en localhost:3000 para recibir
el modelo nuevo. La caché de desarrollo distingue el esquema generado y la
fábrica del adaptador; después de generar cambios en node_modules puede seguir
siendo necesario reiniciar el proceso de desarrollo.

Plan de seguridad, variables de servidor y decisiones de retención pendientes:
[acreditación arbitral y Storage](../architecture/referee-credentials.md).

## Designaciones en la temporada existente de Docker

Por solicitud del usuario, los casos se guardaron en **DEMO Liga de Fútbol
Morelia → DEMO Registro de jugadores 2026**. No se creó otra temporada. Abrir:

`/referees?league=54000000-0000-4000-8000-000000000001&season=33f8a69d-ed3c-5629-a464-6e9f440d8b42&view=assignments`

La pestaña muestra propuestas y designaciones por partido: equipos, categoría,
grupo, horario, árbitro, disponibilidad, estado y motivos que impiden aprobar.
Tener un árbitro en el padrón no crea una designación. Antes de esta carga no
había partidos ni propuestas en esta temporada; por eso estaba vacía y el botón
para proponer estaba deshabilitado.

Estados iniciales de los ocho partidos; horarios en **America/Mexico_City**:

| Partido | Fecha y hora | Estado | Qué revisar |
| --- | --- | --- | --- |
| PR86-01 | 28/11/2026, 08:00–10:00 | Pendiente | Propuesta válida que Comisión puede aprobar |
| PR86-02 | 28/11/2026, 11:00–13:00 | Aprobada | Acceso efectivo para `arbitraje_arbitro` |
| PR86-03 | 29/11/2026, 08:00–10:00 | Revocada | Conserva propuesta, aprobación y revocación en Historial; sin acceso |
| PR86-04 | 29/11/2026, 11:00–13:00 | Pendiente | Árbitro inactivo |
| PR86-05 | 30/11/2026, 08:00–10:00 | Pendiente | Intervalo de indisponibilidad |
| PR86-06 | 28/11/2026, 11:00–13:00 | Pendiente | Traslape con PR86-02 en otra cancha y entre otros equipos |
| PR86-07 | 30/11/2026, 11:00–13:00 | Pendiente | Otro equipo del club presentador pertenece al grupo, aunque no juega el encuentro |
| PR86-08 | 01/12/2026, 08:00–10:00 | Pendiente | No hay disponibilidad declarada que cubra el partido |

«Bloqueada» describe la evaluación actual; los casos negativos conservan el
estado persistente **PROPOSED**. Se propusieron cuando eran válidos y después
cambiaron actividad, disponibilidad o miembros del grupo. El traslape aparece
al aprobar la otra propuesta. No se deshabilitaron restricciones para cargarlos.

1. Entrar como `arbitraje_comision`, seleccionar ese contexto y dejar el filtro
   de estado en Todos. Recargar si la vista ya estaba abierta. Revisar PR86-01,
   escribir el motivo y aprobar: debe mostrar confirmación oficial y registrarse
   el evento en Historial. Revisar PR86-04 a PR86-08: deben explicar el bloqueo
   y rechazar la aprobación también en servidor.
2. Con `arbitraje_arbitro`, abrir el recorrido existente **Mis partidos**:
   inicialmente solo aparece PR86-02. PR86-01 aparece después de aprobarlo.
   Las propuestas y la revocada no autorizan su URL directa. **Mi disponibilidad**
   permite consultar los intervalos del mismo árbitro.
3. Revocar PR86-02 como Comisión con motivo. Al recargar como árbitro debe
   desaparecer de Mis partidos y su URL debe denegar acceso. PR86-06 deja de
   tener ese traslape y requiere una revisión nueva antes de aprobar.
4. Como `demo-programador`, consultar/proponer sin poder aprobar ni revocar.
   Las contraseñas de las cuentas existentes se conservaron; esta carga no
   restablece accesos ni concede permisos adicionales.

Para designaciones nuevas, Comisión ahora ve **Asignar árbitro → Asignar y
aprobar**: una sola confirmación, motivo y validaciones completas de servidor.
Debe quedar aprobada y disponible en Mis partidos del árbitro, con propuesta y
aprobación en Historial. Programación conserva propuestas pendientes. Las ya
pendientes no cambian automáticamente; se revisan con **Aprobar designación**.
El árbitro no tiene un paso adicional de aceptación en este avance.

### Actualizar después de una revocación

1. En una ficha revocada de un contexto abierto, usar **Actualizar designación**.
   El diálogo conserva el partido seleccionado y permite elegir al árbitro.
   Cambiar al candidato y escribir el motivo. Comisión confirma **Actualizar y
   aprobar**; Programación confirma **Enviar nueva propuesta**, sin aprobar.
2. Se crea una designación nueva. La anterior mantiene su UUID, estado revocado,
   versiones, actor y motivos. No se reactiva ni se sobrescribe. Un antecedente
   cerrado permanece de solo consulta.
3. **Asignar árbitro / Proponer designación** muestra únicamente partidos abiertos
   sin aprobación vigente sin bloqueos o con una aprobación que requiere revisión.
   La descripción distingue ausencia de árbitro aprobado, propuestas pendientes
   y antecedentes revocados. Una propuesta pendiente no se presenta como publicada.
4. Si queda una aprobación con conflicto, seleccionar su partido ofrece **Revisar
   designación actual**. Se debe revisar y revocar primero; no se reemplaza de
   forma silenciosa. Si ya existe una propuesta del candidato, **Revisar propuesta
   pendiente** permite continuar esa solicitud en vez de duplicarla.
5. Confirmar otra vez con datos cambiados, un árbitro incompatible o UUID ajenos
   debe seguir rechazándose en servidor. El filtro de la UI no concede permisos.

Chrome verificó actualización con partido fijo, árbitro editable y comandos nuevos
sin el UUID revocado, en ambos temas a 390/1440 px. También verificó exclusión de
aprobaciones sin bloqueos y contexto cerrado, y el acceso a la revisión de una
aprobación en conflicto. La comprobación local con rollback verifica que revocar
y asignar de nuevo deja dos referencias distintas, preservando el antecedente.

Se añadieron registros identificados **SINTÉTICO PDGLD-86**: categoría y su
reglamento, dos grupos, clubes, equipos, canchas, intervalos y ocho partidos con
sus designaciones. Se reutilizó la Persona de `arbitraje_arbitro`; se incorporó
al padrón del contexto y se añadieron tres Personas sintéticas sin cuenta para
los casos negativos. Si ya existía su relación de club/temporada, el instalador
la conserva. La cuota sigue usando `ceil(equipos válidos/4)`, sin sanciones ni
excepciones de grupo único. Son datos ficticios **persistidos en Docker** y las
acciones usan el backend real; no son cambios en memoria de la antigua demo.

La carga explícita es `npm run seed:referee-designations`. Exige el perfil DEMO
instalado, cuentas operativas y permisos RF22 reales; comprueba ambas conexiones
contra localhost:5433/gestor_ligas_dev y rechaza conexiones compartidas. Todo se
instala en una transacción. Las propuestas, aprobaciones, revocación y cambios
de disponibilidad reutilizan los servicios y restricciones existentes. Una marca
de instalación impide duplicar o restaurar datos: repetir el comando conserva
lo que el usuario haya cambiado. No forma parte del arranque ni de migraciones.

Comprobado el 14/11/2026 con las consultas autorizadas reales de Comisión:
ocho estados y cinco motivos esperados. La consulta existente de Mis partidos
devolvió solo PR86-02; las comprobaciones de propiedad rechazaron la propuesta,
la revocada y el traslape. Repetir la carga no escribió registros nuevos. No se
declara ejecutado el recorrido completo de navegador con sesión NextAuth.

## Recurso opcional de validación desechable

Requiere Docker y dependencias instaladas. No usar seeds o migrate deploy contra
una conexión habitual para esta revisión. Desde la misma rama:

```powershell
npm run referees:local
```

El comando crea un contenedor PostgreSQL 15 propio sin volumen, aplica las
migraciones, instala catálogo RF22 y fixtures sintéticos, habilita RLS solo allí,
provisiona el rol limitado de Preview y levanta Next.js en
`http://127.0.0.1:3193`. No hereda conexiones ni claves de proveedores; correo
deshabilitado. Ctrl+C cierra la aplicación y elimina únicamente su contenedor.
El estado se pierde al detenerlo. Para ejecutar solo la comprobación local y
eliminar el contenedor al terminar: `npm run referees:check-local`.

Estas son cuentas de prueba, no cuentas de una base compartida. Contraseña común
exclusivamente sintética: **Arbitraje-Local-141!**.

| Usuario | Contexto / resultado |
| --- | --- |
| arbitraje_comision | REFEREE_MANAGER de Liga arbitraje sintética; registra, edita, consulta y aprueba/revoca |
| arbitraje_programador | SCHEDULER de esa liga; lee y propone, sin aprobar/revocar |
| arbitraje_arbitro | REFEREE; Mis partidos solo con asignación propia efectiva; no abre padrón general |
| arbitraje_lector | SUPERADMIN de esa liga; solo lectura de arbitraje conforme a RF22 |
| arbitraje_ajeno | Comisión de otra liga; no ve ni modifica recursos del contexto probado |

## Pasos y resultados esperados

1. Sin sesión, abrir `/referees`: redirección a login. Entrar como Comisión,
   elegir explícitamente Liga arbitraje sintética y Temporada sintética.
2. Revisar las cinco pestañas conservadas. El fixture presenta al árbitro de la
   cuenta existente `arbitraje_arbitro` por Presentador. El segundo árbitro,
   Conflicto Sintético, es presentado por Tercero, cuyo equipo pertenece al grupo
   A aunque no disputa REAL-141. Su evaluación debe incluir ese motivo.
3. Filtrar nombre, club y actividad. Editar Conflicto para desactivarlo, con
   motivo; confirmar y recargar: el cambio permanece. Intentar presentarlo de
   nuevo en la temporada no crea otra Persona ni otro árbitro.
4. Presentar una Persona existente del catálogo, por ejemplo la de lector, con
   un club afiliado válido. Se conserva su cuenta y sus permisos originales.
   No aparece otro usuario ni se concede rol de árbitro automáticamente.
5. Consultar Disponibilidad. Inicio/fin se muestran en America/Mexico_City,
   independientemente del dispositivo. Añadir/editar un intervalo exige motivo.
   Un intervalo inválido, un conflicto con una aprobación vigente o una versión
   obsoleta se rechaza sin acuse de éxito.
6. Cuota: los clubes Local/Visitante/Tercero tienen un equipo válido cada uno,
   por tanto requieren uno. Presentador no tiene equipos inscritos y requiere
   cero. Comparar presentados/activos/inactivos/faltantes y el contexto de cada
   club. El cómputo no aplica sanciones. El tratamiento de inactivos está señalado
   como pendiente de criterio.
7. REAL-141 empieza aprobado al árbitro sintético. Como árbitro, abrir Mis
   partidos y consultar su alineación. Como otro usuario, conocer su URL/UUID
   no concede acceso. La cédula completa no forma parte de esta entrega.
8. Como Comisión, revocar la designación indicando motivo. Volver a consultar
   esa URL como árbitro: acceso denegado o partido ausente de su lista. No basta
   conservar un menú abierto para mantener la autorización.
9. Como Programador, proponer de nuevo al árbitro original para REAL-141.
   Debe quedar Pendiente, sin acceso efectivo ni afirmación de publicación.
   Programador y lector no deben poder aprobar. Comisión sí puede aprobar si
   la evaluación está libre de bloqueos.
10. Abrir la misma propuesta en dos pestañas de Comisión y aprobar desde ambas:
    una operación se confirma; la otra debe informar versión/conflicto. No se
    crean dos aprobaciones. En Historial revisar actor, acción y motivo.
11. Retirar/editar la disponibilidad de un árbitro aprobado de modo que ya no
    cubra su encuentro: servidor rechaza el cambio hasta revocar. No convierte
    en válida una selección del navegador ni cambia historia automáticamente.
12. Para incertidumbre, cortar conexión después de enviar. La vista no debe
    afirmar éxito. Restablecer y «Consultar resultado sin reenviar»; si no hay
    acuse, «Reintentar la misma solicitud» conserva clave/contenido/versión.
    Recargar la misma pestaña permite recuperar la solicitud de esa cuenta,
    sin reenvío automático. Otra cuenta no accede a ese acuse. Con almacenamiento
    bloqueado solo se conserva durante la vista y se advierte no abandonarla.
13. Entrar como Comisión ajena: no puede seleccionar la liga de los fixtures;
    enviar sus UUID directamente a la API tampoco concede permiso (403).

## Historia y dependencias a revisar

La comprobación local sin `--serve` finaliza el partido mediante SQL del fixture,
comprueba la captura MATCH_CLOSURE_V1 y el rechazo de una edición directa de
Persona. No es una ejecución del PR pendiente de transiciones ni de la cédula.
Los cierres reales deberán usar PDGLD-85 cuando se integre su contrato.

Para temporadas cerradas, el lector usa los snapshots existentes de PDGLD-117.
Un legado sin evidencia debe mostrar «Identidad histórica no disponible» y
conservar HISTORICAL_REFEREE_UNPROTECTED; no se fabrica un nombre desde Persona.
En una corrección autorizada por el trámite existente de 117, la misma Persona
y referencias permanecen; las aprobaciones abiertas con versión anterior pierden
efectividad y requieren nueva revisión. Los nombres ya capturados al cierre se
conservan. El trámite privado completo, con sus documentos y todas las
autorizaciones de players, requiere la próxima etapa de validación; no está
simulado como una aprobación automática en este fixture.

Decisiones externas: efecto de inactivos en cuota, membresías retiradas que aún
figuran en el grupo, descansos/traslados y relevos durante partido. La restricción
de club también aplica al grupo único: no se implementa excepción para evitar
que el conjunto elegible quede vacío. Contratos y plan de seguridad en
`../architecture/refereeing.md`.

En Historial, «Referencia de árbitro» muestra el nombre y debajo su UUID, que
sigue siendo el valor del filtro y también permite buscar. Usa nombres capturados
cuando hay evidencia histórica; una referencia histórica sin evidencia se muestra
como «Identidad histórica no disponible», sin completarla con el nombre actual.
