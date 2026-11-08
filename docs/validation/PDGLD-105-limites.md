# PDGLD-105: límites y recuperación de entrega

Se reconstruyó la entrega desde el ZIP conservado tras restaurarse una instantánea
anterior del entorno. Los identificadores de commits de entregas anteriores no
son los de esta rama reconstruida.

Se recuperó el bloqueo de refrescos durante la consulta inicial del panel y las
pruebas de admisión: 18 pruebas, incluidas 730 comprobaciones de medianoche en
Morelia durante 2026, referencia anual y fechas bisiestas. Las 8 pruebas unitarias
de excepción se ejecutaron nuevamente. El comando test:player-admission se incluye
en CI. Los resultados de navegador y build de la sesión anterior son históricos,
no una nueva ejecución de esta entrega reconstruida.

Jira PDGLD-15 y PV-04 mantienen lunes a miércoles y decisiones de edad con carta.
No se han establecido fechas/horarios concretos de fases; no se inventan.
Quedan pendientes PostgreSQL 15/17, aceptación HTTP real y revisión por otra
persona. GitHub rechazó escritura de la integración con 403 en la sesión anterior.
No se han usado proveedores CURP/INE ni credenciales del ZIP.
