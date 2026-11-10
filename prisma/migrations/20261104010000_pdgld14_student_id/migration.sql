-- Catálogo aditivo; la alternativa escolar se evalúa en el servicio, sin exigir ambos.
INSERT INTO sports_management.document_types(code,name)
VALUES ('STUDENT_ID','Credencial escolar') ON CONFLICT (code) DO NOTHING;
