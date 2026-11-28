# Liguilla de ocho: reglas y trabajo de integración

Documento de trabajo; la liguilla todavía no está disponible en la aplicación.

## Verificación de clasificados

`npm run test:standings-integration` pasó en PostgreSQL 15 temporal. Con el rol
limitado de Preview y RLS activo se comprobaron tablas oficiales completas de
uno, dos, cuatro y ocho grupos, con ocho clasificados y reparto correcto. Se
probó con conexión administrativa el rechazo de resultado faltante y cédula sin
confirmar; el rechazo de acceso sin permiso se comprobó por separado con RLS.
La prueba usa datos sintéticos y no cubre la pantalla ni el guardado de llaves.

- La liga elige si habrá liguilla. Se clasifican ocho equipos, con 1, 2, 4 u 8 grupos y el mismo número de lugares por grupo; cada grupo necesita equipos suficientes.
- Cuartos, semifinales y final se configuran por separado como partido único o ida y vuelta. Esto requiere entre tres y seis fechas adicionales.
- La administración define la fecha límite de la fase regular; sus jornadas deben terminar antes o en esa fecha. Las ventanas de liguilla comienzan después, no se superponen y terminan dentro de la temporada. La validación pura de ventanas no comprueba disponibilidad, días de juego ni número de jornadas regulares requerido; esas comprobaciones deben integrarse antes de habilitar el flujo.
- En cuartos y semifinales, el reglamento elige entre penales o mejor puesto en su grupo. Si los puestos son iguales, se usan penales. La final empatada se decide por penales.
- Con dos grupos se planteó 1A–2B, 1B–2A, 3A–4B y 3B–4A. Con cuatro u ocho grupos se planteó un sorteo sujeto a revisión de la liga. Semifinales siguen las llaves confirmadas. Para un solo grupo se utiliza la propuesta 1–8, 4–5, 2–7, 3–6.
- No clasificar con posiciones sin resolver, grupos o equipos duplicados, ni considerar una función pura como evidencia de que las jornadas están completas.

## Pendiente de integración

1. Persistir la configuración de forma versionada con autorización y auditoría, y ofrecer controles accesibles sin afectar reglamentos existentes.
2. Verificar que todos los partidos de fase regular tengan resultados oficiales, cargar tablas vigentes y garantizar que el sorteo o las llaves queden guardados y aprobados antes de generar partidos.
3. Conectar la fecha límite y las fechas adicionales al calendario real, comprobar todas las jornadas requeridas, días de juego y disponibilidad; conectar canchas, horarios y revalidación, evitando conflictos y duplicados.
4. Vincular los resultados oficiales de cada partido y serie, incluidos penales, con el avance por llaves y los posibles cambios o anulaciones posteriores.
5. La tabla `matches` admite partidos entre grupos cuando tienen `stage_id`, pero la consulta de clasificación agrupa resultados por `group_id` sin distinguir la fase. Debe excluir partidos de liguilla de la clasificación regular.
6. El control arbitral actual exige que ambos equipos pertenezcan al grupo del partido; eso bloquea partidos de liguilla entre grupos. Debe adecuarse para fases eliminatorias conservando los controles de incompatibilidad, disponibilidad y autorización.
7. El motor actual no calcula algunos criterios configurables, incluidas tarjetas; no inventar posiciones ni desempatar usando datos incompletos.
8. Verificar permisos por liga, operaciones concurrentes, RLS, migraciones, cierre de la temporada, interfaz y recorridos reales antes de activar la funcionalidad.
