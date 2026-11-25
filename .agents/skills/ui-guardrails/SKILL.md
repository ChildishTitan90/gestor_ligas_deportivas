---
name: ui-guardrails
description: Auditar y refinar pantallas y recorridos del Gestor de Ligas Deportivas, conservando su identidad visual, componentes compartidos y comportamiento de negocio.
---

# Refinar un recorrido

- Ubica las entradas, usuarios y acciones que el servidor autoriza. Revisa la pantalla renderizada, los estados vigentes y el siguiente paso o responsable. El encabezado muestra título, propósito y el contexto relevante de liga, temporada, club, equipo o partido.
- Define la secuencia a partir de etapas reales. Mantén separados el avance de captura y el estado del trámite. Muestra requisitos y causas de indisponibilidad antes de actuar. Usa «Guardar y continuar» solo cuando se haya guardado.
- Usa `ManagementShell`, `SelectField`, `FormDialog`, los tokens y temas existentes. Cambia elementos compartidos cuando lo requiera el recorrido aprobado y comprueba sus pantallas consumidoras. Conserva procesos extensos en página y usa diálogos para confirmaciones y captura breve.
- Respeta el contrato oficial de permisos, guardado, envío y revisión. Distingue cambios en pantalla o dispositivo, acuse, espera, rechazo y conflicto. Conserva datos ante validación y errores, advierte antes de descartarlos y concilia intenciones pendientes antes de iniciar otra escritura. Ante una necesidad nueva de datos o permisos, presenta el caso antes de extender el contrato.
- Incluye carga, vacío, error y recuperación cuando sean pertinentes. Usa skeleton durante una carga efectiva cuando ayude a anticipar la estructura. Comprueba móvil y escritorio, claro y oscuro, movimiento reducido, teclado, foco, etiquetas, errores asociados y contraste.
- Recorre el flujo completo y los controles compartidos después del cambio. Distingue evidencia con sesión y backend aislados de datos o transporte simulados. Registra decisiones, verificaciones y pendientes en `docs/design/ui-ux-refinement.md`.
