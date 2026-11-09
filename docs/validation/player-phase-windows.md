# PDGLD-103 — entrega reconstruida de ventanas

Base: develop 26081d0 (PR #44). Fases de altas por categoría y temporada, con nombre, apertura/cierre locales a precisión de segundos; inicio incluido, cierre excluido. Intersección con días semanales. Sin fases conserva reglas históricas. No impone horas de recepción física ni restringe bajas.

Se reutilizan autorización, bloqueos, versión y auditoría de player-policy. Se conserva la restricción de no sustituir política deportiva ya utilizada: configurar fases antes de registrar jugadores. No añade edición de ventanas sobre categorías en uso. Se conserva configuración al editar documentos. Migración adicional para INSERT de registros, sin backfill ni cambios de RLS.

21 pruebas puras aprobadas, tipos tras next typegen y ESLint de competitions aprobados. Pendientes: PostgreSQL 15/17, concurrencia SQL, revisión de interfaz con sesión real, CI y revisión independiente. No es una entrega lista para producción ni cierra PDGLD-15. No se ejecutaron migraciones sobre bases del usuario.
