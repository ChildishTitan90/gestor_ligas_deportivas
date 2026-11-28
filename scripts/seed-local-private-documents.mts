import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { getPrisma } from "../src/server/db/prisma";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";
import { createRefereeCredentialStorage } from "../src/features/referees/server/credential-storage";
import { mutatePresentationWithCredential } from "../src/features/referees/server/presentation-credentials";
import { submitVenueLoanForActor } from "../src/features/venues/server/loans";
import { createSupabasePrivateDocumentStorage } from "../src/server/files/private-document-storage";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
readDevelopmentSeedDatabaseUrl();
const project = new URL(process.env.SUPABASE_URL ?? "");
if (project.origin !== "https://loaztwwpwsaqzdtdtvvj.supabase.co") throw new Error("Storage de pruebas requerido.");
const db = getPrisma();
const marker = "77000000-0000-4000-8000-000000000179";
function key(value: string) {
  const h = createHash("sha256").update("LOCAL175-PRIVATE-DOCUMENTS:" + value).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
async function pdf(label: string) {
  const document = await PDFDocument.create();
  document.setCreationDate(new Date("2026-11-24T00:00:00Z")); document.setModificationDate(new Date("2026-11-24T00:00:00Z"));
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 420]);
  page.drawText("DOCUMENTO FICTICIO DE PRUEBA", { x: 40, y: 350, size: 23, font });
  page.drawText(label, { x: 40, y: 300, size: 16, font });
  page.drawText("Escenario local. Sin validez profesional, deportiva o administrativa.", { x: 40, y: 250, size: 12, font });
  return document.save();
}
try {
  const league = await db.leagues.findUniqueOrThrow({ where: { name: "Liga local de tesorería" } });
  const season = await db.seasons.findFirstOrThrow({ where: { league_id: league.id, name: "Temporada local 2026–2027" } });
  const presentations = await db.referee_presentations.findMany({ where: { affiliation: { league_id: league.id }, status: "PENDING", credential: null },
    select: { id: true, requester_id: true, version: true } });
  const refereeStorage = createRefereeCredentialStorage();
  for (const row of presentations) {
    const bytes = await pdf("Acreditacion arbitral sintetica " + row.id.slice(0, 8));
    const credential = { mimeType: "application/pdf", sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
    await mutatePresentationWithCredential(row.requester_id, { kind: "credential", presentationId: row.id,
      expectedVersion: row.version, operationKey: key(row.id), reason: "Acreditación ficticia para revisión manual local.", credential },
      { bytes, mimeType: "application/pdf" }, refereeStorage);
  }
  const bucket = "cartas-prestamo-canchas";
  const client = createClient(project.origin, process.env.SUPABASE_STORAGE_SERVER_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const options = { public: false, fileSizeLimit: 10485760, allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"] };
  const existingBucket = await client.storage.getBucket(bucket);
  if (existingBucket.error) {
    if (!/not found/i.test(existingBucket.error.message)) throw new Error("No se pudo comprobar el bucket de cartas.");
    if ((await client.storage.createBucket(bucket, options)).error) throw new Error("No se pudo crear el bucket privado de cartas de prueba.");
  } else if (existingBucket.data.public !== false || Number(existingBucket.data.file_size_limit) !== options.fileSizeLimit
    || !options.allowedMimeTypes.every(mime => existingBucket.data.allowed_mime_types?.includes(mime)))
    throw new Error("El bucket de cartas existente necesita revisión de su configuración.");
  const localEnvPath = new URL("../.env.local", import.meta.url);
  const currentEnv = await readFile(localEnvPath, "utf8");
  if (!/^SUPABASE_VENUE_LOAN_LETTERS_BUCKET=/m.test(currentEnv)) await writeFile(localEnvPath, currentEnv.trimEnd() + '\nSUPABASE_VENUE_LOAN_LETTERS_BUCKET="cartas-prestamo-canchas"\n');
  process.env.SUPABASE_VENUE_LOAN_LETTERS_BUCKET = bucket;
  const letterStorage = createSupabasePrivateDocumentStorage({ bucket, variable: "SUPABASE_VENUE_LOAN_LETTERS_BUCKET", prefix: "venue-loan-letters", testFlag: "VENUE_LOAN_STORAGE_REAL_TEST" });
  await db.$transaction(async tx => {
    if (await tx.audit_logs.findUnique({ where: { id: marker } })) return;
    const admin = await tx.users.findFirstOrThrow({ where: { username: "admin-local" } });
    await tx.$queryRaw`SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Escenarios locales de cartas y autorización de préstamos',true)`;
    const role = await tx.roles.findUniqueOrThrow({ where: { code: "EXECUTIVE_PRESIDENT" } });
    const president = await tx.users.create({ data: { username: "presidencia-local", email: "presidencia-local@example.test", password_hash: admin.password_hash,
      must_change_password: false, people: { create: { first_name: "Presidencia", paternal_surname: "Local de prueba" } } } });
    await tx.user_roles.create({ data: { user_id: president.id, role_id: role.id, league_id: league.id } });
    for (const [index, name] of ["Cancha de entrenamiento Monarcas", "Cancha de entrenamiento Real Madrid"].entries()) {
      const club = await tx.clubs.findUniqueOrThrow({ where: { reference_number: "LOCAL-175-C-" + (index + 1) } });
      await tx.venues.create({ data: { id: key("private-venue-" + index), code: "LOCAL-175-PRIVATE-" + index, league_id: league.id,
        name, address: "Ubicación ficticia local", owner_club_id: club.id, is_league_sports_complex: false } });
    }
    await tx.audit_logs.create({ data: { id: marker, user_id: admin.id, action: "INSTALL", table_name: "seed_local_private_documents",
      reason: "Configuración local de cartas y cuentas de revisión. Documentos ficticios de pruebas." } });
  });
  const bytes = await pdf("Solicitud ficticia de prestamo de cancha");
  const signature = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="white"/><text x="20" y="85" font-size="38" fill="black">FIRMA FICTICIA DE PRUEBA</text></svg>')).png().toBuffer();
  for (const [index, username] of ["delegado-local-01", "delegado-local-03"].entries()) {
    if (await db.venue_loans.findUnique({ where: { id: key("loan-" + index) }, select: { id: true } })) continue;
    const delegate = await db.users.findFirstOrThrow({ where: { username } });
    const assignment = await db.user_roles.findFirstOrThrow({ where: { user_id: delegate.id, delegate_position: "PRIMARY", league_id: league.id } });
    const start = new Date("2027-01-12T18:00:00Z"); start.setUTCDate(start.getUTCDate() + index);
    const end = new Date(start); end.setUTCHours(20);
    await submitVenueLoanForActor(delegate.id, { requestId: key("loan-" + index), seasonId: season.id, clubId: assignment.club_id,
      venueId: key("private-venue-" + (index === 0 ? 1 : 0)), windows: [{ startsAt: start.toISOString(), endsAt: end.toISOString() }] },
      { bytes, mimeType: "application/pdf", signature }, letterStorage);
  }
  console.log("Acreditaciones ficticias adjuntas a propuestas pendientes y dos cartas de préstamo cargadas en Storage privado de pruebas.");
} catch (error) {
  console.error("La preparación documental requiere revisión.", error instanceof Error && "code" in error ? String(error.code) : error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : "Revisa los requisitos del escenario.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
