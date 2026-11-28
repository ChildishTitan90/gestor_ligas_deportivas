# PDGLD-33 · Evidencia y matriz de aceptación

28/11/2026. Rama `feat/PDGLD-33-verificacion-dos-pasos`, base `60dfa29`. Contrato confirmado por Nickte y coordinación registrada con Víctor. `skills-lock.json` se conserva fuera de la entrega.

Fuentes: PDGLD-33, PDGLD-168/169/170, PR #74 y [contrato de implementación](../architecture/two-factor-authentication.md). La traza RF18/RNF02 proviene de Jira. El ERS completo queda por cotejar si el equipo lo mantiene fuera del repositorio.

## Matriz de aceptación

Usar esta matriz para la aceptación funcional. La sección de resultados registra la evidencia disponible. Actor, contexto, pasos, resultado, versión y evidencia saneada deben registrarse por caso. No sustituir PostgreSQL por mocks al acreditar persistencia.

| Criterio / caso | Ejecución y evidencia requerida | Responsable de completar |
| --- | --- | --- |
| Elegibilidad | Cada uno de los tres roles; asignación vencida, revocada y rol ajeno; configuración propia y UUID ajeno | Implementación y pruebas: agente/Nick; contrato compartido: Víctor |
| Alta incompleta | Iniciar, abandonar, caducar, cancelar y volver a login; no activo ni bloqueo silencioso | Agente/Nick |
| Activación | Código válido confirma; fallo no activa; dos confirmaciones concurrentes, un ganador | Agente/Nick |
| Sesión pendiente | Contraseña válida produce desafío; URL directa/API/cambio de contraseña y correo denegados; update manipulado no promueve sesión | Agente/Nick |
| Login completo | Código válido y sesión operativa; LOGIN_OK solo según contrato confirmado | Agente/Nick |
| Códigos inválidos | Formato inválido, incorrecto, vencido, ventana tolerada y repetido; reloj sintético en suite, no alterar reloj del equipo | Agente/Nick |
| Intentos | Quinto fallo bloquea; otra sesión/desafío no reinicia; plazo se cumple sin prolongación por intento | Agente/Nick |
| Caducidad | Pendiente no se renueva mediante actividad, recarga o JWT update; cookie vieja no revive | Agente/Nick |
| Cambio | Prueba actual, nuevo factor confirmado antes de sustituir, fallo/caducidad conserva anterior | Agente/Nick |
| Desactivación | Prueba exigida, revisión vigente, acuse y revocación total | Agente/Nick |
| Pérdida del factor | Recuperación desde pantalla real; consumo único y concurrencia; pérdida de ambos mecanismos explícita | Política: usuario/equipo; ejecución: agente/Nick |
| Auditoría | Evento correcto sin secretos; fallo de auditoría revierte operación; bitácora no expone material sensible | Agente/Nick; revisión compartida: Víctor |
| Revocación | Dos navegadores/cookies previos denegados tras cada operación crítica; nuevo login obligatorio | Agente/Nick |
| Regresión | Login sin factor, cambio obligatorio, bloqueo de contraseña, recuperación de contraseña sin retirar MFA implícitamente | Agente/Nick |
| Datos existentes | Migraciones aditivas en base desechable; usuarios, sesiones y ACL/RLS conservados; rol limitado sin acceso general a secretos | Agente/Nick; diseño compartido: Víctor |
| UI | Pantallas reales con NextAuth/PostgreSQL sintéticos; 390/1280 px, claro/oscuro, Tab/Enter/Escape, foco y errores; auditar con web-design-guidelines y verificar hallazgos en navegador | Agente/Nick; revisión humana independiente |
| Incertidumbre | Descartar acuse después del commit: consulta segura, sin doble consumo ni regeneración automática de códigos | Agente/Nick |
| Entrega | typecheck, lint, suites nuevas conectadas al runner y CI; PR revisado, integración y aceptación | Agente/Nick prepara; otra persona revisa; equipo integra/acepta |

## Comprobaciones

- Pruebas unitarias: cinco casos de TOTP, cifrado y recuperación. Trece regresiones de sesión, política, entrada y mensajes de login.
- La suite `node scripts/test-auth.mjs --two-factor` crea una base temporal, aplica las migraciones, usa el rol limitado de Preview e inicia Next y Chrome. Cubre el desafío, acceso operativo restringido, alta, recuperación concurrente con el último código, revocación, cancelación y bloqueo entre desafíos.
- El workflow ejecuta la suite con PostgreSQL 15 y 17. Validar allí o en una conexión aislada local y adjuntar resultados antes de recomendar cierre.

## Revisión y aceptación

Registrar el enlace del PR, revisión independiente, CI y aceptación funcional. El procedimiento humano al perder ambos mecanismos queda pendiente de acuerdo. La integración en develop y las transiciones de Jira corresponden al usuario.
