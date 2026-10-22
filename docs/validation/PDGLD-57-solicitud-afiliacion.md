# Evidencia local — PDGLD-57

Fecha: 21/10/2026. Base inicial: `origin/develop` en `00d749f` (PR #18).
Rama de trabajo: `feat/PDGLD-57-solicitud-afiliacion`.
Entorno instalado: Windows, Node 24.21.0, npm 11.19.0, PostgreSQL 15 local,
Prisma 7.10.1, Next 16.4.0. No se instalaron ni actualizaron dependencias.

## Resultados ejecutados

| Comprobación | Resultado |
| --- | --- |
| Prisma validate / generate | Correctos |
| Migraciones desde cero y migrate diff contra schema | Sin diferencias, en base temporal del runner |
| test:affiliation-input | 13 pruebas aprobadas (contrato nuevo y captura existente) |
| test:affiliations | 13 escenarios HTTP/DB y prueba agrupadora aprobados |
| test:auth | Todas aprobadas: políticas de sesión/login (6 y 3), autorización TypeScript (35), suites HTTP (80) |
| test:ci | 12 aprobadas |
| test:account-form | 12 aprobadas |
| typecheck / lint | Sin errores |
| build | Correcto; incluye `/api/affiliations` |
| ci:guard-migrations | Migración inicial intacta |

Los 13 escenarios del backend cubren:

1. Denegación sin sesión, sesión restringida, roles distintos y clubes ajenos.
2. Origen, tipo de contenido, JSON malformado, tamaño y campos de autoridad extra.
3. Temporada/liga y categorías inconsistentes o inexistentes.
4. Tres firmas obligatorias y validación de propiedad/metadatos.
5. Persistencia de PENDING, tres directivos, categorías y exactamente una auditoría
   mínima sin nombres/firmas. Sin equipos nuevos ni cambios de nombre operativo.
6. Reenvío con misma clave/captura: mismo folio; datos cambiados: 409.
7. Revocación de CREATE con la misma sesión, incluso al recuperar un envío.
8. Asignaciones futuras/vencidas con la misma sesión.
9. Cuatro peticiones simultáneas iguales: un 201, tres 200 y un único agregado.
10. Claves distintas simultáneas para club/temporada: un 201 y un 409.
11. Fallo real en PostgreSQL al insertar el tesorero: rollback de afiliación,
    personas, categorías, directivos y auditoría; reintento posterior correcto.
12. Temporada cerrada: altas denegadas; recuperar confirmación no escribe.
13. FK compuestas rechazan categorías de otra temporada incluso fuera del servicio.

El runner crea y elimina exclusivamente su base `pdgld48_test_<aleatorio>` y su
servidor temporal. No aplica la migración a la base habitual de desarrollo,
no altera cuentas compartidas y no conecta a Supabase. Los registros de archivos
son sintéticos: estas pruebas no comprueban almacenamiento físico o descarga.

## Incidencias resueltas durante la verificación

El sandbox no permitió la conexión inicial al PostgreSQL loopback; las suites se
ejecutaron con autorización fuera del sandbox. Un fixture inicial intentaba crear
un delegado sin club: PostgreSQL lo rechazó con su CHECK existente. Se corrigió el
fixture sin cambiar la restricción. Las ejecuciones posteriores fueron exitosas.
El aviso de Next/Node sobre fallback de workerThreads a childProcesses se mantiene;
esta compilación terminó correctamente sin forzar la opción insegura.

## Pendientes para cierre y despliegue

- Revisión por otra persona y CI remoto del PR, incluidos PostgreSQL 15/17. Solo
  PostgreSQL 15 se ejecutó en esta máquina; no atribuirle evidencia local de 17.
- Aplicar migración revisada en el entorno de pruebas que utilizará el equipo.
- PDGLD-59: carga/descarga privada de firmas y conexión del formulario al contrato.
  No se afirma haber probado el recorrido completo desde navegador con documentos.
- Revisar el plan de seguridad de la nueva tabla antes de producción; el guard
  CREATE TABLE sigue activo. No se aceptó el riesgo ni se habilitó su despliegue.
- PR integrado y aceptación pertinente conforme a la DoD. No se hizo commit,
  push, merge o modificación de Jira desde esta implementación.

HU01-01 permanece independiente de esta entrega de backend y requiere sus otras
subtareas; aprobación/correcciones de HU01-02 no se implementan aquí.
