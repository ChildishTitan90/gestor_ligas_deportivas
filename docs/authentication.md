# Probar autenticación local — PDGLD-48

La integración usa PostgreSQL real de Docker, Prisma 7.10, NextAuth **4.24.15** Credentials/JWT y Zod en servidor. No modifica Supabase ni crea cuentas de producción. El esquema y `0_init` permanecen intactos.

## Preparación

1. Usa Node.js 24 y ejecuta `npm ci` (PowerShell: `npm.cmd ci`).
2. Conserva tu `.env` local conforme a `.env.example`. DATABASE_URL apunta al Docker del equipo; DIRECT_URL lo usa la CLI y el runner. Nunca pegues conexiones o secretos en salidas, tickets o commits.
3. Arranca Docker Desktop y ejecuta `docker compose up -d --wait`.
4. La base habitual recibe migraciones con `npx prisma migrate deploy` y cliente con `npx prisma generate`, conforme a [migraciones](migraciones.md). El runner de abajo migra automáticamente **su propia base nueva**.

Para `npm run dev`, usa NEXTAUTH_URL de localhost y un NEXTAUTH_SECRET generado, estable entre reinicios y de al menos 32 caracteres. En esta revisión se creó únicamente el secreto en `.env.local` ignorado, preservando `.env`. Cada compañero usa el suyo. Para generar un archivo nuevo sin mostrar el secreto ni sobreescribir uno existente:

```powershell
node -e "require('node:fs').writeFileSync('.env.local', 'NEXTAUTH_SECRET=' + require('node:crypto').randomBytes(32).toString('hex') + '\n', { flag: 'wx' })"
```

Si `.env.local` ya existe, conserva su contenido y configura el secreto de forma privada. En producción se requiere HTTPS; la cookie Secure se activa con NEXTAUTH_URL HTTPS. HTTP localhost es la excepción local.

## Desarrollo diario: cuentas persistentes

El proyecto usa un contenedor `postgres:15` con el volumen persistente de Compose. Para recorrer las vistas con el servidor habitual, carga una vez las cuentas sintéticas en **gestor_ligas_dev**:

```powershell
docker compose up -d --wait
npm run seed:dev
npm run dev
```

Entra a `http://localhost:3000/login` con `operativa@example.test` para `/access` o `temporal@example.test` para `/change-password`. Ambas usan la contraseña pública de desarrollo `Local-Demo-48!real-test`. No reutilizarla en cuentas reales.

`seed:dev` carga las mismas variables que Next.js, reutiliza el cliente Prisma y `hashPassword()`, y crea usuarios/personas en una transacción. Solo acepta `gestor_ligas_dev` en loopback, puertos 5432/5433, fuera de producción. No crea bases, imágenes ni contenedores. Puede repetirse: agrega únicamente cuentas ausentes, sin modificar contraseñas, estado, versión ni datos existentes. Si cambias una cuenta, volver a ejecutar el seed no la restablece. No concede roles ni permisos administrativos.

La cuenta operativa es una fixture que representa un cambio de contraseña ya completado; la temporal mantiene su restricción. El seed no modifica cuentas reales para saltarse el cambio obligatorio ni implementa el alta de usuarios de producción. Se ejecuta expresamente, no en cada inicio de Next ni desde CI.

Verificado localmente: primera ejecución creó dos cuentas; la segunda creó cero y conservó las dos existentes. Ambas iniciaron sesión en el servidor habitual `localhost:3000` y llegaron a sus vistas correspondientes. También se comprobó el rechazo de producción, host remoto, otra base y parámetros de sustitución de host antes de conectar. ESLint y TypeScript pasaron.

## Prueba automática

```powershell
npm run test:auth
```

El usuario local de DIRECT_URL necesita permiso para crear bases y aplicar btree_gist. El runner solo admite PostgreSQL loopback en puertos 5432/5433 y rechaza conexiones remotas y parámetros que sustituyan el destino. Crea `pdgld48_test_<aleatorio>` **dentro del PostgreSQL ya existente**, aplica las migraciones existentes, inicia Next en un puerto disponible, genera un secreto efímero y carga ocho cuentas sintéticas. No crea imágenes ni contenedores y no usa cuentas de la base habitual. Estas pruebas bloquean, deshabilitan y eliminan cuentas, por eso conservan una base desechable independiente del desarrollo diario.

`.next-auth-tests` aísla su compilación y lock; puede coexistir con el dev habitual. No ejecutes dos runners de autenticación a la vez. Reinicia su servidor con el mismo secreto para verificar continuidad real de la cookie. Al terminar detiene solo el servidor propio y elimina solo la base creada por esa ejecución. Una terminación forzada puede impedir la limpieza: revisar el nombre temporal concreto y su procedencia antes de retirarlo, sin borrar bases por un patrón indiscriminado.

Cobertura:

- Acceso directo sin sesión y compilación de la pantalla de login.
- Contraseña correcta/incorrecta/ausente/vacía/demasiado larga; correo inválido/inexistente/demasiado largo.
- Correo normalizado, cuenta almacenada con mayúsculas, igualdad literal con `%`/`_` y espacios significativos de contraseña.
- Cuentas deshabilitadas/bloqueadas y hashes desconocidos/corruptos con error genérico.
- DTO mínimo, UUID, cookies HttpOnly/SameSite=Lax y rechazo CSRF.
- Cambio obligatorio; `update()` manipulado y retirar el flag no promueven la sesión restringida.
- Revalidación ante desactivación, bloqueo, versión nueva, cambio obligatorio y eliminación; replay de cookie anterior.
- Redirección externa rechazada y sesión conservada después de reiniciar el servidor.

Se usa `node:test`, HTTP y PostgreSQL reales; no se añadió runner TypeScript. `npm run test:ci` sigue ejecutando los **12 controles del pipeline**, separados del login. Se añadió `npm run test:auth` al job PostgreSQL 15/17 del workflow; esa definición local no equivale a una ejecución aprobada en GitHub.

## Demostración manual desechable

```powershell
npm run auth:demo
```

Abre la URL `/login` que imprime el runner. Es una base temporal real; estos datos públicos de prueba se usan exclusivamente ahí:

| Correo sintético | Comportamiento |
| --- | --- |
| `operativa@example.test` | Confirma sesión en `/access` |
| `temporal@example.test` | Redirige a `/change-password`; acceso normal denegado |
| `inactiva@example.test` | Rechazo genérico |
| `bloqueada@example.test` | Rechazo genérico por bloqueo vigente |

Contraseña **sintética de demostración**: `Local-Demo-48!real-test`. No reutilizarla en cuentas reales; no se imprime en los logs del runner.

Comprueba contraseña incorrecta, etiquetas/teclado/carga, error genérico y cambio obligatorio. GET `/api/access` responde 401 sin sesión, 403 con cambio pendiente y 200 con identidad operativa; no concede permisos administrativos. La salida enlaza a la confirmación nativa de NextAuth.

Pulsa **Enter** en el terminal para terminar y limpiar la base. Ctrl+C también tiene un manejador; cerrar forzosamente el terminal no garantiza su ejecución.

Para desarrollo diario se recomienda `seed:dev` y el servidor habitual; `auth:demo` queda como demostración aislada opcional. Las cuentas reales deberán provenir del mecanismo de provisión autorizado por SUPERADMIN, que PDGLD-48 no incluye. Tanto el seed local como la demo solo crean fixtures sintéticas: no se retira la restricción de cuentas temporales reales.

## Evidencia y límites

Validación local con PostgreSQL 15 y Node.js 24.9.0:

- Suite HTTP/base: **13 resultados correctos**, cero fallos (12 subcasos más su prueba contenedora; incluye 14 variantes de rechazo).
- `npm run test:ci`: **12 pruebas correctas**.
- ESLint y TypeScript: correctos. `npm run build`: correcto; rutas generadas.
- `npm run ci:guard-migrations`: migraciones existentes intactas.
- Navegador: login y redirección de cuenta temporal a la vista restringida comprobados con datos sintéticos.
- Revisión adicional: búsqueda literal de correo corregida y cubierta antes de la entrega.

El primer build falló por descarga de fuentes en el sandbox y después por IPC de Turbopack al evaluar CSS. Pasó con descarga permitida y workerThreads, alternativa documentada en Next.js 16.4; se conservó Tailwind y su loader. Ver [arquitectura](architecture/authentication.md).

No se ejecutó CI remoto ni la matriz PostgreSQL 17 en esta sesión. Persisten las nueve alertas altas npm documentadas en PDGLD-71; no se aplicó audit fix ni cambios principales.

**Pendientes**: Sergio (PDGLD-49), cambio funcional y contador/bloqueo persistente; Nickte (PDGLD-50), vistas definitivas; Karol (PDGLD-51), actividad efectiva, expiración/cierre y revocación individual persistentes. Los valores de política de `.env.example` están reservados y todavía no se consumen. `maxAge` no implementa inactividad efectiva. Auditoría de accesos y autorización por permisos/contexto requieren sus integraciones. Ver [contratos completos](architecture/authentication.md) y [tokens/pantallas mínimas](design/auth-access.md).
