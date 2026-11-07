# PDGLD-104: evidencia y aceptación pendiente

## Base y alcance de la comprobación

Base remota revisada antes y después del trabajo: develop 53c2628, más el
trabajo PDGLD-103 que el usuario ya había aplicado/confirmado. Se conservan
las funcionalidades de PDGLD-13/14 y PDGLD-121/122 integradas en esa base.
La nueva migración es 20261106020000_pdgld104_age_exception_receipts.
No se ha aplicado a gestor_ligas_dev ni a Supabase desde este trabajo.

## Ejecutado por el agente

- 8 pruebas de contratos y vigencia de la excepción: aprobadas.
- 36 pruebas puras existentes de políticas, admisión, documentos e identidad:
  aprobadas.
- Chrome 143, transporte sintético: 5 escenarios del panel más su prueba padre
  (6 resultados), aprobados. Foco, confirmación, recuperación sin otro POST,
  reintento del mismo cuerpo y pérdida de acceso/cambio de expediente.
- Regresiones de navegador de revisión, expediente, participación y bandeja:
  aprobadas con respuestas sintéticas. El filtro nuevo se añade al final para
  conservar el recorrido de teclado de los filtros existentes.
- Servicio Prisma contra PGlite con todas las migraciones, actores/contextos y
  documentos sintéticos: 8 casos nuevos más la prueba padre (9 resultados),
  aprobados. Incluyen carta ajena, captura explícita, ausencia de consulta CURP,
  rol/alcance, decisiones concurrentes, sustitución de carta, acuses, permisos
  revocados y guardia SQL. PGlite no demuestra concurrencia de PostgreSQL 15.
- Typecheck y lint: aprobados, sin advertencias.
- Build de producción Next.js 16.4.3: aprobado, con secreto efímero y conexión
  ficticia local para compilar, sin credenciales reales.

Las comprobaciones de navegador no son recorridos HTTP con sesión real.
No se han consultado las API reales de CURP/INE ni consumido sus créditos.
No se incorporan al proyecto las herramientas temporales usadas para PGlite
ni el binario Chrome de esta comprobación. No hay nuevas dependencias de npm.

## Comprobación en el equipo del usuario

Ejecutar desde el proyecto actualizado, antes de aplicar la nueva migración
sobre su base local de desarrollo:

```powershell
npm run typecheck
npm run lint
npm run test:age-exception
npm run test:age-exception-browser
npm run test:player-registrations
npm run build
git diff --check
```

El runner de registros ejecuta los casos nuevos al final de la suite sobre
PostgreSQL desechable. Configurar CHROME_BIN si el runner de navegador lo necesita.
Tras aprobar esa regresión, aplicar la migración por el procedimiento existente
de migraciones y verificar el estado del esquema. No usar reset ni db push.

## Aceptación manual pendiente

Con sesiones locales autorizadas, comprobar el expediente excepcional del
delegado, la carga privada y la decisión de Secretaría; repetir con cuenta
ajena y con permiso revocado. Confirmar que aceptar edad no habilita al jugador
ni aprueba tutor/CURP/documentos, y que una carta reemplazada exige otra petición.
Revisar ambos temas, escritorio, móvil y teclado con la interfaz real.

Ventanas por fase/horas y la aceptación integral de PDGLD-15 siguen pendientes.
Este documento no declara aprobada la historia completa ni el CI remoto.

## Revisión del ZIP y cierre del 6 de noviembre de 2026

Se retomó el ZIP de la rama `feat/PDGLD-15-validacion-edad-ventanas`, con
los commits locales PDGLD-103 `37e7b67` y `5df72a0` y los cambios sin commit
PDGLD-104. El archivo `.env` no se incorporó al entorno de ejecución ni a la
entrega. Se conservaron las migraciones recibidas y los contratos existentes.

Se corrigió el panel para bloquear un segundo refresco mientras está pendiente
la consulta inicial. Una prueba de navegador reprodujo primero el fallo y pasó
tras la corrección. El bloqueo se libera al terminar la consulta.

Comprobaciones de esta revisión, Node 24.22.1 / Next 16.4.3:

- Typecheck y lint: sin errores.
- Excepción de edad: 8 pruebas unitarias aprobadas.
- Política deportiva y admisión: 15 pruebas aprobadas.
- Documentos e identidad: 21 pruebas aprobadas.
- Controles de CI: 69 pruebas aprobadas.
- Chromium 153: 7 resultados del panel de excepción y 5 de regresión del
  expediente, participaciones, revisión y visor privado, aprobados. Transporte
  sintético; no equivalen a sesiones HTTP con base real.
- Build de producción: aprobado con secreto efímero y URL de base ficticia local.

La ejecución local de PostgreSQL está bloqueada por las restricciones de usuario
  del entorno del agente. No se afirma una nueva ejecución de la suite PostgreSQL
  en este entorno. La suite existente integra los casos PDGLD-104 y el workflow
  verifica PostgreSQL 15/17. Se habilita también su ejecución al publicar la rama
  `feat/PDGLD-104-excepciones-edad`, para verificarla antes del PR.

El usuario había informado 58 pruebas aprobadas en su PostgreSQL local antes
  de esta revisión; ese resultado es evidencia comunicada por el usuario.
No se accedió a su base local ni a Supabase ni a proveedores CURP/INE reales.

### Publicación remota

La consulta de permisos de la cuenta indicó `push: true`, pero la integración
rechazó crear el árbol Git con HTTP 403 (`Resource not accessible by integration`).
No se publicó la rama, no se abrió un PR y no se ejecutó CI remoto. La inclusión
de la rama en el workflow queda preparada para cuando se publique. Por tanto,
la verificación nueva en PostgreSQL 15/17 y la aceptación HTTP integral siguen
pendientes; no se declara la entrega completamente validada para integrar.
