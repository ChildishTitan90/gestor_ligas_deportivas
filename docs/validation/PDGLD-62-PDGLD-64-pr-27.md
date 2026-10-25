# Descripción propuesta para el PR #27

## Título

PDGLD-62 PDGLD-64: inscripción de equipos e integración con revisión de afiliaciones

## Problema y cambio

El delegado necesita inscribir equipos de su club en categorías y grupos válidos,
sin duplicar su participación anual ni perder historial. El backend ofrece opciones,
consulta paginada y alta de equipo existente o nuevo, con estado inicial REGISTERED,
permisos vigentes, transacción, idempotencia persistente y auditoría mínima.

Se recibe el PR #28 de Checo desde origin/develop (`a9c6810`) y se conservan la
aprobación real, correcciones/reenvíos, versión de revisión, firmas precargadas,
control de respuestas inciertas e aislamiento de Storage en pruebas.
Los tres conflictos se resolvieron conservando ambos trabajos; se mantiene Next
y eslint-config-next 16.4.3 con lockfile coherente. Se corrige el ajuste de nombres
largos de temporada en la bandeja sin rediseñarla.

## Integración y dependencias pendientes

- La aprobación de afiliación ya funciona mediante el servicio real de PDGLD-60.
  Su contrato actual no registra authorized_by/authorized_at por categoría.
- La inscripción sigue exigiendo esa autorización explícita y devuelve
  CATEGORY_NOT_AUTHORIZED si falta. Aprobar no autoriza automáticamente lo solicitado.
- Checo coordina la operación de autorización; si necesita selección en pantalla,
  se acordará con Nick. Este PR no incorpora selección ni aprobación alternativas.
- PDGLD-64 prueba solicitud → aprobación real → rechazo por categoría no autorizada.
  Usa expectedVersion del detalle vigente y sesiones reales de delegado/secretario.
  Las inscripciones positivas aisladas utilizan fixtures autorizados en otra
  temporada; no equivalen a completar el recorrido real todavía pendiente.
- PDGLD-63 integrará las vistas contra docs/architecture/team-enrollment.md.
- La transición a ACTIVE sigue pendiente de definición de negocio. La aprobación
  no activa equipos. No se implementan nuevas bajas, rechazos o suspensiones.

## Validación local

- Tipos, lint y build con Next 16.4.3.
- Inscripción: 17 resultados aprobados, con permisos, duplicados, concurrencia,
  reintentos, rollback, auditoría e historial.
- Autenticación: políticas 6 + 3, autorización TypeScript 39 y HTTP 92 aprobadas;
  incluye aprobación, correcciones, reenvío y concurrencia de PDGLD-60.
- Contratos de afiliación: 15; revisión/reenvío: 27; firmas: 42; cuentas: 12;
  configuración de conexión: 6; controles del pipeline: 18, aprobadas.
- Layout real del componente: ocho casos con nombres largos, con/sin espacios,
  en 320/375/768/1280 px, sin desbordamiento horizontal.
- Migraciones reconstruidas sin diferencias en PostgreSQL local temporal.
  La matriz PostgreSQL 15/17 del workflow conserva las suites de ambas ramas.
- Seed: 19 + 7 resultados aprobados, con rollback, concurrencia, conservación
  de identidad y limpieza del contenedor temporal.

## Migraciones y seguridad

Se conservan todas las migraciones compartidas. Se recibieron mediante migrate
deploy y generate en el Docker local verificado, conservando los conteos de datos.
No se modificó Supabase ni se usó reset/db push. No se autorizaron categorías por
migración. Continúa la política de RLS y el despliegue manual existentes.

Permanecen los avisos conocidos de zod y fast-uri para seguimiento en PDGLD-71;
no se ejecutó audit fix --force.

## Estado de publicación

Esta descripción es una propuesta local. La integración está preparada sin commit
ni push; no se editaron el PR o Jira ni se ejecutó un merge de PR o despliegue.
No se atribuye una nueva ejecución de CI remoto hasta publicar estos cambios.

Evidencia: docs/validation/PDGLD-62-PDGLD-64-integracion-pr28.md.
