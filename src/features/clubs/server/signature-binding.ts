import "server-only";

type SignatureFile = {
  id: string;
  storage_key: string;
  uploaded_by: string;
};

type SignatureContext = {
  actorId: string;
  clubId: string;
  seasonId: string;
  office: "PRESIDENT" | "SECRETARY" | "TREASURER";
};

// Usar con el archivo recuperado de PostgreSQL y contexto
// validado por el servicio. No aceptar storage_key del navegador.
export function matchesSignatureBinding(
  file: SignatureFile,
  context: SignatureContext,
): boolean {
  const expectedKey = [
    "affiliation-signatures",
    "v1",
    context.clubId,
    context.seasonId,
    context.actorId,
    context.office,
    file.id,
  ].join("/");

  return (
    file.uploaded_by === context.actorId &&
    file.storage_key === expectedKey
  );
}