-- Catálogo aditivo de fútbol; no cambia resultados ni cédulas históricas.
INSERT INTO sports_management.event_types(sport_id,code,name,requires_disciplinary_case)
SELECT s.id,v.code,v.name,false FROM sports_management.sports s
CROSS JOIN (VALUES ('ASSIST','Asistencia'),('OWN_GOAL','Gol en contra')) v(code,name)
WHERE s.code='SOCCER' AND NOT EXISTS (
 SELECT 1 FROM sports_management.event_types e WHERE e.sport_id=s.id AND e.code=v.code
);
