# Probar autenticación local — PDGLD-48

## Acceso por usuario o correo — PDGLD-115

El campo «Usuario o correo electrónico» acepta cualquiera de los dos identificadores,
sin distinguir mayúsculas y con espacios exteriores recortados. La contraseña se
conserva literalmente. Los usuarios nuevos admiten letras ASCII, números, punto,
guion y guion bajo; las cuentas heredadas con username igual a un correo siguen
siendo compatibles. No se añade un prefijo `@` al identificador.

El contrato de NextAuth 4 conserva el parámetro `email` para los clientes existentes.
El servidor busca coincidencias literales, sin comodines. Si un correo coincide
con el username heredado de otra cuenta, se rechaza el acceso de forma genérica
para no elegir una identidad arbitraria. El alta de cuentas utiliza `emailSchema`
por separado y sigue exigiendo un correo válido.

Ambas vías usan la misma fila, contador de intentos, bloqueo y validación de sesión.
No se crea otro login ni se cambian contraseñas, permisos o migraciones.
`test:login-input` comprueba los identificadores y `test:auth` incluye el acceso
real por ambas vías y fallos concurrentes alternando usuario/correo contra una
base local temporal. No implica validación de credenciales de producción.

## Inactividad efectiva — integración de sesiones

El plazo configurable `AUTH_IDLE_TIMEOUT_MINUTES` (30 por defecto) se aplica en
servidor con la tabla existente `sessions`. Cada login crea una sesión independiente;
solo se guarda un hash SHA-256 de su secreto aleatorio. El JWT conserva un `sid`
estable, distinto del `jti`, que no se expone en el DTO público. Las cookies
anteriores a esta integración requieren iniciar sesión de nuevo.

El navegador registra clics, teclas y desplazamientos reales mientras la página
está visible. Agrupa eventos como máximo cada 15 segundos para evitar una petición
por tecla. Solo esas acciones solicitan `update({ action: "activity" })`, protegido
por CSRF de NextAuth. El servidor comprueba identidad, versión, bloqueo, revocación
y vencimiento antes de actualizar `last_activity_at` y `expires_at` con su propio
reloj. Nunca acepta fechas ni identidades enviadas por el navegador.

GET de sesión, lecturas de negocio, cambios de foco y consultas automáticas no
renuevan la actividad. El campo público `expires` indica el vencimiento efectivo
registrado en PostgreSQL. Al llegar al plazo, el navegador vuelve a comprobar la
sesión antes de volver al login, por si otra pestaña registró actividad. El servidor
rechaza una sesión vencida aunque se conserve o renueve su cookie técnica; un POST
de actividad tampoco la revive. Cerrar sesión revoca únicamente esa sesión.

Validación HTTP con PostgreSQL local temporal: **20/20 resultados correctos**
(19 subcasos y su prueba contenedora), incluidos los casos de renovación tras más
de 30 minutos de antigüedad, consulta pasiva, vencimiento, replay, CSRF y cierre
individual. El tiempo transcurrido se simula modificando exclusivamente las fechas
de fixtures en la base temporal, sin esperar 30 minutos ni alterar el reloj del
equipo. Pasaron ESLint, TypeScript y los 12 controles del pipeline. La compilación
de producción sigue encontrando el fallo existente de Turbopack al procesar CSS.

Prueba manual adicional en navegador con cuentas y base temporales, usando un
plazo de un minuto solo en el proceso de demostración: la navegación por teclado
mantuvo abierta la sesión después del vencimiento original; al dejar la página
sin actividad, volvió automáticamente al login. Se comprobó también el caso de
cookie ya vencida, que NextAuth puede representar como una respuesta nula: el
cliente confirma por HTTP antes de distinguirlo de un fallo de conexión. Se
detuvo el servidor de demostración y su runner eliminó su base temporal. El valor
habitual sigue siendo 30 minutos; no se modificaron los secretos ni `.env`.

## Correcciones de revisión de PDGLD-49

El cambio de contraseña incrementa `users.version` junto con el hash y la retirada
de `must_change_password` en la misma transacción. Esto revoca las sesiones
anteriores. El formulario cierra la sesión mediante NextAuth 4 y navega a `/login`
para exigir la nueva contraseña; no intenta promover la sesión restringida.

Los intentos de acceso y el cambio de contraseña bloquean la fila del usuario
con `SELECT ... FOR UPDATE` dentro de su transacción y leen su estado después
del bloqueo. Así, los fallos simultáneos no sobrescriben el contador y un intento
no limpia un bloqueo generado por otra petición mientras esperaba. Se conservan
cinco fallos, bloqueo de 15 minutos y reinicio después de éxito o bloqueo vencido.

El formulario informa el bloqueo real con la política y los minutos restantes.
El código público controlado se genera después de confirmar la transacción;
los intentos durante el bloqueo no reinician el plazo. Véase
[el contrato del aviso de acceso](design/login-lockout-feedback.md).

`npm run test:auth` incluye regresiones HTTP/PostgreSQL para cinco fallos
simultáneos, vencimiento y reinicio del contador, incremento de versión, rechazo
de cookies anteriores, cierre de sesión y login con la nueva contraseña.
También se comprueba que dos cambios simultáneos no puedan aceptar la misma
contraseña anterior: solo uno debe completar e incrementar la versión.
Validación local del 15/10/2026 con PostgreSQL 15: **16/16 resultados correctos**
(15 subcasos y su prueba contenedora), cero fallos. Se ejecutó el runner completo
con una base temporal, incluida la revalidación tras reiniciar el servidor.
ESLint, TypeScript y los 12 controles de `test:ci` también pasaron. La compilación
de producción sigue pendiente por el fallo de Turbopack al procesar CSS en este
entorno; no se ha verificado CI remoto para estas correcciones.

Las secciones siguientes conservan la evidencia y los pendientes originales de
PDGLD-48. La inactividad efectiva se describe en la sección anterior; la HU18-01
todavía requiere revisar el conjunto de sus criterios de aceptación.

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
- Cuentas deshabilitadas y hashes desconocidos/corruptos con error genérico;
  bloqueo temporal con aviso controlado de política y minutos restantes.
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
| `bloqueada@example.test` | Aviso de bloqueo temporal vigente, sin crear sesión |

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

**Actualización PDGLD-49, 21/10/2026**: el login consume `AUTH_MAX_FAILED_ATTEMPTS` (1–20; default 5) y `AUTH_LOCKOUT_MINUTES` (1–1440; default 15). Valores ausentes usan los defaults; valores inválidos impiden autenticar. Se completan `LOGIN_FAILED`, `BLOCK` y `PASSWORD_CHANGED` con atomicidad; `LOGIN_OK`/`LOGOUT` conservan su implementación de sesiones. El endpoint de cambio exige JSON y Origin igual al origen público de `NEXTAUTH_URL`, sin fallback a encabezados del cliente. Se conservan el flujo temporal → cambio → cierre → login y la interfaz del PR #11. La evidencia anterior es histórica; resultados y límites actuales están en [validación PDGLD-49](validation/PDGLD-49-cierre-acceso.md). La aceptación completa de HU18-01 sigue siendo una decisión del equipo. Ver también [contratos completos](architecture/authentication.md) y [tokens/pantallas mínimas](design/auth-access.md).
