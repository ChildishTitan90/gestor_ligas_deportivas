# PDGLD-151 — Clasificación interna: validación local

Ejecutada el 21 de noviembre de 2026 en `/private/tmp/gestor-pdgld29`, rama `feat/PDGLD-29-clasificacion-estadisticas`. Se conservaron los archivos existentes y los commits de PDGLD-150 `ed28f39` y `a9a2ac3`. El cierre local posterior separa el merge y la implementación de PDGLD-151 en commits propios. Sin push ni cambios en Jira.

## Entorno y reproducción

`npm run test:standings-workspace` terminó con código 0. Docker Desktop fue accesible desde la sesión local autorizada. El runner crea un contenedor propio PostgreSQL 15, con almacenamiento tmpfs y puerto aleatorio exclusivamente en loopback; aplica las 52 migraciones sobre `standings_ui_synthetic`. Levanta Next.js 16.4.6 en `127.0.0.1:3193` y Chrome headless con perfil separado. Usa NextAuth real, solicitudes HTTP reales y consultas PostgreSQL reales, sin respuestas de aplicación simuladas. Los datos, cuentas y contraseñas son sintéticos. Correo y recuperación permanecen deshabilitados en este proceso; no se llaman proveedores externos.

El runner elimina su contenedor, servidor, perfil de Chrome y manifiesto privado al terminar. No utiliza volúmenes ni las bases habituales. Node 24.22.0. Para reproducir, Docker Desktop debe estar iniciado y el puerto 3193 libre; `CHROME_BIN` permite indicar el ejecutable de Chrome.

Se corrigieron dos fallos del script encontrados durante la ejecución: `await` superior incompatible con la transformación CommonJS de tsx (ahora dentro de `main` async), y timeout CDP de 60 segundos superior al máximo de 45 segundos admitido por el helper compartido. No fue necesario cambiar la pantalla para que pasara el recorrido.

## Resultados observados

La cuenta `secretaria151` tiene el rol SECRETARY y los permisos reales iniciales RF22, con ámbito de la liga sintética. Inicia sesión, abre «Clasificación» desde la navegación de ManagementShell, selecciona competencia, temporada, categoría y grupo mediante SelectField y consulta la tabla. Se comprueban los valores enviados por FormData, un único `main` y el enlace activo con `aria-current="page"`.

Con reglamento v7 (3/1/0), jornada 2 y clasificación guardada v1, Chrome y la consulta del servidor coinciden en:

| Posición | Equipo | PJ | PG | PE | PP | GF | GC | DG | Puntos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Águilas | 2 | 1 | 1 | 0 | 4 | 2 | 2 | 4 |
| 2 | Búhos | 2 | 1 | 0 | 1 | 1 | 2 | -1 | 3 |
| 3 | Delfines | 1 | 0 | 1 | 0 | 2 | 2 | 0 | 1 |
| 4 | Coyotes | 1 | 0 | 0 | 1 | 0 | 1 | -1 | 0 |

Procedencia comprobada: dos cédulas confirmadas, una incomparecencia y ninguna resolución administrativa. Las cédulas son fixtures SQL sintéticos; esto no demuestra la integración de confirmación de PDGLD-152.

También pasaron:

- Cuenta `fuera151`, con el mismo permiso de lectura pero asignada a otra liga: el servicio rechaza el grupo; la pantalla muestra «No tienes permiso» y ni DOM ni respuesta HTML contienen el equipo o la competencia ajenos. No se prueba solamente una cuenta sin permiso.
- Acceso anónimo redirigido al login; asignación revocada denegada por el servicio.
- IDs malformados, jerarquía incompleta, competencia mezclada y jornada ajena rechazados en servidor.
- Grupo sin resultados: ceros y posiciones pendientes; empate sin criterio decisivo: posiciones pendientes, sin inventar orden oficial.
- Jornada 1: corte acumulado y vista actual sin versión guardada. Un cambio posterior de resultado invalida la correspondencia de la versión almacenada y produce PREVIEW, sin presentar la versión obsoleta como vigente.
- La lectura no crea versiones de clasificación; el DTO no expone fingerprint, snapshot de cálculo, eventos internos ni datos de cuentas.
- Apertura del selector mediante Enter, selección de opciones, limpieza del grupo al reseleccionar categoría y FormData. Esto no equivale a una auditoría completa de teclado o accesibilidad.
- Claro/oscuro y escritorio 1440 px/móvil 390 px sin desbordamiento horizontal; tabla en escritorio y tarjetas en móvil. Capturas reales del navegador con datos sintéticos: escritorio claro (captura retirada por limpieza), escritorio oscuro (captura retirada por limpieza), móvil claro (captura retirada por limpieza), móvil oscuro (captura retirada por limpieza). Se inspeccionaron visualmente escritorio claro y móvil oscuro.

## Verificaciones del repositorio

- `next typegen`, `npm run typecheck`, `npm run lint`: correctos.
- `prisma validate`: correcto con parámetros sintéticos, sin conectar a una base habitual.
- `npm run test:standings`: 8/8.
- `npm run test:ci`: 97/97.
- `npm run test:standings-integration`: PostgreSQL 15, 18/18, incluidas concurrencia y rollback.
- `npm run test:standings-integration -- --postgres=17`: 18/18.
- `git diff --check` y `git diff --cached --check`: correctos.

## Base y estado de Git

Los fetch previo y posterior confirmaron origin/develop en `5b3ea851ae11d8b64d14b8c95fba1dc792dace81`, que integra el PR #64. Se incorporó su contenido sin conflictos. El merge se finalizó por autorización del usuario en `ebced6d4490a3a78dd6222a9d8a1b1aa218045e8`, con padres `a9a2ac3` y `5b3ea85`. Se retiró únicamente del índice la línea `test:standings-workspace` de package.json, manteniéndola en el árbol; la pantalla, navegación, consulta, pruebas y evidencia quedaron fuera del commit de merge y se guardan en el commit propio de PDGLD-151 que contiene este documento.

`git merge-base --is-ancestor 5b3ea851ae11d8b64d14b8c95fba1dc792dace81 HEAD` confirma la ascendencia. `MIGRATION_BASE_SHA=5b3ea851ae11d8b64d14b8c95fba1dc792dace81 npm run ci:guard-migrations` pasó después del merge. El fallo anterior era consecuencia de comparar contra HEAD durante el merge aún abierto; quedó resuelto al finalizarlo, sin modificar el guard ni las migraciones compartidas. Las 52 migraciones se aplicaron realmente en PostgreSQL desechable.

La comparación final con origin/develop conserva su recuperación y contratos; las diferencias restantes corresponden a PDGLD-150/151. El worktree y la rama de PDGLD-32 permanecen intactos en `6284027`. No se ejecutaron build de producción, CI remoto, despliegue ni validación manual humana. La evidencia de interfaz es automatizada en Chrome local con backend real. La confirmación de cédulas y los adaptadores oficiales quedan para PDGLD-152.

## Revisión del PR #67

El runner ahora prepara los datos sintéticos como propietario, aplica el plan real de Preview y conecta Next.js como `gestor_ligas_preview` con RLS activo. Antes de abrir Chrome comprueba el rol efectivo, el acceso a las columnas consultadas y la ausencia de acceso al snapshot interno o de escritura de resultados y versiones. El flujo mantiene los casos de Secretaría, otra liga y sesión anónima. El workflow ejecuta este recorrido sobre PostgreSQL desechable.

El partido de incomparecencia del recorrido ahora usa `FINISHED` y origen `DEFAULT`, sin cédula asociada. Los totales esperados exigen contar el 1–0 y sus 3/0 puntos una vez. La suite transaccional de clasificación comprueba que reprocesar este mismo resultado conserva la versión y los totales. El reenvío de la operación del adaptador de PDGLD-85 queda para la integración de ambos trabajos.

El plan agrega solo SELECT por columna a `match_results` y `standing_versions`. El entorno Preview compartido requiere aplicar el plan de provisión después de la migración de clasificación.
