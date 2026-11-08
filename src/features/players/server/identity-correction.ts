import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization } from "@/server/auth/authorization";
import { validatePrivateFileContent } from "@/server/files/private-file-validation";
import { correctionRequestSchema, correctionDecisionSchema, requiredCorrectionEvidence, type CorrectionIdentity, type CorrectionWorkspace, correctionEvidenceKinds } from "../identity-correction";
import { adjacentBirthDates } from "../identity-rules";
import { assertPlayerRegistrationRead, lockPlayerTeamContext } from "./access";
import { assessPlayerEligibility } from "./eligibility-assessment";
import { findPossibleIdentityMatches } from "./identity-matches";
import { lockSeasonIdentityHistory } from "./season-identity-history";
export class IdentityCorrectionError extends Error {
    constructor(public code: string, public status = 409) { super(code); }
}
const identitySelect={curp:true,first_name:true,paternal_surname:true,maternal_surname:true,birth_date:true,identity_version:true} satisfies Prisma.peopleSelect;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(code: string, status = 409): never { throw new IdentityCorrectionError(code, status); }
function identity(p: {
    curp: string | null;
    first_name: string;
    paternal_surname: string;
    maternal_surname: string | null;
    birth_date: Date | null;
}): CorrectionIdentity {
    return { curp: p.curp ?? "", firstName: p.first_name, paternalSurname: p.paternal_surname, maternalSurname: p.maternal_surname, birthDate: p.birth_date?.toISOString().slice(0, 10) ?? "" };
}
async function access(tx: Prisma.TransactionClient, actorId: string, id: string, action: "UPDATE" | "APPROVE" | "READ") {
    if (!z.uuid().safeParse(id).success)
        throw new AuthorizationError();
    const reg = await tx.player_registrations.findUnique({ where: { id }, select: { id: true, person_id: true, season_team_id: true } });
    if (!reg)
        throw new AuthorizationError();
    await lockPlayerTeamContext(tx, actorId, reg.season_team_id, action);
    await assertPlayerRegistrationRead(tx, actorId, id, reg.season_team_id);
    return reg;
}
// Includes historical/withdrawn references, guardians, officers, referees and appointments.
async function allReferenceScope(tx: Prisma.TransactionClient, actorId: string, personId: string) {
    const refs = await tx.$queryRaw<{
        leagueId: string;
        clubId: string | null;
        seasonId: string | null;
    }[]> `
 SELECT s.league_id AS "leagueId", st.club_id AS "clubId", s.id AS "seasonId" FROM sports_management.player_registrations pr JOIN sports_management.season_teams st ON st.id=pr.season_team_id JOIN sports_management.seasons s ON s.id=pr.season_id WHERE pr.person_id=${personId}::uuid
 UNION SELECT ca.league_id,ca.club_id,ca.season_id FROM sports_management.club_officers co JOIN sports_management.club_affiliations ca ON ca.id=co.affiliation_id WHERE co.person_id=${personId}::uuid
 UNION SELECT s.league_id,st.club_id,s.id FROM sports_management.guardian_consents gc JOIN sports_management.player_registrations pr ON pr.id=gc.registration_id JOIN sports_management.season_teams st ON st.id=pr.season_team_id JOIN sports_management.seasons s ON s.id=pr.season_id WHERE gc.guardian_person_id=${personId}::uuid
 UNION SELECT s.league_id,csr.club_id,s.id FROM sports_management.referees r JOIN sports_management.club_season_referees csr ON csr.referee_id=r.id JOIN sports_management.seasons s ON s.id=csr.season_id WHERE r.person_id=${personId}::uuid
 UNION SELECT s.league_id,NULL::uuid,s.id FROM sports_management.referees r JOIN sports_management.referee_assignments ra ON ra.referee_id=r.id JOIN sports_management.matches m ON m.id=ra.match_id JOIN sports_management.seasons s ON s.id=m.season_id WHERE r.person_id=${personId}::uuid
 UNION SELECT gb.league_id,NULL::uuid,NULL::uuid FROM sports_management.appointments a JOIN sports_management.positions po ON po.id=a.position_id JOIN sports_management.governing_bodies gb ON gb.id=po.governing_body_id WHERE a.person_id=${personId}::uuid`;
    for (const ref of refs)
        for (const action of ["READ", "APPROVE"] as const)
            await assertPermission(tx, actorId, { module: "players", action, context: { leagueId: ref.leagueId, ...(ref.clubId ? { clubId: ref.clubId } : {}), ...(ref.seasonId ? { seasonId: ref.seasonId } : {}) } });
    // A shared account or unassigned referee has no complete sporting context: require global authority.
    if (await tx.users.findFirst({ where: { person_id: personId }, select: { id: true } }) || await tx.referees.findFirst({ where: { person_id: personId }, select: { id: true } })) {
        for (const action of ["READ", "APPROVE"] as const) {
            const grants = await getPermissionGrants(tx, actorId, "players", action);
            if (!grants.some(g => !g.contextOnly && !g.leagueId && !g.clubId))
                throw new AuthorizationError();
        }
    }
    return refs;
}
// Fail closed until the database protection is installed and enabled.
async function historyProtectionBlock(tx: Prisma.TransactionClient, personId: string): Promise<string | null> {
    const [guard] = await tx.$queryRaw<{ active: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_trigger t
          JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE t.tgrelid='sports_management.people'::regclass
            AND t.tgname='closed_person_identity' AND t.tgenabled IN ('O','A')
            AND NOT t.tgisinternal AND n.nspname='sports_management'
            AND p.proname='protect_closed_person_identity') AS active`;
    if (!guard?.active) return "HISTORY_PROTECTION_UNAVAILABLE";
    const [closed] = await tx.$queryRaw<{ present: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM sports_management.seasons s WHERE s.status='CLOSED' AND s.id IN (
          SELECT season_id FROM sports_management.player_registrations WHERE person_id=${personId}::uuid
          UNION SELECT ca.season_id FROM sports_management.club_officers co JOIN sports_management.club_affiliations ca ON ca.id=co.affiliation_id WHERE co.person_id=${personId}::uuid
          UNION SELECT pr.season_id FROM sports_management.guardian_consents gc JOIN sports_management.player_registrations pr ON pr.id=gc.registration_id WHERE gc.guardian_person_id=${personId}::uuid
          UNION SELECT csr.season_id FROM sports_management.referees r JOIN sports_management.club_season_referees csr ON csr.referee_id=r.id WHERE r.person_id=${personId}::uuid
          UNION SELECT m.season_id FROM sports_management.referees r JOIN sports_management.referee_assignments ra ON ra.referee_id=r.id JOIN sports_management.matches m ON m.id=ra.match_id WHERE r.person_id=${personId}::uuid
        )) AS present`;
    return closed?.present ? "HISTORICAL_IDENTITY_UNAVAILABLE" : null;
}
export async function correctionWorkspaceForActor(actorId: string, registrationId: string): Promise<CorrectionWorkspace> {
    return getPrisma().$transaction(async (tx) => {
        const reg = await access(tx, actorId, registrationId, "READ");
        const p = await tx.people.findUniqueOrThrow({ where: { id: reg.person_id },select:identitySelect });
        let canRequest = true, canReview = true;
        try {
            await access(tx, actorId, registrationId, "UPDATE");
        }
        catch (e) {
            if (!(e instanceof AuthorizationError))
                throw e;
            canRequest = false;
        }
        try {
            await allReferenceScope(tx, actorId, reg.person_id);
        }
        catch (e) {
            if (!(e instanceof AuthorizationError))
                throw e;
            canReview = false;
        }
        if (!canRequest && !canReview)
            throw new AuthorizationError();
        // Cross-scope requests are visible only to their requester or an approver for ALL references.
        const rows = await tx.player_identity_corrections.findMany({ where: { registration_id: registrationId, ...(!canReview ? { requester_id: actorId } : {}) }, orderBy: [{ created_at: "desc" }, { id: "desc" }], select: { id: true, status: true, requester_id: true, proposed_identity: true, reason: true, observations: true, created_at: true, reviewed_at: true, evidence: { select: { id: true, kind: true, mime_type: true } } } });
        const applyBlockedCode = canReview ? await historyProtectionBlock(tx, reg.person_id) : null;
        return { applyBlockedCode, registrationId, identity: identity(p), identityVersion: p.identity_version, canRequest, canReview, requests: rows.map(r => ({ id: r.id, status: r.status, own: r.requester_id === actorId, identity: r.proposed_identity as unknown as CorrectionIdentity, reason: r.reason, observations: r.observations, createdAt: r.created_at.toISOString(), reviewedAt: r.reviewed_at?.toISOString() ?? null, evidence: r.evidence.map(e => ({ id: e.id, kind: e.kind, mimeType: e.mime_type })) })) };
    });
}
export type CorrectionEvidence = {
    kind: string;
    mimeType: string;
    bytes: Uint8Array;
};
export async function requestIdentityCorrectionForActor(actorId: string, registrationId: string, input: unknown, files: CorrectionEvidence[]) {
    const parsed = correctionRequestSchema.safeParse(input);
    if (!parsed.success)
        fail("VALIDATION_ERROR", 400);
    const data = parsed.data;
    if (files.length > 3 || new Set(files.map(f => f.kind)).size !== files.length || files.some(f => !(correctionEvidenceKinds as readonly string[]).includes(f.kind)))
        fail("VALIDATION_ERROR", 400);
    // Authorize before parsing document bytes; expensive validation is outside the transaction.
    await getPrisma().$transaction(tx => access(tx, actorId, registrationId, "UPDATE"));
    const evidence = await Promise.all(files.map(async (f) => ({ ...await validatePrivateFileContent(f.bytes, f.mimeType), kind: f.kind })));
    const requestHash = digest([data, evidence.map(e => [e.kind, e.sha256]).sort()]);
    return getPrisma().$transaction(async (tx) => {
        await lockAuthorization(tx, "exclusive");
        const reg = await access(tx, actorId, registrationId, "UPDATE");
        const prior = await tx.player_identity_corrections.findUnique({ where: { requester_id_operation_key: { requester_id: actorId, operation_key: data.operationKey } }, select: { id: true, request_hash: true, registration_id: true, status: true } });
        if (prior) {
            if (prior.request_hash !== requestHash || prior.registration_id !== registrationId)
                fail("CORRECTION_CONFLICT");
            return { id: prior.id, status: prior.status, replayed: true };
        }
        await tx.$queryRaw `SELECT id FROM sports_management.people WHERE id=${reg.person_id}::uuid FOR SHARE`;
        const p = await tx.people.findUniqueOrThrow({ where: { id: reg.person_id },select:identitySelect });
        if (p.identity_version !== data.expectedIdentityVersion)
            fail("IDENTITY_CHANGED");
        if (digest(identity(p)) === digest(data.identity))
            fail("VALIDATION_ERROR", 400);
        const row = await tx.player_identity_corrections.create({ data: { registration_id: registrationId, person_id: reg.person_id, requester_id: actorId, operation_key: data.operationKey, request_hash: requestHash, expected_identity_version: p.identity_version, proposed_identity: data.identity, reason: data.reason, identity_doubt: data.identityDoubt,
                evidence: { create: evidence.map(e => ({ kind: e.kind, mime_type: e.mimeType, sha256: e.sha256, bytes: Buffer.from(e.bytes) })) } }, select: { id: true, status: true } });
        await tx.audit_logs.create({ data: { user_id: actorId, action: "PLAYER_CORRECTION_REQUESTED", table_name: "player_identity_corrections", entity_id: row.id, reason: "Solicitud privada de corrección de identidad", new_data: { registrationId, identityVersion: p.identity_version } } });
        return { ...row, replayed: false };
    }, { timeout: 20000 });
}
export async function readCorrectionEvidenceForActor(actorId: string, registrationId: string, evidenceId: string) {
    return getPrisma().$transaction(async (tx) => {
        const reg = await access(tx, actorId, registrationId, "READ");
        if (!z.uuid().safeParse(evidenceId).success)
            throw new AuthorizationError();
        const row = await tx.player_identity_correction_evidence.findUnique({ where: { id: evidenceId }, include: { correction: { select: { registration_id: true, requester_id: true } } } });
        if (!row || row.correction.registration_id !== registrationId)
            throw new AuthorizationError();
        if (row.correction.requester_id !== actorId)
            await allReferenceScope(tx, actorId, reg.person_id);
        return { bytes: row.bytes, mimeType: row.mime_type };
    });
}
export async function decideIdentityCorrectionForActor(actorId: string, registrationId: string, correctionId: string, input: unknown) {
    const parsed = correctionDecisionSchema.safeParse(input);
    if (!parsed.success || !z.uuid().safeParse(correctionId).success)
        fail("VALIDATION_ERROR", 400);
    const data = parsed.data;
    try {
        return await getPrisma().$transaction(async (tx) => {
            // Exclusive RF22 shares the boundary used by registration, approval and season closing.
            await lockAuthorization(tx, "exclusive");
            // Before access acquires season/team row locks, matching the history triggers.
            await lockSeasonIdentityHistory(tx);
            const reg = await access(tx, actorId, registrationId, "APPROVE");
            await tx.$queryRaw `SELECT id FROM sports_management.player_identity_corrections WHERE id=${correctionId}::uuid FOR UPDATE`;
            const row = await tx.player_identity_corrections.findUnique({ where: { id: correctionId }, include: { evidence: { select: { kind: true } } } });
            if (!row || row.registration_id !== registrationId || row.person_id !== reg.person_id)
                throw new AuthorizationError();
            if (row.requester_id === actorId)
                fail("SELF_APPROVAL", 403);
            let refs = await allReferenceScope(tx, actorId, reg.person_id);
            const decisionHash = digest(data);
            if (row.status !== "PENDING") {
                if (row.reviewed_by === actorId && row.decision_key === data.operationKey && row.decision_hash === decisionHash)
                    return { id: row.id, status: row.status, replayed: true };
                fail("CORRECTION_CONFLICT");
            }
            if (data.decision === "RETURN") {
                await tx.player_identity_corrections.update({ where: { id: row.id }, data: { status: "RETURNED", reviewed_by: actorId, decision_key: data.operationKey, decision_hash: decisionHash, observations: data.observations, reviewed_at: new Date() } });
                await tx.audit_logs.create({ data: { user_id: actorId, action: "PLAYER_CORRECTION_RETURNED", table_name: "player_identity_corrections", entity_id: row.id, reason: "Solicitud devuelta con observaciones privadas" } });
                return { id: row.id, status: "RETURNED", replayed: false };
            }
            const historyBlock = await historyProtectionBlock(tx, reg.person_id);
            if (historyBlock) fail(historyBlock);
            const next = row.proposed_identity as unknown as CorrectionIdentity;
            const initial = await tx.people.findUniqueOrThrow({ where: { id: reg.person_id },select:identitySelect });
            const before = identity(initial);
            for (const key of [...new Set([before.curp, next.curp].map(c => `PDGLD-97:curp:${c}`))].sort())
                await tx.$queryRaw `SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
            for (const date of [...new Set([before.birthDate, next.birthDate].filter(Boolean).flatMap(adjacentBirthDates))].sort())
                await tx.$queryRaw `SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-97:birth:${date}`},0))::text`;
            await tx.$queryRaw `SELECT id FROM sports_management.people WHERE id=${reg.person_id}::uuid FOR UPDATE`;
            refs = await allReferenceScope(tx, actorId, reg.person_id);
            if ((await tx.people.findUniqueOrThrow({ where: { id: reg.person_id }, select: { identity_version: true } })).identity_version !== row.expected_identity_version)
                fail("IDENTITY_CHANGED");
            // These screens still join people. Without an accredited historical source, fail closed.
            for (const ref of refs)
                if (ref.seasonId) {
                    const s = await tx.seasons.findUniqueOrThrow({ where: { id: ref.seasonId }, select: { status: true } });
                    if (s.status === "CLOSED")
                        fail("HISTORICAL_IDENTITY_UNAVAILABLE");
                }
            const needed = requiredCorrectionEvidence(before, next, row.identity_doubt, data.curpDiscrepancy);
            if (!data.evidenceChecked || !data.samePersonChecked || needed.some(k => !row.evidence.some(e => e.kind === k)))
                fail("EVIDENCE_INCOMPLETE");
            const duplicate = await tx.people.findFirst({ where: { curp: next.curp, id: { not: reg.person_id } }, select: { id: true } });
            if (duplicate)
                fail("DUPLICATE_CURP");
            const regs = await tx.player_registrations.findMany({ where: { person_id: reg.person_id }, orderBy: { id: "asc" }, select: { id: true, season_team_id: true, status: true } });
            const matches = await findPossibleIdentityMatches(tx, next, reg.person_id);
            await tx.$queryRaw `SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','Corrección administrativa de identidad; reevaluación requerida',true)`;
            const updated = await tx.people.update({ where: { id: reg.person_id }, data: { curp: next.curp, first_name: next.firstName, paternal_surname: next.paternalSurname, maternal_surname: next.maternalSurname, birth_date: new Date(next.birthDate) }, select: { identity_version: true } });
            for (const r of regs) {
                // Keep accredited guardian evidence attached to the SAME person/registration.
                const docs = await tx.player_documents.findMany({ where: { registration_id: r.id, document_types: { code: "GUARDIAN_CONSENT" }, status: "VALIDATED" }, select: { id: true } });
                const confirmations = await tx.audit_logs.findMany({ where: { entity_id: r.id, action: "PLAYER_DOCUMENT_CONFIRMED" }, select: { new_data: true } });
                const superseded = new Set(confirmations.map(event => (event.new_data as {
                    replacesDocumentId?: string | null;
                })?.replacesDocumentId));
                for (const doc of docs) {
                    if (superseded.has(doc.id))
                        continue;
                    const review = await tx.audit_logs.findFirst({ where: { entity_id: r.id, action: "PLAYER_DOCUMENT_REVIEWED", new_data: { path: ["documentId"], equals: doc.id } }, orderBy: { occurred_at: "desc" }, select: { new_data: true } });
                    const att = review?.new_data as {
                        identityVersion?: number;
                        guardianAccredited?: boolean;
                    } | undefined;
                    const confirmed = await tx.audit_logs.findFirst({ where: { entity_id: r.id, action: "PLAYER_DOCUMENT_CONFIRMED", new_data: { path: ["documentId"], equals: doc.id } }, orderBy: { occurred_at: "desc" }, select: { new_data: true } });
                    const receipt = confirmed?.new_data as Prisma.JsonObject | undefined;
                    if (att?.guardianAccredited && att.identityVersion === initial.identity_version && receipt?.identityVersion === initial.identity_version) {
                        await tx.audit_logs.create({ data: { user_id: actorId, action: "PLAYER_DOCUMENT_CONFIRMED", table_name: "player_documents", entity_id: r.id, reason: "Acreditación de tutor conservada para la misma persona", new_data: { ...receipt, identityVersion: updated.identity_version, correctionId: row.id } } });
                        await tx.audit_logs.create({ data: { user_id: actorId, action: "PLAYER_DOCUMENT_REVIEWED", table_name: "player_documents", entity_id: r.id, reason: "Acreditación de tutor conservada; sin nueva excepción", new_data: { documentId: doc.id, identityVersion: updated.identity_version, guardianAccredited: true, correctionId: row.id } } });
                    }
                }
                await tx.player_registrations.update({ where: { id: r.id }, data: { ...(r.status === "ACTIVE" ? { status: "INELIGIBLE" } : {}), identity_review_status: matches.length ? "REQUIRED" : "NOT_REQUIRED" } });
                if (r.status === "ACTIVE")
                    await tx.player_status_history.create({ data: { registration_id: r.id, previous_status: "ACTIVE", new_status: "INELIGIBLE", user_id: actorId, reason: "Identidad corregida: requiere verificaciones vigentes y nueva habilitación" } });
                const participations = await tx.player_category_participations.findMany({ where: { origin_registration_id: r.id, status: "AUTHORIZED" }, orderBy: { id: "asc" } });
                for (const participation of participations) {
                    const eventId = randomUUID(), version = participation.version + 1;
                    await tx.audit_logs.create({ data: { id: eventId, user_id: actorId, action: "PLAYER_PARTICIPATION_REVIEWED", table_name: "player_category_participations", entity_id: participation.id, reason: "Autorización invalidada por corrección de identidad; requiere nueva evaluación", previous_data: { status: participation.status, version: participation.version }, new_data: { status: "WITHDRAWN", version, fingerprint: null, decision: "WITHDRAW", correctionId: row.id } } });
                    await tx.player_category_participations.update({ where: { id: participation.id }, data: { status: "WITHDRAWN", eligibility_fingerprint: null, review_event_id: eventId, version } });
                }
                const { row: context } = await lockPlayerTeamContext(tx, actorId, r.season_team_id, "APPROVE");
                const assessment = await assessPlayerEligibility(tx, r.id, [context]);
                await tx.audit_logs.create({ data: { user_id: actorId, action: "PLAYER_CORRECTION_REASSESSED", table_name: "player_registrations", entity_id: r.id, reason: "Reevaluación local tras corregir identidad; sin consulta externa", new_data: { correctionId: row.id, identityVersion: updated.identity_version, ready: assessment.ready, blockers: assessment.blockers.map(b => b.code) } } });
            }
            await tx.player_identity_corrections.update({ where: { id: row.id }, data: { status: "APPLIED", reviewed_by: actorId, decision_key: data.operationKey, decision_hash: decisionHash, observations: data.observations, reviewed_at: new Date(), previous_identity: before } });
            await tx.audit_logs.create({ data: { user_id: actorId, action: "PLAYER_CORRECTION_APPLIED", table_name: "player_identity_corrections", entity_id: row.id, reason: "Corrección de la misma persona con evidencia privada", new_data: { personId: reg.person_id, identityVersion: updated.identity_version, registrations: regs.length } } });
            return { id: row.id, status: "APPLIED", replayed: false };
        }, { timeout: 30000 });
    }
    catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
            fail("DUPLICATE_CURP");
        throw error;
    }
}
