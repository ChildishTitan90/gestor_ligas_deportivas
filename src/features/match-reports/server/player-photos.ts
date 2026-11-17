import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { AuthorizationError } from "@/server/auth/authorization";
import { currentPlayerPhotos } from "@/features/players/server/match-photos";
import type { PrivatePlayerDocumentStorage } from "@/features/players/server/document-storage";
import { validatePrivateFileContent, PRIVATE_FILE_MAX_BYTES } from "@/server/files/private-file-validation";
import { reportReadAccess } from "./access";
import { isRegistrationInAuthorizedMatchRoster } from "@/features/matches/server/eligibility";

export async function readMatchPlayerPhoto(actorId: string, matchId: string, registrationId: string, storage: PrivatePlayerDocumentStorage) {
  if (!z.uuid().safeParse(registrationId).success) throw new AuthorizationError();
  const authorize = () => getPrisma().$transaction(async tx => {
    const match = await reportReadAccess(tx, actorId, matchId);
    // No reconstruir evidencia histórica con la foto actual del expediente.
    if (match.season.status === "CLOSED" || match.match_statuses.code === "FINISHED") throw new AuthorizationError();
    if (!await isRegistrationInAuthorizedMatchRoster(tx, match, registrationId)) throw new AuthorizationError();
    const photo = (await currentPlayerPhotos(tx, [registrationId])).get(registrationId);
    if (!photo || !photo.file.storage_key.startsWith(`player-documents/v1/${match.season.league_id}/${match.season_id}/${registrationId}/`)) throw new AuthorizationError();
    return photo;
  }, { timeout: 30000 });
  const photo = await authorize();
  const bytes = await storage.read(photo.file.storage_key, PRIVATE_FILE_MAX_BYTES, photo.file.mime_type);
  if (BigInt(bytes.length) !== photo.file.size_bytes || createHash("sha256").update(bytes).digest("hex") !== photo.file.sha256) throw new AuthorizationError();
  await validatePrivateFileContent(bytes, photo.file.mime_type);
  const current = await authorize();
  if (current.documentId !== photo.documentId || current.identityVersion !== photo.identityVersion || current.file.sha256 !== photo.file.sha256 || current.file.id !== photo.file.id) throw new AuthorizationError();
  return { bytes, mimeType: photo.file.mime_type };
}
