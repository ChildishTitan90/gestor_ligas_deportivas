# PDGLD-145 · Consulta de alineación

Ruta `/matches`, accesible desde Arbitraje → Mis partidos · Alineación cuando el
servicio encuentra una designación aprobada con permiso vigente. Cada partido
enlaza `/matches/{matchId}/lineup`. Reutiliza ManagementShell, navegación y
ActionLink, sin otro encabezado de cuenta, selector de tema ni `main` anidado.

La pantalla muestra origen y equipo destino, dorsal habitual, estado expresado
con texto y motivos individuales. Los tiempos se despliegan con `details/summary`
nativos, operables con teclado. No se utiliza color como único indicador.
Superficies, bordes, foco y tipografía usan la base compartida y sus tokens.
No necesita otro selector, formulario ni diálogo para esta consulta.

Incluye carga, colección vacía, denegación y error recuperable. Una consulta con
mala conexión no se presenta como alineación guardada. No ofrece captura offline.
El dorsal mostrado es habitual; la cédula debe conservar su propio dorsal del
partido sin modificar verificaciones de identidad ni registros históricos.

La cédula real de PDGLD-18 añade, dentro de convocados, el selector compartido
«Participación por mitades» por jugador. Puede elegirse primera/segunda o sin
reserva antes de sellar; una segunda mitad no ocupa un puesto titular. Una
reserva pendiente se distingue de la habilitación deportiva y no supera sanciones.
La selección queda inmutable con el sello y el servidor reevalúa reloj, contexto
y periodos en cada guardado. El registro visible de tiempos usa la misma
proyección persistida por el servicio, sin inventar minutos por convocatoria.

La revisión visual sintética de la consulta sigue siendo diferente del recorrido
autenticado de cédula. Véanse resultados actuales y límites en
`docs/validation/PDGLD-16.md`.
