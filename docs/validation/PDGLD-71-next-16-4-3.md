# Actualización de seguridad de Next — PDGLD-71

Preparada inicialmente en un worktree separado desde `origin/develop` (`1d732d6`).
Después el usuario pidió integrarla directamente con PDGLD-62/64 en la misma rama
`feat/PDGLD-62-PDGLD-64-inscripcion-equipos`. **Ya está aplicada** en
`C:/Users/victo/gestor_ligas_deportivas`: Next y eslint-config-next **16.4.3**.

## Cambio y verificación

- `next`: 16.4.0 → **16.4.3**; `eslint-config-next` alineado en **16.4.3**.
- Lockfile actualizado con npm 11.19.0, versiones directas exactas y política de
  scripts existentes. Sin codemods ni adopción de Future Defaults.
- `experimental.agentUpgrade: "security"`, soportado por los tipos y documentos
  instalados de 16.4.3. Resto de la configuración conservado.
- Instalación correcta y `next --version`: **Next.js v16.4.3**.
- Prisma generate, tipos, lint y build correctos. El build final no mostró la
  alerta de vulnerabilidad de Next. En una copia nueva se generan primero los
  tipos de rutas con build/typegen antes de ejecutar typecheck.
- Regresión HTTP real: **81 pruebas aprobadas** y autorización TypeScript:
  **39 aprobadas**, con PostgreSQL 15 temporal y servicios reales existentes.
- Controles CI: 18; firmas: 39; captura de afiliación: 13, todas aprobadas.

Para build y pruebas se cargaron las variables locales en memoria desde la
carpeta original, sin copiar archivos `.env`. Se invocó Next en un proceso hijo
limpio, pues propagar `--env-file` a los workers mediante NODE_OPTIONS es inválido.
Las pruebas crean y eliminan exclusivamente bases locales desechables; no cambian
la base de desarrollo ni Supabase.

La verificación inicial se hizo contra develop. Después de integrarla en la
carpeta principal, allí pasaron de nuevo tipos, lint, build y las **17 pruebas de
inscripción**, las políticas de sesión/login (6 + 3), las 39 pruebas TypeScript
de autorización y las 81 de regresión HTTP. La migración nueva se reconstruyó sin
diferencias en PostgreSQL temporal. La evidencia conjunta está en
[PDGLD-62/64](PDGLD-62-PDGLD-64-inscripcion.md).

## Avisos que permanecen

La auditoría del lockfile actualizado reporta **0 críticas, 1 alta y 1 moderada**:

| Paquete | Severidad | Alcance indicado por audit |
| --- | --- | --- |
| zod | Alta | Versiones menores de 4.6.6; instalada 4.6.5 |
| fast-uri | Moderada | 3.0.0–3.1.8 |

No se ejecutó audit fix ni se aceptó riesgo. Estos avisos requieren seguimiento
en PDGLD-71; actualizar Next no equivale a eliminar todas las alertas del proyecto.
Referencia oficial del aviso de Next:
https://nextjs.org/blog/nextjs-security-update-october-14-2026

## Duplicados y entrega

Se leyeron las instrucciones temporales `shared.md` y `same-major.md` entregadas
por el usuario. Se revisaron el árbol, marcadores, ramas y commits locales/remotos,
tras `git fetch origin`; no apareció trabajo equivalente. No se pudieron revisar
los PR abiertos: `gh` no está instalado y el acceso web al repositorio falló.
Esa limitación no equivale a confirmar ausencia de PR duplicado.

La autorización para crear una rama local de seguridad fue rechazada. El usuario
indicó después aplicar la actualización en la rama actual y aclarar su alcance
en el futuro commit. No se hizo una rama adicional, commit, push, merge,
despliegue ni cambio en Jira. Se conserva la revisión humana y CI remoto antes
de integrar el trabajo del equipo.

La copia auxiliar permanece adjunta: Codex rechazó su archivo con el mensaje
`The task's primary checkout cannot be removed.` No se intentó eliminarla por
otra vía. El resultado entregable y todas las validaciones conjuntas están en
la carpeta original indicada al principio, dentro de la rama PDGLD-62/64.
