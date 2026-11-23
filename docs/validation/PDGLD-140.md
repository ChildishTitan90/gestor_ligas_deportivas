# PDGLD-140 — Pruebas de ajustes y revisión de propuestas

## Verificación de la integración posterior

La rama incorporó `origin/develop` en el commit `a73ba7b`, incluida la PDGLD-85.
Sobre esa versión pasaron `npm run typecheck`, las 23 pruebas de
`npm run test:scheduling`, las dos pruebas de acciones y estados de propuesta,
y los cuatro casos de `node --test tests/e2e/scheduling-proposals.test.mjs`
en móvil y escritorio, con temas claro y oscuro. Las pruebas de pantalla usan
respuestas simuladas; se ejecutaron con acceso a Chrome fuera de la restricción
que impedía arrancarlo en el entorno inicial.

También pasó `npm run test:scheduling:preview` en PostgreSQL 15 con RLS y el
perfil limitado de Preview, y `npm run test:scheduling:integration` en
PostgreSQL 15 y 17 con bases temporales aisladas. Estas pruebas usan actores y datos
sintéticos; no equivalen al CI de GitHub ni a un recorrido HTTP con RLS.

## Alcance de esta evidencia

Revisión del trabajo guardado en `feat/PDGLD-25-integracion` hasta el commit
`8e6e74b`. Los resultados siguientes son locales y usan datos sintéticos; no
representan un resultado de CI remoto ni prueban una versión posterior a la
integración con `develop`. La rama incluye avances de PDGLD-85 que deben
considerarse al preparar la integración y el PR.

## Resultados comprobados

| Criterio | Evidencia y alcance |
| --- | --- |
| Conflicto sobrevenido | En PostgreSQL, un bloqueo de cancha posterior a la generación impide guardar el ajuste o enviar la propuesta. También se comprueban horarios fuera de disponibilidad, encuentros solapados y autorizaciones de uso. |
| Edición concurrente y versiones | Dos ajustes diferentes con la misma versión producen un solo guardado; el otro se rechaza sin sobrescribirlo. Se comprueban versión obsoleta y auditoría del cambio ganador. |
| Transiciones y permisos | Se rechaza la edición cuando la propuesta está en revisión, la aprobación por el programador y operaciones de una cuenta sin ámbito. Se prueban envío, devolución y aprobación con sus motivos y actores. |
| Reservas y reversión | Enviar no crea partidos ni reservas; aprobar crea ambos, un reenvío no los duplica y un fallo provocado durante la creación revierte las escrituras y el estado. |
| Separación de publicación | Enviar, aprobar y activar una propuesta aprobada previamente no crean filas en `publications`. El flujo público y la prohibición de publicar la propia propuesta corresponden a PDGLD-81, aún pendiente. |

`npm run test:scheduling:integration` pasó con PostgreSQL 15 y 17 en bases
temporales, incluidos los casos ampliados de concurrencia, devolución, auditoría
y ausencia de publicación. El ejecutor elimina su base temporal; no activa RLS.
Las pruebas están en [scheduling-adjustment-shared.ts](../../tests/integration/scheduling-adjustment-shared.ts)
y [scheduling-loans.ts](../../tests/integration/scheduling-loans.ts).

`npm run test:scheduling:preview` pasó con PostgreSQL 15, RLS y el rol limitado
de Preview. Usó servicios reales y actores sintéticos para generación, ajuste,
intercambio revertido, revisión y aprobación, con casos de acceso denegado. No
fue una sesión de navegador con RLS. Véase
[scheduling-preview.test.ts](../../tests/integration/scheduling-preview.test.ts).

La prueba `node --test tests/e2e/scheduling-proposals.test.mjs` pasó con 4 casos
en Chrome, en 390 y 1440 píxeles, con temas claro y
oscuro, usando respuestas simuladas. El recorrido en la aplicación usó sesiones
de programador, autoridad y cuenta sin acceso, con datos sintéticos. Se generó,
ajustó, envió y aprobó una propuesta; en otra se intercambiaron equipos,
reasignaron canchas y se devolvió a borrador. El acceso a la base durante ese
recorrido fue de administrador, por lo que no demuestra RLS sobre HTTP. El
detalle y sus límites están en [PDGLD-139](PDGLD-139.md).

`npm run test:scheduling` pasó con 23 pruebas del motor, restricciones,
intercambio de equipos y contenido del PDF. También pasaron las dos pruebas
ejecutadas con `node --import tsx --test src/features/scheduling/proposal-actions.test.ts src/features/scheduling/components/proposal-status.test.tsx`,
así como `npm run typecheck` en la revisión de los cambios de interfaz. Estos
resultados corresponden a las ejecuciones locales documentadas antes de
integrar la versión final, no al CI de GitHub.

En la revisión original, `origin/develop` apuntaba a `7303aa8` y todavía no
estaba integrado. La verificación posterior y su commit se indican arriba.

## Pendiente antes de cerrar

- Verificar el CI de GitHub después de subir la rama. El workflow contiene la
  suite de integración, pero no hay resultado remoto para esta versión.
- Completar la validación HTTP con RLS si el entorno de aceptación la requiere;
  conservar por separado el alcance de las pruebas de servicio y de navegador.
- Revisar la presentación visual, contraste, teclado y arrastre manual, y
  enlazar el PR y la evidencia final. El usuario indicó que ya probó la descarga
  y apertura del PDF; no se repitió esa descarga en el recorrido documentado.

No cerrar la subtarea únicamente por esta evidencia local. La revisión por otra
persona y el CI corresponden al momento de preparar y subir la entrega.
