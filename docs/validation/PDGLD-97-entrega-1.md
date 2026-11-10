# PDGLD-97 — Validación de la entrega 1

31 de octubre de 2026. Rama: `feat/PDGLD-13-registro-jugadores-curp`. Base revisada con fetch antes y al cierre: `origin/develop` en `fb64b4f`. Sin commits, publicación ni cambios de estado en Jira.

Evidencia histórica de la primera entrega. La [entrega 2](PDGLD-97-entrega-2.md) amplía la suite de integración a 17 pruebas reportadas y agrega la comprobación CURP con transporte sintético; la UI continúa pendiente.

## Cómo probar

Desde la raíz del repositorio, con las dependencias instaladas:

```powershell
npm run test:player-identity
docker compose up -d db
npm run test:player-registrations
```

El runner requiere `DIRECT_URL` local según la configuración existente. Solo acepta PostgreSQL loopback en 5432/5433; crea una base con nombre aleatorio `pdgld48_test_*`, aplica las migraciones allí y elimina únicamente esa base al terminar. No aplica la migración a la base habitual. No inicia Next.js ni consulta Verificamex. Si el entorno limita acceso al puerto local, necesita permiso para conectar a ese PostgreSQL.

Resultados esperados: 4 pruebas de reglas locales aprobadas y 11 pruebas reportadas por la suite de integración (10 casos y su contenedor), sin fallos. La comparación Prisma debe informar `No difference detected`. Todas las personas, cuentas, CURP, clubes y temporadas son sintéticos.

La primera entrega es un servicio interno: **no hay una ruta ni una pantalla nueva para registrar jugadores todavía**. El uso desde la navegación y los recorridos con sesión de navegador corresponden a PDGLD-98. El [contrato y las decisiones están documentados](../architecture/player-identity.md).

## Evidencia ejecutada

| Comprobación | Resultado |
| --- | --- |
| `npm run test:player-identity` | 4/4: normalización, estructura/dígito, calendario/siglo, contrato estricto y coincidencias |
| `npm run test:player-registrations` | 11/11 con servicio Prisma y PostgreSQL 15 real desechable |
| Comparación migraciones/esquema | Sin diferencias en la base desechable |
| `npm run typecheck` | Aprobado |
| `npm run lint` | Aprobado |
| `npm run test:ci` | 26/26 controles del pipeline |
| `npm run ci:guard-migrations` | Migraciones existentes intactas |
| `npm run test:authorization` | Aprobado con HTTP local y PostgreSQL temporal: autorización, cuentas, afiliaciones y lectura de inscripciones existentes |

La suite de integración comprueba actor ausente/no operativo, permisos insuficientes, club/liga ajenos, propiedad de lectura, contrato sin autoridad del navegador, reutilización autorizada entre temporadas y rechazo de identidad ajena/inconsistente. Verifica dos altas simultáneas al mismo equipo y a distintos equipos/clubes de la misma temporada; conserva una Persona y una inscripción sin baja. Comprueba el índice único con escritores que no usan los locks del servicio y CURP duplicada concurrente en PostgreSQL.

También comprueba señales de coincidencia para ambas capturas simultáneas, rechazo de aprobación por el CHECK específico, auditoría sin CURP y sin duplicados ante reenvío, cuenta inactiva, categoría no autorizada y rollback de Persona/inscripción/historial/auditoría ante fallo en el último paso. Verifica que el trigger original siga rechazando altas el sábado.

El reloj del trigger se controla mediante un schema de pruebas y su `search_path` únicamente en la base desechable. No se desactiva el trigger ni se modifica su cuerpo o la ventana de producción. Los permisos se configuran con el catálogo oficial de `permissions-data.ts`. El actor del núcleo se proporciona desde el fixture de servidor; esta suite **no es un recorrido HTTP/NextAuth ni una demostración con usuarios reales**.

Los comandos nuevos están incorporados al workflow: reglas locales en el job de aplicación y servicio/base en la matriz PostgreSQL 15/17. Solo se ha ejecutado PostgreSQL 15 local; no se afirma que GitHub Actions o PostgreSQL 17 hayan corrido en esta entrega.

## Pendientes explícitos

- Confirmación humana de esta entrega antes de continuar. No se inicia Verificamex ni PDGLD-98/99 automáticamente.
- Acordar el contrato mínimo con PDGLD-14/15 y el significado de la captura `INELIGIBLE` pendiente de aprobación deportiva.
- Implementar la revisión autorizada y motivada de Secretaría y revisar el umbral conservador de coincidencias. Esta entrega bloquea esos casos y no permite despejarlos o fusionar personas.
- Verificamex CURP pendiente; toda validación externa se presenta como `NOT_PERFORMED`. Los agentes solo probarán respuestas sintéticas con transporte simulado. Pruebas reales INE/CURP: exclusivamente Víctor o sus compañeros humanos, conforme a `AGENTS.md`.
- Foto del jugador y bucket privado separado de firmas documentados como ampliación futura. INE y selfie con comparación automática se aplicarán a categorías de veteranos; foto borrosa o falta de coincidencia pasan a revisión administrativa, sin rechazo ni aprobación automáticos, según decisión del usuario. No se ha creado almacenamiento, enviado imágenes ni consumido consultas.
- La migración aditiva se conserva sin aplicar a la base habitual ni Supabase. Su adopción en un entorno persistente requiere el flujo habitual revisado.
