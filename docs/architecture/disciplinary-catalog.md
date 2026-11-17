# PDGLD-26: inventario y contrato inicial del catálogo disciplinario

Revisión: 13/11/2026. Base: `origin/develop`, commit `95a9280`. Alcance: primer punto de la guía de ejecución; inventario técnico y decisiones pendientes, sin implementar mantenimiento ni activar reglas disciplinarias.

Fuentes de negocio: [PDGLD-26](https://victoranhernandez.atlassian.net/browse/PDGLD-26) y [PDGLD-69](https://victoranhernandez.atlassian.net/browse/PDGLD-69). La primera está En desarrollo y no tiene subtareas; la segunda permanece Por hacer. No consta en su descripción un catálogo validado por la Liga. La confirmación humana sigue pendiente; este inventario no la sustituye.

## Estructura existente

Fuente: `prisma/schema.prisma` y `prisma/migrations/0_init/migration.sql`.

| Entidad | Datos y función existente |
| --- | --- |
| `competition_rules` | Reglamento/convocatoria por `season_id`, con `version_number`, estado, archivo y aprobación. Unicidad por temporada y versión. |
| `regulation_articles` | Artículo con `competition_rule_id`, `number`, `description`, `sanction_type_id` y `parameters` JSON. Número único dentro de una versión de reglamento. |
| `sanction_types` | Códigos MATCHES, MATCHDAYS, TIME, FINE, MATCH_FORFEIT, POINTS_DEDUCTION y TEAM_WITHDRAWAL. Son tipos técnicos, no artículos ni tarifas aprobadas. |
| `disciplinary_cases` / `disciplinary_rulings` | Expediente por temporada y resolución versionada por expediente. Una resolución puede reemplazar otra. |
| `sanctions` | Enlaza resolución y artículo exacto; registra destinatario, tipo, cantidad/importe, fechas y bloqueo. |
| `team_withdrawals` | Conserva referencia al artículo para bajas. |
| `sanction_fulfillments` | Cumplimientos por partido o jornada con índices únicos para evitar duplicidad por sanción. |

Relación de versión ya disponible: `regulation_articles.competition_rule_id → competition_rules.id → season_id → seasons.league_id`. La versión del catálogo se identifica por el UUID de reglamento y su número de versión en la temporada. La referencia histórica sigue `sanctions.article_id → regulation_articles.id`; no debe resolverse buscando el artículo más reciente por número.

No se necesita crear otra tabla de versiones para expresar esta relación inicial. Una nueva versión deberá tener artículos con nuevos UUID y conservar los anteriores; el mecanismo de copia/publicación queda para la implementación posterior.

## Reglas y límites encontrados

- `protect_approved_rules`, mediante `versioned_rules`, `versioned_parameters` y `versioned_articles`, impide modificar/eliminar reglas aprobadas y agregar, modificar o eliminar sus artículos/parámetros. Comprueba el reglamento de origen y destino al mover un artículo.
- Las claves foráneas conservan las referencias y evitan borrar artículos utilizados. No equivalen por sí solas a impedir UPDATE de un artículo referenciado cuyo reglamento siga en borrador. La implementación debe cubrir ese caso y la concurrencia entre aprobación y edición con pruebas reales.
- `parameters` es JSON con valor predeterminado `{}`; el modelo no define un contrato tipado por consecuencia. No asumir que valida unidades, importes, destinatarios o excepciones.
- Las restricciones de `sanctions` exigen un solo destinatario (inscripción o equipo), cantidades/importes positivos cuando existen, fechas coherentes, cantidad para partidos/jornadas/puntos, fecha final para tiempo e importe para multas. Son controles sobre sanciones aplicadas; no validan automáticamente el JSON del catálogo.
- Un artículo tiene un único `sanction_type_id`. Debe confirmarse si un artículo real combina consecuencias antes de decidir si hace falta ampliar ese modelo.
- El catálogo no resuelve expedientes, descuenta sanciones ni registra pagos. Esas operaciones corresponden a PDGLD-27/28 y sus integraciones.

## Permisos y reutilización

Fuentes: `prisma/permissions-data.ts`, `src/server/auth/authorization.ts`, `src/server/auth/authorization-domain.ts`, `docs/architecture/permissions.md` y `scripts/preview/runtime-plan.mjs`.

La Comisión (`DISCIPLINARY_BOARD`) tiene CREATE/READ/UPDATE/APPROVE en `discipline`. SUPERADMIN tiene READ en esa matriz, mientras PDGLD-26 solicita mantenimiento también para SUPERADMIN. Resolver explícitamente la discrepancia antes de conceder escrituras; no ampliar permisos de todas las operaciones disciplinarias de manera incidental.

Reutilizar `getPermissionGrants`, `assertPermission` y la resolución de contexto. Obtener temporada/liga desde la versión de reglamento en servidor; no confiar en una liga enviada por el formulario. Un permiso genérico de disciplina concedido a un delegado no lo convierte en administrador del catálogo. La aprobación del presidente se limita a bajas según la matriz documentada.

`assertSeparationOfDuties` ya contempla resolución disciplinaria basada en el expediente y autor de la cédula; no confundirla con autorización para mantener artículos.

El plan de Preview actual no incluye `regulation_articles` ni `sanction_types` entre las tablas de lectura del catálogo. La futura entrega deberá definir permisos SQL y RLS mínimos, además del RBAC de aplicación, y validarlos con el rol limitado. La existencia de modelos Prisma no acredita un servicio funcional de catálogo.

## Decisiones pendientes en PDGLD-69

1. Documento validado, temporada y versión de convocatoria a los que pertenece cada artículo.
2. Número, texto, destinatarios, tipos de consecuencia, unidades y valores permitidos; consecuencias combinadas y excepciones.
3. Vigencia, aprobación y relación entre publicación del reglamento y activación del catálogo.
4. Autoridad de mantenimiento/aprobación y resolución de la discrepancia de SUPERADMIN.
5. Para PDGLD-27/28: cómputo de cumplimiento, plazos, autoridad de recursos y efecto suspensivo. No inventarlos para completar el catálogo.

Se puede desarrollar un contrato técnico con datos sintéticos sin activar reglas reales. No cargar artículos, importes ni duraciones supuestos como datos oficiales.

## Siguiente entrega y verificación

### Referencia de Morelia y ejemplos acordados

Acuerdo del usuario, 13/11/2026: usar documentos de la Liga Municipal de Morelia como referencia para el diseño y permitir ejemplos sintéticos mientras se validan las reglas oficiales. PDGLD-69 condiciona la activación de reglas reales, no el desarrollo de contratos, borradores y pruebas.

Fuente consultada: [convocatoria 2024–2025, copia alojada en AF Deportes](https://afdeportes.com.mx/wp-content/uploads/2024/08/convocatoria-liga-municipal-2024-2025-1.pdf), fechada en agosto de 2024. Es un antecedente histórico; no se ha confirmado su vigencia para la temporada del proyecto. En I.f remite a los artículos 70.d y 71 para sanciones relacionadas con obligaciones de representantes; II.d remite al reglamento por incumplimiento del mínimo de jugadores. La convocatoria no reproduce esas penas: sus cantidades y condiciones quedan pendientes de obtener del reglamento. No convertir cuotas de inscripción, arbitraje o mantenimiento en multas disciplinarias.

Para cada referencia, el contrato futuro debe conservar documento/URL, temporada, sección o artículo, fecha de consulta, origen (documentado o sintético) y estado de validación. Estos son requisitos de diseño, no campos ya implementados. Un ejemplo llevará código `DEMO-*`, etiqueta visible «Ejemplo de prueba» y solo se utilizará en entornos de prueba; no debe incorporarse al seed oficial de producción.

| Ejemplo enteramente sintético | Tipo técnico | Valor de prueba, sin atribución a Morelia |
| --- | --- | --- |
| DEMO-01: conducta antideportiva | MATCHES | 2 partidos |
| DEMO-02: infracción por jornada | MATCHDAYS | 1 jornada |
| DEMO-03: suspensión temporal | TIME | Intervalo de 7 días con inicio/fin explícitos |
| DEMO-04: infracción con multa | FINE | 100.00 MXN |
| DEMO-05: alineación indebida | MATCH_FORFEIT | Pérdida de partido; sin inventar marcador oficial |
| DEMO-06: infracción de equipo | POINTS_DEDUCTION | 3 puntos |
| DEMO-07: infracción grave de equipo | TEAM_WITHDRAWAL | Referencia a baja, sin ejecutarla automáticamente |

Los valores sirven exclusivamente para probar tipos y validaciones; no son propuestas de sanción oficial. El catálogo debe admitir cambios de texto, unidad y valores en borrador. Una versión aprobada o utilizada se conserva y el cambio posterior genera una versión nueva. La selección de un ejemplo no produce sanciones, cobros ni bajas por sí sola.

Definir validación del JSON por tipo confirmado, consultas por versión y ámbito, mantenimiento de borradores y protección de registros referenciados. Reutilizar auditoría transaccional con actor y motivo; comprobar la cobertura de triggers para cada escritura antes de añadir auditoría de aplicación. Construir posteriormente la pantalla con ManagementShell, SelectField y FormDialog.

Pruebas previstas: autoridad y liga correctas; rechazo de rol ajeno; duplicidad por versión; parámetros incompatibles; preservación de artículo histórico; edición concurrente con aprobación/referencia; permisos mínimos de Preview; consulta de identificadores/versiones por PDGLD-18 y PDGLD-27. Para lógica y persistencia usar Node.js/TypeScript y PostgreSQL temporal, conforme a la preferencia actual de no depender de Chrome en estas pruebas.

Esta entrega es una inspección de código, esquema e incidencias, sin ejecución ni modificación de bases. El inventario y la relación con versiones quedan documentados; el primer punto de Jira permanece parcialmente pendiente por la validación de PDGLD-69. No se modificó ni cerró ninguna incidencia.
