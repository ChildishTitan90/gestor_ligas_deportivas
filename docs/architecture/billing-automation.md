# Emisión automática de cargos · PDGLD-77

Ampliación acordada con Víctor el 28/11/2026. No reemplaza la generación manual por semanas de siete días ni implica pagos.

## Reglas confirmadas

- Club: al aprobar su afiliación a una temporada; el alta inicial no tiene ese contexto.
- Equipo: al confirmar su inscripción en temporada/categoría.
- Arbitraje: una cuota por equipo con partido programado en cada jornada de fase regular. La deuda nace al programar, no al jugar ni por el mero transcurso de una semana. Descansos y borradores no cobran. Dos partidos del equipo en una misma jornada comparten cuota.
- Si se programa la fase regular completa de una vez, sus jornadas producen cargos en ese momento. El formulario y su revisión advierten este efecto; no se difiere el devengo a cada semana.
- Tesorería configura por temporada importe MXN `Decimal(12,2)`, días para pagar desde la emisión y rango de jornadas regulares. No existen tarifas ni plazos predeterminados de la Liga.
- Cambios de tarifa: revisión nueva y jornada inicial explícita. Conservan todos los cargos emitidos, pagados o pendientes. No conceden pagos a Secretaría, delegados, Programación ni Comisión.
- Liguilla: sin generación automática para ningún equipo de esa fase; quienes clasificaron se cobran manualmente. No se anulan deudas de fase regular al quedar eliminado.
- Afiliaciones/inscripciones anteriores a habilitar la política no se cobran retrospectivamente. Para arbitraje, habilitar una política incluye partidos ya programados en su rango y aún no cobrados; se advierte en revisión.

## Persistencia, autoridad y atomicidad

`billing_automation_policies` contiene mandatos inmutables/versionados, no deudas. `charges`, `charge_concepts`, `billing_plans` y `payments` conservan sus responsabilidades. El escritor `charge-writer.ts` es compartido con la emisión manual.

Cada política exige `billing:CREATE` por temporada completa; modificarla exige además `billing:UPDATE`. El actor procede de NextAuth. Se conserva UUID de intención, hash del contenido, versión esperada y motivo. Un UUID con contenido distinto se rechaza. El trigger existente audita su inserción dentro de la transacción.

Los hooks de afiliación, inscripción, materialización de calendario (incluida la activación de uno previamente aprobado), transición DRAFT→SCHEDULED y reprogramación se ejecutan dentro de la transacción del trámite. Vuelven a comprobar el mandato vigente de Tesorería y el destinatario real. El actor del trámite no adquiere permisos de finanzas. La auditoría del cargo identifica a quien autorizó el mandato; su motivo/origen enlazan la regla y el trámite. Después se restaura el contexto de auditoría del operador. Si falla SQL, se propaga el error original y se revierte la transacción; no se intenta restaurar configuraciones mediante otra consulta en una transacción ya abortada.

Unicidad adicional `charges.automation_source`: `CLUB_AFFILIATION:<affiliation-id>`, `TEAM_ENROLLMENT:<season-team-id>`, `REFEREE_MATCHDAY:<season-id>:<matchday-id>:<season-team-id>`. La referencia queda inmutable junto con la política original. Un reintento conserva cargos corregidos y no recalcula su deuda.

`20261128020000_billing_matchday_identity` conserva la unicidad manual por concepto/destinatario/periodo y permite jornadas automáticas distintas con las mismas fechas. Restricciones de exclusión GiST impiden combinar cargo manual y automático para el mismo contexto/periodo, incluso desde conexiones distintas. El origen UNIQUE protege la repetición de cada jornada. Un cargo manual incompatible bloquea el efecto automático para conciliación; no se adjunta un origen ficticio ni se duplica. La migración anterior aplicada permanece intacta.

## Integración con liguilla

Revisión de lectura del [PR #75](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/75), head `bc3e28a158bd6af7ff9f2987d7724cc20103e7ec`, sin integrarlo. Su código confirma una etapa `competition_stages.format.kind=PLAYOFF_8`, con categoría, llaves y `matches.stage_id`; la elegibilidad regular consulta `stage_id IS NULL`.

La automatización excluye todo partido con etapa y detiene cargos regulares de la categoría al aparecer esa etapa. El último número de jornada regular configurado es otra barrera explícita. No calcula clasificados ni llama internals del PR. Una fixture `PLAYOFF_8` demuestra exclusión del contrato, **no** la integración oficial de clasificación/llaves aún no integrada. La prueba conjunta deberá repetirse sobre el PR final.

## Ejecución y separación de entornos

Referencia del mecanismo: [Supabase Cron](https://supabase.com/docs/guides/cron) y [programación con pg_net/Vault](https://supabase.com/docs/guides/functions/schedule-functions). Se conserva el motor de negocio de la aplicación.

El evento de aplicación emite dentro de la operación real. Supabase Cron solo reconcilia partidos programados omitidos, usando el mismo motor de Node; no hay un segundo motor SQL/Edge financiero. No se necesita esperar una semana para emitir arbitraje. POST `/api/internal/billing/reconcile` exige secreto, entorno y proyecto; la conexión del backend debe coincidir con ese proyecto. GET autenticado acredita `billing-automation-v1` sin emitir cargos.

El instalador `scripts/billing/install-supabase-cron.mjs` valida TLS y conexión owner del proyecto explícito, migración aplicada y contrato GET de la aplicación desplegada. `--target=test|production` comprueba sin escribir; `--apply` instala/actualiza un único job por nombre cada minuto, referencias a Vault y cabeceras de entorno/proyecto. Nunca guarda el token en `cron.job.command`, usa la URL de Docker ni activa tarifas. El periodo de reconciliación es técnico; no define un calendario de cobro de Liga.

Pruebas requiere una aplicación desplegada conectada a **pruebas**. No apuntar el Cron de pruebas a Vercel si esa instancia está conectada a producción. La URL proporcionada `https://gestor-ligas-deportivas.vercel.app/` respondió HTTP 200; eso no acredita la versión nueva, su conexión ni acceso administrativo.

Variables privadas por destino: `BILLING_CRON_TEST_*` o `BILLING_CRON_PRODUCTION_*`, sufijos `PROJECT_REF`, `DATABASE_URL`, `CA_FILE`, `APP_URL`, `SECRET`. En cada deployment: `BILLING_CRON_SECRET`, `BILLING_CRON_ENVIRONMENT=TEST|PRODUCTION`, `BILLING_CRON_PROJECT_REF`. No versionar valores ni usar la clave de Storage como contraseña SQL.

## Seguridad y despliegue

El perfil privado también necesita INSERT de las 12 columnas que usa la materialización existente de partidos (incluidos estado y propuesta). Se incorpora esa capacidad SQL en runtime-plan.mjs, sin permitir insertar etapas de un PR pendiente ni cambiar concesiones RF22 de personas. La preparación de partidos bajo ese rol y la transición/emisión están comprobadas en la suite; la fixture masiva de calendario continúa identificada como preparación sintética, no como aceptación de todo el generador de calendarios.

Migración aditiva `20261128010000_billing_automation`: RLS solo al detectar Supabase, sin concesiones a PUBLIC/anon/authenticated/service_role. Plan exacto/checksum registrado en `production-plans.mjs`; no se elimina el control de despliegue manual desde main. Preview usa el plan privado existente con SELECT/INSERT de políticas y las dos columnas de origen de cargos; sin UPDATE/DELETE de políticas ni INSERT de pagos. En Production revisar las concesiones equivalentes para su rol backend privado antes de activar mandatos. Docker local conserva su decisión de RLS.

## Pendientes protegidos

Multas oficiales PDGLD-27 siguen bloqueadas. Cancelación, incomparecencia, retiro y eliminación del calendario no anulan ni devuelven automáticamente dinero; requieren el flujo y la regla que acuerde la Liga. Las correcciones con pagos permanecen bloqueadas. No habilitar tarifas reales como parte de pruebas o despliegue.
