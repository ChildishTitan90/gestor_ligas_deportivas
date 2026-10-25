# PDGLD-59 — Firmas, documentos privados y pruebas de envío

## Alcance

Integrar las firmas y documentos privados de la solicitud de
afiliación de un club y verificar el envío.

Referencias: RF01.1, RF01.2, RF01.5, RNF02, RNF04, RNF10 y RNF11
del ERS aprobado.

La generación del folio y la persistencia corresponden al backend
de PDGLD-57. El formulario base corresponde a PDGLD-58.
PDGLD-59 comprueba su integración.

## Datos de prueba

- Usuarios, clubes y directivos ficticios.
- Dos clubes distintos dentro de una liga.
- Una segunda liga para comprobar aislamiento.
- Una temporada válida.
- Firmas y documentos sintéticos, sin datos personales reales.
- Un usuario autorizado y otro sin permiso.

Las pruebas automatizadas de persistencia utilizan una base local desechable.
La demostración manual utiliza datos sintéticos en gestor_ligas_dev y
Supabase de pruebas. La limpieza afecta únicamente a recursos identificados
como creados por estas pruebas.
## Escenarios de aceptación

| ID | Escenario | Resultado esperado |
|---|---|---|
| AF-01 | Enviar datos válidos con las firmas del presidente, secretario y tesorero. | La solicitud se registra en estado PENDIENTE, recibe un folio único y conserva las relaciones correctas con club, temporada y directivos. |
| AF-02 | Omitir una firma requerida, probando cada cargo por separado. | El servidor rechaza la solicitud y no deja una afiliación parcialmente registrada. La interfaz identifica la firma faltante. |
| AF-03 | Cargar un archivo vacío, inválido o fuera de la política acordada. | El servidor lo rechaza y la interfaz muestra un mensaje útil sin exponer información interna. |
| AF-04 | Sustituir el identificador de un archivo por el de otro club. | El servidor rechaza la asociación aunque el usuario tenga permiso sobre su propio club. |
| AF-05 | Cambiar identificadores de club, liga o temporada por otros fuera del ámbito autorizado. | El servidor rechaza la operación sin crear ni modificar registros ajenos. |
| AF-06 | Intentar cargar, asociar o consultar documentos sin autenticación o sin autorización. | No se permite la operación. En entradas HTTP, corresponde 401 sin autenticación y 403 sin autorización. |
- AF-07: comprobado manualmente. El acceso sin token y mediante
  ruta pública fue rechazado con HTTP 400.
- AF-08: comprobado manualmente. El enlace vigente devolvió HTTP 200
  y 3857 bytes. Después de esperar 65 segundos, el mismo enlace
  devolvió HTTP 400 y no permitió descargar el archivo. |
| AF-09 | Hacer doble clic en enviar o reintentar después de perder la respuesta. | No se crean solicitudes duplicadas ni relaciones duplicadas de directivos o archivos. |
| AF-10 | Provocar un fallo durante la persistencia de la solicitud. | No queda una afiliación parcialmente registrada. El tratamiento de archivos previamente cargados se verifica según el contrato de almacenamiento. |
| AF-11 | Completar un envío correctamente. | La interfaz muestra la confirmación y el folio devuelto por el servidor; nunca anuncia éxito antes de recibirlo. |
| AF-12 | Revisar logs, errores, auditoría y respuestas públicas durante el flujo. | No se exponen firmas, contenido privado ni enlaces de acceso firmados. La trazabilidad sigue la política de auditoría existente. |
| AF-13 | Registrar una afiliación de otra temporada para el mismo club. | Se conservan la afiliación y los directivos históricos sin sobrescribirlos. |

## Contratos implementados

- Captura mediante archivos PNG, JPEG o PDF, de hasta 10485760 bytes.
- Almacenamiento privado en el bucket firmas-afiliacion.
- Preparación, confirmación y consulta mediante endpoints de la aplicación.
- Autenticación NextAuth y autorización según permisos vigentes.
- Comprobación del usuario, club, temporada y cargo de cada firma.
- Registro de metadatos después de validar el contenido real.
- Enlaces de descarga con vigencia de 60 segundos.
- Conservación de la tarea de carga y del envío durante los reintentos.
- Datos del formulario conservados en memoria mientras la pantalla siga abierta.

La configuración técnica se documenta en
docs/architecture/affiliation-signatures.md.

## Evidencia ejecutada

| Comprobación | Resultado |
|---|---|
| Pruebas específicas de firmas, comprobantes y cliente | 39 aprobadas, sin fallos ni omisiones |
| Suite HTTP de afiliaciones con PostgreSQL temporal | 15 aprobadas, sin fallos ni omisiones |
| Runner de autorización y regresiones | Bloques de 39 y 49 pruebas aprobados |
| TypeScript | Aprobado |
| ESLint | Aprobado |
| Build de producción | Aprobado |
| Carga y confirmación contra Supabase de pruebas | Comprobadas manualmente |
| Emisión de enlace para el delegado A | 200, enlace generado con vigencia de 60 segundos |
| Consulta del mismo archivo desde el delegado B | 403 FORBIDDEN, sin enlace |
| Envío desde el formulario con tres firmas | Confirmación y folio recibidos |
| Limpieza del objeto sintético sin confirmar | Realizada sin eliminar archivos registrados |

Las pruebas del transporte cliente utilizan respuestas simuladas.
Las pruebas de validación de contenido utilizan PNG, JPEG y PDF reales
generados para las pruebas.

Las pruebas HTTP automatizadas utilizan una base PostgreSQL temporal.
La demostración manual utilizó gestor_ligas_dev en Docker y el bucket
del proyecto Supabase de pruebas.

## Correspondencia con los escenarios

- AF-01 y AF-11: envío completo comprobado manualmente y persistencia
  comprobada mediante la suite HTTP.
- AF-02: rechazo de firma requerida ausente comprobado por HTTP;
  queda ampliar explícitamente el caso a cada uno de los tres cargos.
- AF-03: validación de contenido, tamaño y formato comprobada;
  no se ha recorrido manualmente cada error desde la interfaz.
- AF-04 y AF-05: rechazo de firmas o contextos ajenos comprobado por HTTP.
- AF-06: controles comprobados en pruebas del servicio, en afiliaciones
  y mediante consultas manuales; no existe una matriz HTTP automatizada
  completa de los tres endpoints de firmas.
- AF-07: bucket privado confirmado; acceso directo sin firma pendiente
  de comprobar expresamente.
- AF-08: emisión autorizada y vigencia configurada comprobadas;
  descarga efectiva y rechazo después del vencimiento pendientes.
- AF-09: concurrencia e idempotencia comprobadas en cliente y servidor;
  doble clic sobre el formulario no probado mediante automatización del navegador.
- AF-10: rollback comprobado por HTTP y limpieza manual de un objeto
  sin confirmar realizada. No existe limpieza automática de cargas abandonadas.
- AF-12: auditoría de afiliación y respuestas mínimas comprobadas;
  no se declara una revisión exhaustiva de todos los logs.
- AF-13: se realizó un envío en una temporada nueva conservando el contexto
  DEMO existente. La comparación histórica completa no tiene una prueba específica.

## CI y revisión

npm run test:signatures está incorporado al trabajo app del workflow.

La ejecución local fue aprobada. La ejecución en GitHub y la revisión
por otro integrante siguen pendientes de publicar el PR.

Este documento registra resultados observados y límites de cobertura.
No declara terminada toda la historia de afiliación ni la autorización general.