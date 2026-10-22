# Revisión de producción pendiente — PDGLD-57

Responsable de coordinar revisión: Sergio. Revisor propuesto del backend y SQL:
Víctor, sujeto a revisión efectiva del PR. No representa aprobación ni aceptación
del riesgo. No se contactó ni se modificó Jira o Supabase desde esta implementación.

La nueva tabla `sports_management.club_affiliation_categories` registra UUID de
afiliación, temporada y categoría. No contiene nombres ni firmas, pero sus
relaciones pertenecen a un trámite privado. No debe consultarse desde clientes
de Supabase/PostgREST sin autorización de contexto.

El despliegue manual existente bloquea toda migración que crea tablas. Se mantiene
ese bloqueo hasta revisar lo siguiente, con evidencia en el PR:

1. Rol real de conexión del backend y sus privilegios mínimos; comprobar que no
   se usa un rol de navegador para la escritura del servicio.
2. Política RLS de la nueva relación en Supabase y de las nuevas columnas privadas
   en `club_affiliations`; comprobar acceso anónimo, usuario autenticado y acceso
   cruzado de club/liga con los roles reales. Revisar DEFAULT PRIVILEGES: la
   revocación incluida es defensa adicional, no sustituye RLS.
3. Mantener Docker sin RLS como decidió el equipo. El SQL específico de producción
   debe revisarse expresamente; no copiar una política basada en `auth.uid()` si
   la identidad actual es NextAuth y no Supabase Auth.
4. Verificar que los endpoints solo devuelven el DTO mínimo y que el bucket de
   firmas de PDGLD-59 es privado. Probar referencias de archivos ajenos y descarga
   por contexto, además de la validación de metadatos de PDGLD-57.
5. Acordar el mecanismo revisado de despliegue para esta migración. No retirar
   el filtro CREATE TABLE global ni forzar el pipeline para sortear la revisión.
6. Aplicar desde main mediante el flujo autorizado, verificar migraciones,
   permisos y prueba funcional; solo entonces documentar el despliegue realizado.

Hasta completar esos pasos, el backend y su migración pueden revisarse/probarse
localmente, pero el despliegue a Supabase y el cierre por DoD permanecen pendientes.
