import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";
import { getPrisma } from "../src/server/db/prisma";
import { createSupabasePlayerDocumentStorage } from "../src/features/players/server/supabase-document-storage";
import { playerPhotoRequirementId } from "../src/features/players/server/player-photo-requirement";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
readDevelopmentSeedDatabaseUrl();
if (new URL(process.env.SUPABASE_URL ?? "").hostname !== "loaztwwpwsaqzdtdtvvj.supabase.co") throw new Error("Se requiere el Storage de pruebas autorizado.");
const db = getPrisma();
const storage = createSupabasePlayerDocumentStorage();
const marker = "77000000-0000-4000-8000-000000000176";
try {
  if (await db.audit_logs.findUnique({ where: { id: marker }, select: { id: true } })) {
    console.log("Las fotos ya están asociadas. Se conservaron las referencias y sus revisiones.");
  } else {
    const documents = await db.player_documents.findMany({ where: { document_types: { code: "PHOTO" } },
      select: { files: { select: { id: true, storage_key: true, mime_type: true, size_bytes: true, sha256: true } } },
      orderBy: { id: "asc" } });
    const sources = [...new Map(documents.map(doc => [doc.files.storage_key, doc.files])).values()].slice(0, 2);
    if (sources.length !== 2) throw new Error("Se necesitan las dos referencias de fotos existentes.");
    for (const file of sources) {
      const bytes = await storage.read(file.storage_key, 10 * 1024 * 1024, file.mime_type);
      if (BigInt(bytes.byteLength) !== file.size_bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new Error("La foto de Storage no coincide con la referencia local.");
    }
    await db.$transaction(async tx => {
      const actor = await tx.users.findFirstOrThrow({ where: { username: "tesoreria-local" }, select: { id: true } });
      const type = await tx.document_types.findUniqueOrThrow({ where: { code: "PHOTO" } });
      const targets = ["LOCAL-175-J-1-1", "LOCAL-175-J-3-1"];
      for (const [index, reference] of targets.entries()) {
        const player = await tx.player_registrations.findUniqueOrThrow({ where: { reference_number: reference },
          select: { id: true, people: { select: { identity_version: true } }, season_teams: { select: { season_category_id: true } } } });
        const document = await tx.player_documents.create({ data: { registration_id: player.id, file_id: sources[index].id, document_type_id: type.id, status: "PENDING" } });
        await tx.audit_logs.create({ data: { user_id: actor.id, action: "PLAYER_DOCUMENT_CONFIRMED", table_name: "player_documents",
          entity_id: player.id, reason: "Reutilización local autorizada de foto de prueba existente, pendiente de revisión documental",
          new_data: { requirementId: playerPhotoRequirementId(player.season_teams.season_category_id!), slot: 1,
            documentId: document.id, fileId: sources[index].id, replacesDocumentId: null, identityVersion: player.people.identity_version } } });
      }
      await tx.audit_logs.create({ data: { id: marker, user_id: actor.id, action: "INSTALL", table_name: "seed_local_player_photos",
        reason: "Dos fotos existentes de Storage de pruebas asociadas a jugadores locales. Objetos originales conservados." } });
    });
    console.log("Dos fotos de Storage de pruebas verificadas y asociadas a jugadores de Monarcas Morelia y Pumas. Objetos originales conservados.");
  }
} finally { await db.$disconnect(); }
