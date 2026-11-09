# PDGLD-118 — validación integrada de mantenimiento de cuentas

Ejecutada el 5 de noviembre de 2026 sobre
`feat/PDGLD-118-mantenimiento-cuentas`, HEAD `53c2628`, sincronizada con
`origin/develop`, incluyendo el trabajo local recuperado sin commit.

## Ejecución y resultado

```sh
node scripts/test-delegate-isolated.mjs --run-id 118a2026-1105-4e18-8a15-000000000117 --account-maintenance --execute
```

La suite completa `tests/integration/account-maintenance.test.mjs` aprobó en
PostgreSQL 15 y 17, secuencialmente. El supervisor exige el código de salida
exitoso del proceso de node:test además de la confirmación IPC; no se atribuye
el éxito únicamente al retorno de la función de la suite. No se filtraron casos.

SHA-256 de la suite ejecutada:
`9de5177b5f08ea98211bf6549b630843a4adc9fe3896dc57b156af966836c01f`.

| Caso integrado | PG15 | PG17 |
| --- | --- | --- |
| Lista/detalle mínimos, paginación, búsqueda literal y opciones de alta conservadas | Aprobado | Aprobado |
| Denegación sin sesión, sin permiso y con autoridad parcial | Aprobado | Aprobado |
| Confirmación/motivo obligatorios y rechazo de revisión obsoleta | Aprobado | Aprobado |
| Dos cambios con la misma revisión: un éxito y un conflicto; baja/reactivación, auditoría, revocación y conservación de identidad/asignaciones | Aprobado | Aprobado |
| Fallo sintético de auditoría revierte estado, revisión, versión y revocación | Aprobado | Aprobado |
| Alternativa SUPERADMIN bloqueada o con cambio obligatorio: rechazo explícito sin avanzar revisión | Aprobado | Aprobado |
| Dos bajas concurrentes de SUPERADMIN: un éxito, un conflicto y un administrador global activo restante | Aprobado | Aprobado |

La conservación se comprueba mediante la misma referencia `person_id` y las
filas completas de `user_roles`, incluido cargo, ámbito y vigencia. No se afirma
una comparación exhaustiva de todas las tablas relacionadas. La prueba de
sesiones verifica revocación, rechazo de la cookie anterior incluso después de
reactivar y acceso mediante un login nuevo. El caso exitoso verifica dos eventos
de auditoría mínimos para baja/reactivación; el caso de fallo verifica rollback.

## Política pendiente

No hay casos omitidos por `SUPERADMIN_AVAILABILITY_DECISION_REQUIRED` en esta
ejecución: se verificó su respuesta 409 para las dos condiciones implementadas.
Las bajas cuando la única alternativa está temporalmente bloqueada o debe
cambiar contraseña siguen bloqueadas en el producto. Su autorización requiere
acuerdo humano; esta validación no define esa política ni acredita esas bajas
como permitidas. La protección probada corresponde a este servicio; no acredita
la retirada de roles/permisos, vencimientos futuros ni SQL directo.

## Aislamiento y limpieza

- Node `24.22.0`, npm `11.19.1`, dentro de los rangos del proyecto.
- Imágenes `postgres:15-bookworm` y `postgres:17-bookworm`; contenedor/red propios
  por versión, tmpfs sin volúmenes ni bind mounts, 768 MiB y 2 CPU.
- PostgreSQL en loopback `55415/55417`; Next en loopback `56515/56517`.
- Copias independientes sin `.env`, instalación `npm ci` del lockfile sin cambios
  de versiones, Prisma 7.10.1 generado por postinstall y arranque Next propio.
  No se reutilizó el cliente Prisma instalado en el workspace. Los tipos de Next
  se generan en la copia al arrancar; esta ejecución HTTP no sustituye un
  typecheck completo (ya validado en otra copia limpia).
- Migraciones SQL, catálogo de permisos, fixtures sintéticos y trigger de fallo
  únicamente en bases desechables del runner. Sin bases habituales, Supabase,
  seeds de desarrollo/demo ni consultas a proveedores externos.
- Tras ambas versiones: bases y procesos propios retirados; comprobación
  adicional de ausencia de contenedores, redes, copias, cachés de instalación y
  listeners en los cuatro puertos.
- Hashes originales conservados, incluidos `compose.yml` y los tres documentos
  internos; respaldo privado verificado y stashes intactos. Sin staging, commit
  ni push. No fue necesario modificar código, pruebas ni políticas.

## Custodia de la evidencia y límites

Los 10 archivos originales de evidencia se copiaron a una carpeta privada
duradera fuera del repositorio, con directorios 0700, archivos 0600 y manifiesto
SHA-256. Se verificó cada archivo contra el origen después de copiarlo. Los
originales temporales también se conservaron; las copias de aplicación y cachés
de instalación ya fueron eliminadas. Se propone versionar únicamente este
informe saneado; los registros, logs, manifiestos originales y rutas privadas
quedan fuera de la entrega.

Typecheck completo y lint aprobaron en otra copia limpia sin `.env`, con el
lockfile existente, Prisma y tipos de rutas regenerados. También aprobaron 31
pruebas sin servicios de cuentas y mantenimiento de clubes en esa copia. El
workspace original conserva sus dependencias y tipos anteriores.

El CI incorpora las cinco pruebas puras de mantenimiento y los controles del
runner. La suite integrada de esta entrega se ejecutó localmente mediante el
runner aislado; no se afirma que el workflow ya ejecute esa suite HTTP.
No se ejecutó validación de Preview/RLS, Supabase ni producción.
