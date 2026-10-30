# PDGLD-107 — Cargo del representante en el alta

Se reutilizan SelectField, el manejo compartido de foco, los tokens y los mensajes
de AccountForm, sin paquetes UI ni sistema visual nuevo. Cargo usa el selector
compartido sin búsqueda; las opciones ocupadas se presentan deshabilitadas en el
popup y el valor del contrato viaja en el campo oculto del control. Cargo aparece junto al club y la vigencia,
solo cuando se elige CLUB_DELEGATE. La selección inicial está vacía, incluso con
un único cargo libre. La disponibilidad se consulta en servidor y no promete una
reserva antes de crear.

Las opciones ocupadas permanecen visibles y deshabilitadas, con texto que explica
el estado; el legado muestra regularización pendiente en ambos cargos. Carga,
error de conexión, ausencia de club/periodo y falta de cupos tienen mensajes propios.
Un error no se comunica solo por color. Se puede actualizar la disponibilidad sin
enviar la cuenta. Cambiar contexto elimina cualquier selección anterior.

Label, aria-required, aria-invalid y aria-describedby vinculan el selector a su mensaje.
Los estados de consulta usan role=status y los errores generales role=alert. Se
mantiene el foco visible de los controles existentes. Las fechas explican que usan
hora local del dispositivo y que el fin es exclusivo; el fin vacío es abierto.

La cuenta propia muestra el cargo persistido junto al perfil. «Cargo no identificado»
es una descripción del dato antiguo, no una opción para nuevas altas. No se ofrecen
promociones, reemplazos ni regularizaciones automáticas desde este formulario.

Integración de navegación con PDGLD-110: conservar /access → /accounts/new, retorno
al panel y ManagementShell/AccountMenu existentes bajo el grupo (management),
sin duplicar encabezados. No se introduce un nuevo panel ni
se condicionan permisos por textos o visibilidad. Las decisiones quedan disponibles
para revisión de Nickte/Karol; no se afirma aprobación humana durante esta tarea.

## Validación registrada

El 30 de octubre de 2026 el recorrido Chrome con backend real aprobó en
PostgreSQL 15 y 17: selección vacía, cambio de contexto, conflicto conservando
captura y borrando contraseña, teclado/foco/ARIA, viewport 390×844, presentación
de DEPUTY y legado NULL. Hay capturas sintéticas privadas de escritorio y móvil;
no se atribuye revisión humana, lector de pantalla o dispositivo físico.
Véase la [matriz de evidencia](../validation/account-delegate-acceptance-matrix.md).
