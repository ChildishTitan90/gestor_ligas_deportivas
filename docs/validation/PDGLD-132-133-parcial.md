# PDGLD-132 y PDGLD-133: avance independiente

## Versión integrada local — 20 de noviembre de 2026

La rama contiene cambios locales aún sin commit: programación aprobada que crea
partidos y reservas, reprogramación con validaciones y PDF actualizado, opción de
dejar un partido no programado y cancelación de un partido en revisión sin resultado.
La confirmación oficial y corrección de cédulas siguen pendientes de PDGLD-29 y
de la integración disciplinaria; no se deben presentar como terminadas.

En esta revisión pasaron `npm run test:match-transitions` (7 pruebas),
`npm run test:match-report-tactics` (23), `npm run test:scheduling` (23) y
`npm run typecheck`. Estas pruebas no sustituyen el recorrido completo.

- **Aprobado localmente, 20 de noviembre:** `npm run test:match-transitions-db`
  sobre PostgreSQL 15 temporal aislado, con las 58 migraciones de la rama aplicadas.
  La prueba cubre permisos y alcance, reenvíos, concurrencia, historial, rollback,
  reservas y protección de partidos finalizados. La confirmación oficial completa
  continúa bloqueada por sus dependencias y no queda acreditada por esta prueba.
  PostgreSQL 17 y CI remoto de esta versión siguen pendientes.
- **Pendiente:** revisar la prueba de navegador de reprogramación, que falló en
  esta ejecución, y repetirla hasta obtener un resultado completo.
- **Pendiente:** recorrido funcional integrado y CI de GitHub de la versión final.
  Los cambios actuales no tienen commit ni push, por lo que no hay CI para ellos.

### Contrato de confirmación de cédula (PDGLD-134)

El 20 de noviembre `npm run test:match-reports` pasó con PostgreSQL 15
desechable, permisos Preview/RLS y recorrido HTTP. Incluye intentos concurrentes
de confirmación bloqueada sin efectos y comprueba el adaptador de incomparecencia
con receptores simulados. Esto no acredita la confirmación oficial completa ni
la actualización real de clasificación o expedientes. El servicio de clasificación
PDGLD-29 sigue pendiente; el receptor disciplinario aún no está conectado ni
validado en esta transacción. Cuando se integren, probar confirmación real,
reenvío sin duplicados y reversión de todos los efectos ante fallos.

#### Vínculos y alcance por historia

| Historia | Integración observada en esta rama | Evidencia y límite |
| --- | --- | --- |
| [PDGLD-18 — Cédula](https://victoranhernandez.atlassian.net/browse/PDGLD-18) | Captura y protección de confirmación: [servicio](../../src/features/match-reports/server/service.ts) y [contrato de efectos](../../src/features/match-reports/server/confirmation-effects.ts). Jira figura «Hecho», pero el cierre oficial sigue bloqueado en esta rama. | [Prueba de cédula](../../tests/integration/match-reports.ts): PostgreSQL 15 real, permisos Preview/RLS y HTTP; confirmaciones concurrentes bloqueadas, sin resultado ni historial. No acredita un cierre exitoso. |
| [PDGLD-25 — Ajustar propuesta](https://victoranhernandez.atlassian.net/browse/PDGLD-25) | La programación aprobada se conecta a partidos y reservas; la reprogramación individual y su PDF usan el [servicio](../../src/features/matches/server/reschedule.ts) y el [PDF actualizado](../../src/features/scheduling/server/updated-schedule-pdf.ts). Jira figura «En desarrollo». | [Prueba de transiciones](../../tests/integration/match-transitions.test.ts) aprobada con PostgreSQL 15, incluidos cambios y reservas; PostgreSQL 17, recorrido completo y CI pendientes. No implica confirmar una cédula. |
| [PDGLD-29 — Clasificación](https://victoranhernandez.atlassian.net/browse/PDGLD-29) | Jira figura «En desarrollo»; no hay receptor de clasificación conectado al cierre en esta rama. | El [contrato de efectos](../../src/features/match-reports/server/confirmation-effects.ts) define la integración requerida. En la [prueba de incomparecencia](../../tests/integration/match-reports.ts), clasificación y expedientes son contadores simulados; no se valida su actualización real. |

El [adaptador de finalización](../../src/features/matches/server/report-finish.ts)
se prueba con PostgreSQL en [transiciones](../../tests/integration/match-transitions.test.ts),
pero no sustituye la confirmación integral. La prueba de incomparecencia usa una
transacción real revertida al final y receptores simulados; verifica el resultado
y el reenvío dentro de esa transacción. El [receptor disciplinario preparado](../../src/features/match-reports/server/incident-cases.ts)
está desconectado. El 20 de noviembre se probó en PostgreSQL 15 temporal con el
rol Preview/RLS: crea expedientes por segunda amarilla, expulsión directa e
incidente grave; el reenvío no duplica y un rollback elimina los cambios. Aún
faltan la integración transaccional completa, PostgreSQL 17 y comprobar los
permisos de producción antes de habilitar el cierre.

El servicio implementa programación, confirmación, inicio, suspensión y cancelación con versión, motivo, autorización e historial. El inicio y la suspensión corresponden al capturista autorizado de la liga. La pantalla `/matches/recording` presenta estas acciones según permisos y estado, con navegación por páginas de 50 partidos.

La prueba `test:match-transitions-db` usa PostgreSQL temporal y comprueba permisos, aislamiento de la consulta del capturista, reenvíos, concurrencia, historial y reservas. `test:match-transitions` cubre reglas y selección de acciones. CI ejecuta estas comprobaciones con Node.js y TypeScript, sin Chrome para las transiciones de partidos. `test:match-transition-browser` queda como herramienta opcional local con respuestas sintéticas; ya no es un paso de CI. La interacción visual requiere validación manual o esa herramienta opcional.

La paginación se verifica con 55 partidos sintéticos en PostgreSQL temporal, sin duplicados ni omisiones. `npm run test:match-transitions-preview` inicia sesión por HTTP, comprueba la página autorizada, ejecuta la transición y su reenvío con Prisma bajo el rol limitado `gestor_ligas_preview`, y verifica versión, estado e historial persistidos. Una nueva petición HTTP debe mostrar «En curso» y la acción «Suspender partido». No simula clics ni depende de hidratación o mensajes transitorios de React. La invocación del servicio comprueba la lógica y los permisos de base, pero no sustituye el envío del formulario mediante una Server Action.

Validación local del 13 de noviembre de 2026: pasó la integración Preview con `CHROME_BIN` apuntando a un ejecutable inexistente, confirmando que no se lanza Chrome. Pasaron las siete pruebas de reglas/presentación, TypeScript y ESLint de los archivos de código modificados. Falta ejecutar CI remoto con este cambio. Las capturas y verificaciones de foco documentadas previamente corresponden al recorrido anterior y no se regeneran en esta suite.

Ambas subtareas permanecen abiertas. La reprogramación individual está implementada en la rama local; su recorrido integrado y CI están pendientes. La confirmación de cédula, resultado, clasificación y expediente disciplinario requieren completar su integración. No se aplica sanción automática.

## Recuperación de respuesta incierta

La interfaz conserva el identificador de operación, la versión, el destino y el motivo
después de una respuesta incierta. Es posible cerrar y reabrir el diálogo y enviar
exactamente el mismo contenido. Mientras exista una solicitud incierta se advierte al
salir de la página, y no se presentan otras acciones para el mismo partido. El servidor
revalida permisos y recupera el acuse sin repetir efectos. Un error definitivo muestra
su causa y no se presenta como envío incierto. La captura no sobrevive a una recarga.

La prueba de navegador simula una respuesta incierta, cierra y reabre el diálogo y
comprueba que el segundo envío conserva todo el contenido. Las pruebas de servidor
preexistentes verifican reenvíos, concurrencia, alcance e historial en PostgreSQL.
