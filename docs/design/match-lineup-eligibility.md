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

Chrome se probó con DTOs sintéticos y CSS real compilado, en claro/oscuro y anchos
390/1440; se comprobó apertura de tiempos con Enter y ausencia de desbordamiento.
Esto no es un recorrido autenticado de la cédula real. Su integración corresponde
a PDGLD-18 y continúa pendiente, junto con aceptación humana del flujo.
