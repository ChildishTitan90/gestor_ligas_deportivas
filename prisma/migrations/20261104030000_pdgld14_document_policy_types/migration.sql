-- Catálogo disponible para políticas explícitas; no impone ningún requisito,
-- no aprueba comprobantes de nacimiento ni configura edades o firmas de adultos.
INSERT INTO sports_management.document_types(code,name)
VALUES ('DRIVER_LICENSE','Licencia de conducir'),('PASSPORT','Pasaporte'),('BIRTH_CERTIFICATE','Acta de nacimiento')
ON CONFLICT (code) DO NOTHING;
