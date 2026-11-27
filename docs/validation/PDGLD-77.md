# PDGLD-77 · PDGLD-176

## Estado y versión

Trabajo sobre `feat/PDGLD-77-cargos-tesoreria`, HEAD inicial `b10a752`, con `origin/develop` actualizado e integrado localmente desde `373ee72`, sin commit de integración. La revisión manual de PDGLD-174/175 **no se realizó** según informó Víctor. Continuó la automatización a petición suya; esa aceptación humana permanece pendiente.

Las pruebas usan Node.js 24.9.0, Next.js 16.4.6, NextAuth 4.24.15, Prisma 7.10.1 y Chrome 158.0.8127.37 real. Cada ejecución crea un contenedor PostgreSQL exclusivo, con datos en tmpfs y puerto loopback dinámico, aplica todas las migraciones, carga una fixture sintética con la matriz RF22 real y levanta la aplicación con `gestor_ligas_preview`, sin superusuario ni BYPASSRLS. RLS está activo en las tablas de esa base. El ámbito por persona se verifica en los servicios con sesión; las políticas SQL pertenecen al backend privado, no identifican al usuario de NextAuth.

La base habitual de Docker, sus clubes/cuentas, las fotos y los documentos de Storage se conservan. Esta suite no usa Supabase ni proveedores CURP/INE, correo o almacenamiento remoto. No añade migraciones ni pagos funcionales.

## Casos y evidencia reproducible

`npm run test:billing` ejecuta PostgreSQL 15. `npm run test:billing -- --postgres=17` ejecuta PostgreSQL 17. Requieren Docker y Chrome; `CHROME_BIN` permite indicar su ejecutable. No reciben una conexión externa ni leen `.env` para elegir la base. Las credenciales desechables viven en el temporal del SO y se eliminan al terminar. Cada ejecución detiene su Next.js/Chrome y elimina solamente su contenedor identificado por etiqueta de propietario.

La suite tiene 17 casos y el contenedor de pruebas, con comprobaciones HTTP directas contra las Server Actions reales. Las referencias se capturan del navegador compilado, sin endpoints especiales de prueba.

| Comportamiento | Comprobación |
| --- | --- |
| Cargo pendiente y precisión | Alta sin pagos; saldo exacto; `0.01`, máximo `9999999999.99`, coma y ceros iniciales; rechazos por cero, negativo, tercer decimal, exponente y desbordamiento. PostgreSQL también rechaza cero/desbordamiento. |
| Autoridad y contexto | Sesiones reales de Tesorería, delegado, otra liga, invitado y Comisión; anónimo, UUID inexistente, equipo/temporada inconsistente, identificadores ajenos y revocación con la misma sesión. |
| Intención y unicidad | Reenvíos concurrentes del mismo UUID con acuse idéntico y sin auditoría adicional; UUID reutilizado con otro contenido rechazado; dos generaciones con distintas intenciones y mismo periodo crean una deuda. INSERT concurrente directo comprueba ambos índices de club/equipo. |
| Semanal | Guardar plan no crea cargos; otro periodo produce otro cargo; repetir recupera el existente; siete días inclusivos y ventana del plan se validan. |
| Corrección e historial | Un ganador por versión; motivo, autor y valores anteriores conservados; cualquier pago bloquea corrección y sus movimientos se conservan. |
| Atomicidad | Trigger de fallo instalado solo en la base desechable después del efecto y antes del acuse: rollback de cargo/plan, historial y operación. La conciliación confirma NOT_APPLIED y permite el mismo intento. |
| Consultas/consumidores | Coherencia entre importe/saldo persistidos, detalle y consulta privada; delegado limitado a su club; evento CHARGE_CREATED con UUID estable y autorización. No acredita la entrega de avisos de PDGLD-83. |
| Interfaz real | Menú → captura → revisión → cancelación/confirmación → acuse → detalle → corrección; plan/generación/repetición. Validación y foco, retorno con Escape, descarte, captura conservada tras rechazo, Tab dentro del diálogo, escritorio/móvil y claro/oscuro. |
| Transporte interrumpido | CDP corta la respuesta después de comprobar el commit real; la consulta recupera el mismo cargo. Otro corte antes del envío permite consultar NOT_APPLIED y reenviar exactamente la misma intención. El transporte se altera deliberadamente; sesión, servicios y base son reales. |
| RLS/ACL | Backend limitado con RLS activo; sin INSERT de pagos, DELETE de cargos, cambio de destinatario ni lectura del ledger de Prisma. |

Matriz final aprobada el 26/11/2026 (America/Mexico_City): PostgreSQL **15.19, 18/18** y PostgreSQL **17.12, 18/18**, sin omisiones, ambos con exit 0. Los JSON enumeran los 17 casos y el runner cuenta además su contenedor de pruebas. [Resultado PG15](pdgld176/pg15/results.json) · [Resultado PG17](pdgld176/pg17/results.json). Cada versión conserva ocho capturas: listado/detalle a 390 y 1440 px en claro/oscuro. Ejemplos: [listado móvil claro](pdgld176/pg17/listado-390-light.png), [listado escritorio oscuro](pdgld176/pg17/listado-1440-dark.png) y [detalle móvil oscuro](pdgld176/pg17/detalle-390-dark.png).

## CI y regresión

El job `billing` de `.github/workflows/ci-cd.yml` ejecuta el runner en matriz 15/17 y sube evidencia sintética. `CI listo para integrar` depende de `billing` y exige `BILLING_RESULT=success`; no hay `continue-on-error`. `test:ci` incluye una comprobación del workflow y ejecuta su shell real con success/failure/cancelled/skipped para comprobar el bloqueo. Una prueba fallida de la suite propaga exit 1 al runner.

Comprobados: `npm run lint`, `npm run typecheck`, `test:theme` (7), `test:affiliation-review` (31), `test:database-config` y `test:team-registration`. `test:preview-runtime` terminó con 126 aprobadas y 2 omisiones explícitas que corresponden a comprobaciones originales de migración/seguridad en el otro perfil. `test:ci` pasó en Linux con el repositorio montado en solo lectura (99/99). En Windows, la suite general de CI contiene requisitos POSIX y pruebas de symlinks que fallan también fuera del sandbox; la ejecución Linux acreditada conserva esos controles, sin omitirlos ni debilitarlos.

El workflow está preparado y su gate fue ejecutado localmente; **no hay ejecución de GitHub Actions de estos cambios**, porque no se hizo commit ni push. No se declara CI remoto aprobado ni revisión por otra persona.

## Ajustes y pendientes

Se completó el plan privado de Preview con lectura de conceptos/planes, INSERT limitado de planes/cargos y acuses con `correlation_id`, UPDATE de importe/vencimiento/versión y bloqueo de planes. El diálogo de generación/corrección asocia su error al campo, indica `aria-invalid` y conserva su aspecto y foco. No se reemplazaron vistas ni controles compartidos.

**No aceptado: multa desde resolución oficial válida y reenvío sin duplicarla.** PDGLD-27 está pendiente de una referencia verificable con vigencia/exigibilidad. La prueba solo acredita el rechazo de FINE, incluidos reenvíos y planes legados; un UUID o una fixture no acredita esa integración. Falta acordar automatización de arbitraje por partido y su evento, tarifa/reparto y cancelaciones. No se inventó calendario ni tarifario.

Preview/Production necesitan revisar y aplicar su plan de ACL/RLS privado antes del despliegue autorizado; solo se probó su provisión en PostgreSQL desechable. La unicidad original por `sanction_id` se conserva. PDGLD-78/79/82 pueden consumir la consulta privada de saldo; sus recorridos completos no están implementados por esta entrega. PDGLD-83 aún debe implementar descubrimiento/entrega y deduplicación de avisos.

Para retomar: ejecutar ambos comandos, revisar los JSON y las capturas, realizar la prueba humana en el Docker habitual con [la guía local](local-app-data.md), acordar el contrato con PDGLD-27 y revisar el PR hacia develop. No cerrar PDGLD-77/176 por la parte protegida o por CI únicamente. [Borrador del PR](PDGLD-77-pr.md).

## Demostración manual pendiente

1. Abrir [Tesorería → Cargos](http://127.0.0.1:3000/treasury/charges) con `tesoreria-local`. Las contraseñas/cuentas existentes no se modificaron; consultar [los datos locales](local-app-data.md). Si el servidor está detenido, ejecutar `npm run dev` desde el proyecto con su configuración Docker habitual.
2. Crear un cargo de prueba para un club afiliado, con concepto Cancha, modalidad Único, importe ficticio `65.25` MXN, periodo `01–07/04/2027`, vencimiento `15/04/2027` y motivo explícito de prueba. Elegir una combinación todavía no utilizada; si ya existe, se recupera o se rechaza por datos distintos. Revisar destinatario/importe, cancelar la primera confirmación y confirmar después. El acuse lleva al detalle; pagos sigue en cero.
3. Modificar ese cargo a `70.50` con otro motivo. Consultar el historial y comprobar antes/después/autor. La operación queda bloqueada si hay cualquier pago asociado.
4. Guardar un plan semanal para un equipo dentro de una ventana explícita. Verificar que aún no crea cargos. Generar siete días inclusivos con vencimiento futuro, repetir exactamente ese periodo y comprobar el mismo cargo; generar otra semana y comprobar otro cargo.
5. Entrar como delegado del club para consultar su ámbito y con Disciplina/invitado para comprobar denegación. Multa explica el bloqueo de PDGLD-27. Para las pérdidas de respuesta, carreras y rollback usar la suite desechable, que deja sus efectos de prueba fuera de esta base manual.

La revisión visual automatizada conservó los tokens, la jerarquía y la composición aprobadas. No sustituye la prueba humana ni la aceptación reglamentaria. Se comprobó de nuevo `origin/develop=373ee72` al finalizar; sus correcciones de cédula y pruebas siguen integradas localmente, sin commit, push ni merge de PR.

## Registro histórico de PDGLD-175

## Estado actual

La entrega conecta las vistas aprobadas de PDGLD-174 con consultas y escrituras reales. Conserva el shell, los selectores y los diálogos compartidos. La rama parte de `345e244`. `origin/develop` continúa en `0bded09` en la última revisión.

El usuario cambió el destino de la preparación a su Docker habitual y pidió datos para recorrer todos los módulos implementados. La URL vigente es [localhost:3000/treasury/charges](http://localhost:3000/treasury/charges). Usa `tesoreria-local` y la contraseña sintética de la guía de autenticación. La [guía de datos locales](local-app-data.md) contiene las cuentas por rol, clubes, jugadores, árbitros, documentos y recorridos.

Funcionan en el recorrido mínimo ejecutado con NextAuth y PostgreSQL 15 de Docker: alta única, consulta, detalle, corrección de importe con motivo e historial, guardado de plan semanal, generación de un periodo y recuperación del mismo cargo al repetir ese periodo. El ejemplo persistente es inscripción de Monarcas Morelia por 125.75 MXN tras corregir 100.50 MXN. Pumas tiene un plan de cancha de 75.50 MXN y el periodo 04–10/01/2027, con vencimiento 15/01/2027. Los importes son datos ficticios de prueba.

La captura semanal guarda un plan. La generación ocurre desde el listado para cada periodo de siete días dentro de la ventana. El usuario aceptó esta generación manual y el bloqueo de modificaciones cuando existe cualquier pago. Propuso automatizar arbitraje por partido. Falta concretar su devengo, importes y relación con programación/resultado.

La multa permanece bloqueada en servidor hasta que PDGLD-27 publique una resolución verificable y exigible. Las consultas de saldo y evento confirmado para las historias consumidoras están definidas. [Integridad, contratos y seguridad](../architecture/billing-integrity.md)

## Archivos y comprobaciones de esta entrega

- `src/features/billing/server/` contiene autorización, catálogo, consultas, servicio transaccional y consultas para consumidores. `actions.ts` obtiene acuses reales. Las rutas y componentes existentes consumen esos datos.
- `prisma/migrations/20261125010000_pdgld175_charge_integrity/` añade unicidad y protección de correcciones/pagos. Se aplicó a Docker local después de comprobar que no había duplicados. El plan de ACL/RLS remoto queda documentado para revisión.
- Los scripts `seed-treasury-demo.mts`, `seed-app-local-scenarios.mts`, `seed-local-competition.mts`, `seed-local-player-photos.mts` y `seed-local-private-documents.mts` preparan y conservan los escenarios locales. Los PDFs nuevos se cargaron únicamente al Storage de pruebas autorizado. Las dos fotos originales se conservaron.
- Pasaron TypeScript y ESLint de los archivos afectados durante la implementación. Se recorrió el flujo mínimo en Chrome con sesión real y se guardaron capturas en `.codex-attachments/pdgld-77/175-docker-detalle.png` y `175-docker-generacion.png`.
- La batería final de concurrencia, rollback, revocación, claves reutilizadas con otro contenido y regresión sigue pendiente para PDGLD-176, después de la prueba manual solicitada.

## Para retomar

Primero recoger la prueba manual del usuario en Docker. Revisar la corrección del cargo y generar otro periodo del plan de Pumas, por ejemplo 11–17/01/2027, con vencimiento 22/01/2027. Repetir el periodo debe recuperar el mismo cargo. Usar Secretaría para consulta y un delegado para comprobar el alcance de su club.

Después cerrar decisiones de integración de multas y de arbitraje por partido, revisar el plan privado de permisos y desarrollar la etapa de tests de PDGLD-176. La historia permanece abierta. Esta entrega conserva los cambios sin commit ni push.

## Registro histórico de PDGLD-174

## Para revisar

- Rama `feat/PDGLD-77-cargos-tesoreria`. Base inicial `origin/develop` en `0bded09`, con el refactor de gestión integrado. [Historia](https://victoranhernandez.atlassian.net/browse/PDGLD-77) · [Contrato y vistas](https://victoranhernandez.atlassian.net/browse/PDGLD-174)
- Vista previa local en [Tesorería → Cargos](http://127.0.0.1:3177/treasury/charges). En esta instancia aislada, entra con `tesoreria-174` para consultar y simular el alta, `consulta-174` para solo lectura, o `disciplina-174` y `delegado-174` para probar la denegación. Las cuentas usan la contraseña de la sección «Demostración manual desechable» de la [guía de autenticación](../authentication.md#demostración-manual-desechable). En el servidor habitual de desarrollo usa una cuenta operativa con `billing:READ` y `billing:CREATE`, según la acción.
- En **Cargos**, filtra por Apertura de prueba para ver inscripción de Atlético Vista Verde y arbitraje de Mirador Juvenil. Abre el detalle de la inscripción para ver el cambio de vencimiento y su motivo. En Clausura de prueba, el cargo de cancha para Deportivo Mirador muestra un pago parcial de ejemplo. Filtrar por Multa muestra el estado vacío. [Error simulado del listado](http://127.0.0.1:3177/treasury/charges?demo=error)
- En **Nuevo cargo**, selecciona Apertura de prueba, Equipo, Mirador Juvenil, Arbitraje y Semanal. Usa importe `175,50`, vencimiento de referencia `20/11/2026`, periodo `09/11/2026–29/11/2026` y un motivo de prueba. Revisa el destinatario, el importe por semana y la ventana. Confirma en el diálogo. Repite con modalidad Único y destinatario Club. La opción Multa explica el vínculo pendiente y bloquea la revisión.
- Las variantes [rechazo](http://127.0.0.1:3177/treasury/charges/new?response=error), [acuse perdido](http://127.0.0.1:3177/treasury/charges/new?response=uncertain) e [intento sin aplicar](http://127.0.0.1:3177/treasury/charges/new?response=retry) conservan la captura. En los dos casos inciertos, usa **Consultar resultado**. El último habilita el reintento con los mismos datos e identificador una vez conciliado. La captura vive en la página hasta que sales o recargas.

## Verificación local

- Chrome con sesión NextAuth y PostgreSQL 17 aislado. Se comprobó el acceso directo sin sesión, el alta de Tesorería con ámbito de liga, la consulta de Secretaría y la denegación para Disciplina y Delegación. También se comprobó el detalle ausente.
- Con datos y respuestas de cargos sintéticos se recorrieron filtros y retorno desde el detalle, vacío, error, validación de importe y multa bloqueada, alta única y semanal, foco inicial y devolución de foco con Escape, doble pulsación, respuesta incierta, consulta y reintento. Se revisaron claro y oscuro en escritorio de 1440 px y móvil emulado de 360 y 390 px. PostgreSQL conservó cero cargos, planes y pagos tras la prueba.
- Capturas locales en `.codex-attachments/pdgld-77/`: listado claro y oscuro, detalle con historial, revisión semanal, diálogo de confirmación, respuesta incierta y resultados de ambas modalidades. La carga de navegación usa la convención `loading.tsx` de Next.js.
- Pasaron `npm run typecheck`, ESLint para los archivos afectados, 16 comprobaciones del contrato y las 31 pruebas de `npm run test:affiliation-review` tras reutilizar la advertencia de salida.

## Contrato propuesto

| Operación | Entrada y autoridad | Salida o error |
| --- | --- | --- |
| Consulta de listado | `billing:READ` y ámbito efectivo. Temporada, destinatario, concepto y mes opcionales. El mes filtra por solapamiento con el periodo. | Resumen del cargo con contexto autorizado, importe, periodo, vencimiento y proyección de pagos/saldo. Colección vacía, denegación o error de consulta. |
| Consulta de detalle e historial | ID de `charges`; `billing:READ` autorizado contra la temporada y el club resuelto. | Datos del cargo, versión, emisión, proyección de pagos/saldo y eventos con fecha, actor visible, motivo y cambios pertinentes. Denegación o recurso ausente según la política de exposición acordada. |
| Alta única o solicitud semanal | `billing:CREATE` en el ámbito resuelto. `operationId` UUID, `seasonId`, destinatario discriminado, código de concepto, importe decimal, fechas de periodo/vencimiento, modalidad y motivo. | Acuse `CONFIRMED` tras aplicar la operación, con los IDs de cargos. Rechazo explícito por validación, permisos, contexto cambiado, duplicado, política pendiente o resolución indisponible. Un timeout deja el resultado sin confirmar. |
| Consulta de operación | Mismo `operationId`, con identidad y alcance revalidados en servidor. | Acuse existente, intento confirmado como no aplicado o resultado aún incierto. Solo un resultado conciliado habilita el reintento de la misma intención. |
| Corrección futura | `billing:UPDATE`, ID, versión esperada, motivo y operación estable. | Nueva versión con historial, conflicto de versión, denegación o bloqueo por política de pagos/cancelación. |

`charge_concepts` contiene `REGISTRATION`, `REFEREE_FEE`, `VENUE` y `FINE`. El servidor resolverá `charge_concept_id` por código. Para club, `charges.club_id` y `season_id` remiten a la afiliación. Para equipo, `season_team_id` corresponde a la inscripción de ese equipo en temporada. Liga y categoría salen de las relaciones, y para comprobar el equipo RBAC recibe `teams.id`. El club tiene alcance de temporada. La categoría se muestra para el equipo.

El baseline usa `Decimal(12,2)`, monto positivo y `MXN`. La captura conserva cadenas decimales normalizadas y el formato solo representa lo que admite el esquema actual. Los importes son ejemplos. La fecha de emisión se resolverá en servidor y el baseline exige que el vencimiento sea igual o posterior. La demostración valida el orden de fechas del periodo sin definir un calendario de Liga.

`billing_plans` modela `ONCE` y `WEEKLY`, importe y ventana. `charges` tiene unicidad por plan e inicio de periodo y por `sanction_id`. Sigue pendiente concretar la unicidad por concepto/destinatario/periodo entre solicitudes distintas y el acuse de la operación. Para multa, PDGLD-27 debe entregar una referencia de resolución verificable que se pueda enlazar a la sanción del esquema. El vínculo y su autorización se resuelven en servidor al integrar.

`charge_balances` calcula saldo descontando pagos vigentes. Crear un cargo no registra un pago. `charges` ya dispara el trigger de auditoría y exige `app.user_id` y `app.reason` transaccionales. La revisión futura debe evitar duplicar ese evento y acordar cómo vincularlo al acuse. Identidad, concesiones, datos crudos de auditoría y finanzas quedan en gestión. El acceso de demostración exige una concesión real de Cobranza sin restricción a un club, porque la muestra abarca varios clubes ficticios. La consulta oficial futura de PDGLD-77 debe restringir al delegado a su propio club.

## Punto de reanudación

- Rutas en `src/app/(management)/treasury/charges/`. Contratos y vistas en `src/features/billing/`. La navegación usa los permisos efectivos existentes. [Diseño del recorrido](../design/treasury-charges.md)
- Pendientes de decisión de Liga: tarifas, política monetaria y precisión, vencimiento, día y cortes de la recurrencia, y corrección o cancelación de cargos con pagos. La vista semanal presenta la ventana solicitada. No calcula ocurrencias ni total acumulado.
- Al retomar, recoger comentarios de interfaz y acordar las reglas pendientes antes de conectar transacciones, idempotencia, controles de ámbito por registro y auditoría. Validar persistencia, concurrencia y rollback en su etapa de integración. [Implementación PDGLD-175](https://victoranhernandez.atlassian.net/browse/PDGLD-175) · [Aceptación PDGLD-176](https://victoranhernandez.atlassian.net/browse/PDGLD-176)
