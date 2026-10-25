# PDGLD-60 — Integración de aprobación y correcciones

Revisión local del 24/10/2026. Rama feat/PDGLD-60-aprobacion-afiliacion,
incorporando origin/develop en 1d732d6 y el PR #26 de PDGLD-59. Node 24.22.1,
npm 11.19.1; instalación del lockfile con npm ci --ignore-scripts y generación
explícita del cliente Prisma. No se actualizaron las versiones npm del equipo.

## Criterios y evidencia

| Criterio de HU01-02 | Implementación y comprobación |
| --- | --- |
| Secretario autorizado; sin autoaprobación | APPROVE vigente con asignación SECRETARY del contexto. Denegación de delegado, solicitante original, doble rol del mismo club, liga ajena, sesión restringida y revocación con la misma sesión. |
| Correcciones con observaciones y PENDING | Motivo obligatorio, fase CORRECTIONS_REQUESTED, captura precargada y reenvío por el solicitante original con READ/UPDATE; conserva folio, clave y firmas válidas. Una corrección no concede CREATE. |
| Transacción, historial y concurrencia | Bloqueo de solicitud y expectedVersion; un ganador en aprobaciones simultáneas, rollback si falla la auditoría y referencias históricas de directivos/categorías en nuevos reenvíos. Sin cambios operativos de club/equipos. |
| Documentos privados | Referencias por identificador; descarga con READ/contexto revalidados y enlace temporal de PDGLD-59. Sin bytes, Storage keys ni URLs firmadas en logs o auditoría. |

## Comprobaciones locales

- test:affiliation-review: 27 pruebas aprobadas, incluidos captura de corrección,
  versión obsoleta, reintentos, historial, enlaces privados y retirada de datos.
- test:signatures: 39 pruebas aprobadas, conservando las pruebas de Karol.
- test:affiliation-input: 15 pruebas aprobadas.
- test:ci: 18 pruebas aprobadas de controles de migración/producción.
- test:affiliations: 26 resultados aprobados (incluidos contenedores de pruebas),
  cero fallos. Incluye páginas privadas, captura sin CREATE, reenvío por el cliente
  real, validación de firmas por cargo y referencias históricas de directivos.
- test:authorization: aprobado, incluidas las comprobaciones de carga de firmas
  con UPDATE sin CREATE, propiedad de la corrección y READ revocable para descarga.
- lint y typecheck: aprobados.
- Las suites HTTP usan PostgreSQL temporal, migran y comparan esquema. Se conserva
  el fallo intermitente de arranque de Next.js: el primer intento puede fallar
  y el reintento completó las comprobaciones. Ninguna prueba usa el Storage real.

El workflow conserva test:affiliation-review y test:signatures; el conflicto de
integración se resolvió conservando ambos controles. Los resultados locales no
equivalen a un check remoto de GitHub.

## Recorrido comprobado en navegador

Con una base local desechable y datos ficticios se verificó:

1. El secretario eligió su liga y abrió el expediente con directivos y firmas.
2. Solicitó precisar los colores; la solicitud conservó PENDING y registró el motivo.
3. El delegado abrió la corrección desde la captura, conservando datos y firmas.
4. Modificó los colores y reenvió; recibió confirmación con el mismo folio.
5. El secretario consultó los datos corregidos, canceló una confirmación y el foco
   regresó al botón de aprobar. Confirmó después con teclado.
6. Aparecieron el estado Aprobada y los eventos de corrección, reenvío y aprobación.
   La solicitud desapareció del listado pendiente.
7. Con Storage aislado, la consulta de firma mostró un error útil sin crear enlace.

La demostración utiliza metadatos sintéticos de firmas, no objetos de Storage.
Esta corrida no prueba la descarga positiva de un archivo real, la caducidad real
del proveedor ni el reemplazo completo de una firma a través de Supabase. Las
pruebas de contenido y transporte de firmas se mantuvieron; la validación original
de Karol está documentada en ../architecture/affiliation-signatures.md.

Para repetir en una terminal interactiva:

```powershell
node scripts/test-auth.mjs --affiliation-demo
```

Las cuentas sintéticas son operational y underscore de
tests/integration/auth-fixtures.mjs, usando la clave ficticia de ese archivo.
El runner rechaza bases habituales/remotas, crea su propia base y configura
Storage con un dominio reservado de pruebas. Enter, Ctrl+C o cierre de stdin
cierran el servidor y eliminan esa base. La demostración verificada fue limpiada.

## Pendientes para cierre

- npm run build sigue fallando localmente en el proceso CSS de Turbopack con
  Node 24.22.1; se reprodujo en dos intentos. No se forzó workerThreads ni se
  modificaron Next/Tailwind para ocultarlo. Requiere resolución o evidencia de
  compilación exitosa en el entorno acordado y CI aprobado.
- Revisión independiente del diff integrado, CI remoto y aceptación en entorno
  de pruebas. La descarga positiva y el vencimiento del proveedor se comprobaron
  el 25/10/2026, como se describe abajo.
- Validación externa de las reglas pendientes de PV-02, conforme al padre.
- Consolidar los cambios y la integración local en commit y PR hacia develop.

No se declara terminada HU01-02 ni se cambia Jira por esta evidencia local.

## Descarga con Storage real — 25/10/2026

Se configuraron localmente las tres variables de servidor del bucket usado para
las pruebas. La consulta de configuración confirmó acceso autorizado, bucket privado
y límite de tamaño válido. No se registraron valores de credenciales ni enlaces.

Se ejecutó `npm run verify:signature-download -- --test-storage` contra el
proveedor configurado. El comprobador creó un PNG ficticio con UUID nuevo dentro
del prefijo de prueba definido en el script y verificó:

- Descarga HTTP 200 con tipo PNG, tamaño y SHA-256 iguales al contenido creado.
- Rechazo del acceso sin token y del acceso por ruta pública.
- Rechazo del mismo enlace después de esperar su vigencia de 60 segundos más
  cinco segundos de margen.
- Eliminación del único objeto ficticio creado; salida final aprobada y código 0.

No se modificó PostgreSQL ni se consultaron archivos existentes. Esto verifica el
adaptador y la privacidad/vigencia del proveedor. La autorización de usuarios por
sesión y contexto corresponde a las pruebas HTTP y de autorización ya registradas;
esta ejecución de CLI no sustituye una prueba de descarga positiva en navegador
con NextAuth ni una aceptación en producción.

El comando es optativo y requiere `--test-storage`. El CI solo ejecuta las tres
pruebas del comprobador con proveedor simulado; no carga archivos en Supabase.
La suite test:signatures pasó de 39 a 42 pruebas, sin fallos; lint y typecheck
también pasaron. `.env.example` documenta las variables sin valores reales.

Al revisar GitHub no se encontró un PR de la rama de PDGLD-60; no hay resultado de
CI remoto de esta entrega ni aprobación independiente confirmados. El build local
mantiene el fallo de Turbopack registrado el 24/10; no se repitió sin cambios de
Next/configuración que justificaran otro intento.
