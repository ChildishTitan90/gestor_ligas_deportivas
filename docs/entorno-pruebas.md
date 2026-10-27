# Entorno compartido de pruebas — PDGLD-73

Actualización de preparación, 27/10/2026: la provisión original necesita los
permisos de bloqueo y las operaciones de afiliación/inscripción posteriores.
El [plan de mantenimiento de Preview](architecture/preview-runtime.md) incluye
un comando protegido para migraciones originales y provisión por operación.
Su aplicación remota y recorrido en navegador siguen pendientes; los datos que
siguen describen la comprobación histórica del 22/10.

Estado al 22/10/2026. Base de referencia: `origin/develop` d109223, con PR #22.
Este documento acompaña el soporte de CA para la aplicación; no confirma que el
nuevo código esté publicado ni que el recorrido del equipo ya esté aceptado.

## Recursos preparados

- Supabase independiente: `gestor-ligas-pruebas`, referencia `loaztwwpwsaqzdtdtvvj`.
- Pooler de sesión: `aws-1-us-west-2.pooler.supabase.com:5432`.
- Las tres migraciones están aplicadas. Una consulta de solo lectura confirmó
  97 tablas con RLS y cuatro cuentas sintéticas activas con cambio obligatorio.
- Conexión SQL del backend: `gestor_ligas_preview`, sin SUPERUSER, CREATEDB,
  CREATEROLE, BYPASSRLS, membresías ni acceso al historial de Prisma. Tiene
  concesiones y políticas explícitas para los servicios actualmente implementados.
- Víctor declaró creado el bucket privado `firmas-afiliacion`, límite 10 MB,
  PNG/JPEG/PDF. Su integración y pruebas de subida/descarga corresponden a PDGLD-59;
  crear el bucket por sí solo no confirma que las firmas funcionen.

La conexión de ejecución se verificó realmente en lectura con CA y hostname
validados, TLS 1.3 y el rol limitado. La prueba con las raíces normales de Node,
conservando validación estricta, rechazó la cadena: por eso hace falta configurar
la CA explícitamente. No se usó `rejectUnauthorized=false`.

## Variables de Vercel Preview

Guardar los valores en el proyecto de Vercel, con alcance **Preview**. Las claves
no llevan `NEXT_PUBLIC_`. Usar los archivos privados preparados para este entorno,
fuera del repositorio; las contraseñas del administrador de base no son las de login.

| Variable | Configuración |
| --- | --- |
| `DATABASE_URL` | URI del rol `gestor_ligas_preview` de esta base, sin rutas de certificados locales. |
| `DATABASE_CA_CERT` | Contenido completo del certificado CA descargado, incluyendo BEGIN/END CERTIFICATE. |
| `NEXTAUTH_SECRET` | Secreto de Preview distinto de producción; conservarlo entre redespliegues. |
| `NEXTAUTH_URL` | Origen HTTPS de la URL estable de pruebas de la rama elegida, sin ruta. |

El soporte de `DATABASE_CA_CERT` debe estar publicado antes de comprobar el login.
Cuando se configura, el backend valida el PEM, elimina parámetros TLS de la URI
que podrían sustituir esas opciones o abrir archivos locales y configura la CA
con verificación estricta del servidor. Limita el pool a dos conexiones por
instancia y admite 30 segundos para conectar. Sin esa variable conserva la
configuración previa, incluida la conexión Docker local.

La aplicación utiliza `DATABASE_URL`; Prisma CLI utiliza `DIRECT_URL`. Mantener
las credenciales de migración fuera del runtime de Vercel y no agregar migraciones
al build. La identidad sigue en NextAuth, sin cambiar a Supabase Auth.

Configurar `NEXTAUTH_URL` para el origen que realmente visitará el equipo. Si se
habilitan varias ramas con distintos orígenes, necesitan configuración coherente
por rama: no reutilizar el origen de producción ni asumir que una URL de Preview
cualquiera será válida para el control de origen del cambio de contraseña.

## Publicación y comprobación pendientes

1. Revisar e integrar este cambio hacia `develop`, con CI correcto.
2. Configurar las variables de Preview y redesplegar esa rama en Vercel. Los
   despliegues anteriores no reciben variables nuevas automáticamente.
3. Registrar URL estable y SHA reales de la versión publicada.
4. Compartir el despliegue con Nick mediante el acceso de Preview y provisionar
   una cuenta de aplicación adecuada para sus pruebas. El acceso de Vercel y la
   autorización dentro de la aplicación son controles distintos.
5. Otra persona prueba login, cambio obligatorio, nuevo login, cierre de sesión,
   creación de cuenta, rechazo de usuario/correo duplicado y aislamiento de clubes.
   Las cuatro cuentas sintéticas tienen contraseñas temporales privadas; no poner
   contraseñas, cookies, firmas ni conexiones en Jira o en el PR.
6. Documentar el resultado y las limitaciones. Firmas privadas necesitan la
   integración de PDGLD-59; el portal público conserva los datos que realmente
   estén publicados y no se da por terminado por mostrar estados vacíos.

Ante una regresión, volver a desplegar una versión conocida de la aplicación,
comprobando que sea compatible con el esquema actual. No resetear la base ni
revertir migraciones con datos por rutina. Los cambios de datos se corrigen con
una migración revisada. Producción conserva su CD manual desde `main`.

PDGLD-73 requiere completar estas verificaciones y registrar el acuerdo del
profesor que permite Vercel frente al criterio original de contenedores.
PDGLD-74 mantiene la actualización de AGENTS/README/guías y la comprobación por
otra persona. Este soporte TLS y la preparación de recursos no cierran ambos
tickets por sí solos.
