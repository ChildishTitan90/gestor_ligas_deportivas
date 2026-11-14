# Revisión manual de backend — PDGLD-86 / PDGLD-141

## Recorrido actual en el Docker local habitual

La aplicación real está en `/referees`. Ejecutar `npm run dev` e iniciar sesión
con una cuenta existente que tenga los permisos RF22 correspondientes en su
liga. Las migraciones se reciben con `prisma migrate deploy` y `prisma generate`,
verificando antes que ambas conexiones apuntan a `gestor_ligas_dev` en
localhost:5433. No sembrar ni reemplazar cuentas o datos existentes.
La demo fue retirada: su URL anterior redirige al flujo real.

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
   nombres para revisión. Enviar con motivo. Debe quedar pendiente; no debe
   crear cuenta, designación ni aumentar incorporados o reducir faltantes.
4. Como `arbitraje_comision`, completar el cambio inicial de contraseña si falta
   y abrir el mismo recorrido. Revisar candidato y club de origen. Seleccionar
   la Persona existente correcta, o confirmar expresamente que es nueva.
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
