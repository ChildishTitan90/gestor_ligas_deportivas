# Entorno local de jugadores — 05/11/2026

## Configuración y conservación

Se preparó una base nueva de Docker para probar, conservando la anterior y su historial. La URL y las claves permanecen en archivos privados. Dos temporadas distintas permiten dos inscripciones de una Persona, sin eliminar la unicidad de CURP ni la inscripción de origen única por temporada. No se eliminaron archivos de Storage.

La configuración inicial tenía escenarios especiales para recorrer con adultos las pantallas de menores y Veteranos. A petición de Víctor se retiraron de la aplicación: no hay tarjeta de «PRUEBA AISLADA», bandera de edad, ni bloqueo deportivo especial. La aplicación usa las mismas reglas en todos los ambientes. INE está disponible cuando la categoría la admite en su política, además de la integración existente para Veteranos. La edad se calcula al registro; el recorrido de tutor se prueba con una identidad sintética menor de edad, sin consultas reales a proveedores.

Los scripts de preparación y sus guardas viven en scripts/verification. El preparador nuevo utiliza rango infantil 0–17. La base local previamente preparada conserva sus configuraciones históricas, sus marcadores y la excepción SQL de calendario limitada a sus equipos; esos marcadores ya no alteran el comportamiento de la aplicación. La excepción de calendario no es una migración ni modifica producción. No se cambió la política real lunes–miércoles ni la edad de Veteranos.

El respaldo privado de la configuración anterior está en C:/Users/victo/AppData/Local/Temp/pdgld-local-player-lab-CmHjx5/previous.env.local. Para restaurarlo, detener el servidor, restaurar ese archivo como .env.local y reiniciar. No se realiza limpieza automática de las bases o documentos.

## Verificación y expediente

Una respuesta IDENTITY_VERIFIED con cotejo versión 1 y huella vigente satisface un requisito compatible de identificación INE de cantidad uno. No crea un archivo recibido ficticio ni una revisión manual. Un nuevo resultado dudoso, una identidad o contexto cambiado invalidan esa evidencia. Nacimiento, escuela y tutor se evalúan separadamente. Los acuses anteriores sin cotejo no se aprueban automáticamente. Las fotografías siguen disponibles mediante acceso privado autorizado y temporal.

La CURP favorable acredita datos; la constancia documental sigue la política aprobada de la categoría. El adaptador usa pdf_required:false. La documentación de Verificamex distingue consulta de datos (3 tokens) y solicitud de PDF (20 tokens, con entrega inmediata o diferida): https://identity.docs.verificamex.com/en/renapo/curp-validation/. No se habilitó la solicitud de PDF ni se consumieron créditos.

Las autorizaciones nuevas firmadas incluyen nombre del jugador y UUID. Los PDF ya guardados son inmutables; para añadirles el nombre hay que preparar una nueva versión. El formulario de revisión se limpia solo tras un acuse válido; una respuesta incierta conserva captura y operación, y un fallo de refresco permite consultar sin reenviar.

## Comprobaciones ejecutadas

- TypeScript y lint: aprobados.
- PostgreSQL desechable: 43 pruebas aprobadas, incluidas concurrencia, permisos, idempotencia, política documental, tutor y participaciones. INE favorable satisface identificación sin carga duplicada, sin inventar archivos y sin satisfacer otros requisitos; un acuse posterior sin cotejo deja de satisfacerla.
- Navegador Chrome con transporte sintético: captura INE, visor privado, PDF de tutor con nombre, limpieza después del acuse y conservación ante incertidumbre; listado/alta, expediente, bandeja y participaciones aprobados.
- Reglas/documentos/encuadre: 17 pruebas; adaptadores CURP: 8; INE y cotejo: 11, aprobadas con transporte simulado.
- Paso completo npm run test:auth: aprobado en Windows (97 pruebas HTTP/base finales, además de reglas y autorización).

No se consultaron APIs reales de identidad, no se modificó Supabase ni Jira y no se hicieron commits, push o despliegues. La revisión de cámara física y proveedores reales corresponde al humano.

## Prueba manual

1. Reiniciar npm run dev por el cambio de configuración de Next y entrar de nuevo.
2. Abrir Jugadores y un expediente de la temporada Libre que admite INE. El aviso de prueba ya no aparece.
3. Si el acuse vigente dice identidad verificada y los datos coinciden, el requisito INE indica validación automática y permite vista previa; no exige volver a cargar ni aprobar identidad. Un resultado dudoso sigue en revisión.
4. Para tutor, usar un registro sintético menor de edad. Preparar una nueva autorización: el PDF muestra nombre y UUID. Aprobar con las comprobaciones administrativas y verificar la limpieza de captura tras confirmación.
5. No repetir consultas reales para comprobar solo cambios visuales: Actualizar resultado reutiliza el acuse.

## Revisión del último CI

PR #39, revisión f86eab5cb524217a740e37b9e9f73eee1147acc0, ejecución 41957439533. La API pública confirmó que Aplicación pasó y PostgreSQL 15/17 fallaron en «Probar autenticación, autorización y cuentas con base temporal local». Los pasos de migración previos no son los que fallaron. La captura aportada por Víctor muestra TimeoutError y pruebas aprobadas, sin una causa más precisa.

Se reprodujo npm run test:auth sobre el árbol actual en Windows y en un contenedor Linux con PostgreSQL 15 propio: ambas ejecuciones terminaron correctamente, incluidas las 97 pruebas HTTP/base finales. La imagen Linux tenía Node 24 y dependencias ya instaladas; se regeneró Prisma 7.10.1. El código se copió sin .env, adjuntos personales ni credenciales reales. No se ejecutó la matriz completa PostgreSQL 17 ni se relanzó GitHub Actions.

El fallo remoto no se reprodujo y no se declara resuelto. No se omitieron pruebas, se relajaron aserciones ni se aumentaron timeouts. La API pública de logs respondió 403; la conexión de diagnóstico no estaba disponible. La revisión automática rechazó extraer una credencial de Git y ese comando no se ejecutó. Se usó exclusivamente lectura pública para identificar el paso. Los contenedores propios de la reproducción se retiraron al terminar; ninguna base habitual fue eliminada.
