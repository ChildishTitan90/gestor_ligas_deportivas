import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createAccountSchema, type CreateAccountInput } from "../schemas";
import { getPrisma } from "@/server/db/prisma";
import { assertAccountAdministrator } from "@/server/auth/account-administrator";
import { requireOperationalUser } from "@/server/auth/session";
import { readAccountCreationOptions } from "./creation-options";
import { hashPassword } from "@/server/auth/password";
import { AccountInputError, accountDatabaseError } from "../account-errors";
export { AccountInputError } from "../account-errors";
import {
  assertCanGrantRole, AuthorizationError, getPermissionGrants,
  lockAuthorization, assertPermission,
} from "@/server/auth/authorization";

export async function getAccountCreationOptions(leagueId?: string) {
  const actor = await requireOperationalUser();
  if (leagueId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leagueId))
    throw new AccountInputError("INVALID_CONTEXT");
  return getPrisma().$transaction(async (tx) => {
    const options = await readAccountCreationOptions(tx, actor.id, leagueId);
    if ("invalidLeague" in options) {
      if (options.invalidLeague) throw new AccountInputError("INVALID_CONTEXT");
      throw new AuthorizationError();
    }
    return options;
  });
}

/** Se ejecuta antes del KDF y de nuevo dentro de la transacción de escritura. */
async function authorizeAccountCreation(tx: Prisma.TransactionClient, actorId: string, data: CreateAccountInput) {
  const catalog = await tx.roles.findMany({
    where: { code: { in: data.roles } }, select: { id: true, code: true },
  });
  if (catalog.length !== data.roles.length) throw new AccountInputError("INVALID_CONTEXT");
  if (data.leagueId) {
    const league = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sports_management.leagues WHERE id = ${data.leagueId}::uuid AND is_active FOR SHARE
    `;
    if (!league.length) throw new AccountInputError("INVALID_CONTEXT");
  }
  let clubId: string | undefined;
  if (data.club?.kind === "existing") {
    const clubs = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sports_management.clubs WHERE id = ${data.club.id}::uuid
        AND league_id = ${data.leagueId!}::uuid AND status = 'ACTIVE' FOR SHARE
    `;
    if (!clubs.length) throw new AccountInputError("INVALID_CONTEXT");
    clubId = clubs[0].id;
  }
  for (const role of catalog) {
    const context = { leagueId: data.leagueId,
      ...(role.code === "CLUB_DELEGATE" && clubId ? { clubId } : {}) };
    await assertAccountAdministrator(tx, actorId, "CREATE", context);
    await assertCanGrantRole(tx, actorId, role.id, context);
  }
  if (data.club?.kind === "new")
    await assertPermission(tx, actorId, { module: "clubs", action: "CREATE", context: { leagueId: data.leagueId } });
  // Una persona sin cuenta no tiene necesariamente un vínculo de club verificable.
  // Reutilizar una identidad existente requiere autoridad global de cuentas.
  if ("id" in data.person) await assertAccountAdministrator(tx, actorId, "CREATE", {});
  return { catalog, clubId };
}

export async function createAccount(input: unknown) {
  const actor = await requireOperationalUser();
  await getPrisma().$transaction(async (tx) => {
    if (!(await getPermissionGrants(tx, actor.id, "users", "CREATE")).length) throw new AuthorizationError();
  });
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === "delegatePosition")) {
      const raw = input as { roles?: unknown; delegatePosition?: unknown };
      throw new AccountInputError(Array.isArray(raw?.roles) && raw.roles.includes("CLUB_DELEGATE") &&
        raw.delegatePosition === undefined ? "DELEGATE_POSITION_REQUIRED" : "INVALID_DELEGATE_POSITION");
    }
    throw new AccountInputError("VALIDATION_ERROR");
  }
  const data = parsed.data;
  await getPrisma().$transaction((tx) => authorizeAccountCreation(tx, actor.id, data));
  const passwordHash = await hashPassword(data.temporaryPassword);
  try {
    return await getPrisma().$transaction(async (tx) => {
      await lockAuthorization(tx, "exclusive");
      const authorized = await authorizeAccountCreation(tx, actor.id, data);
      const { catalog } = authorized;
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
        set_config('app.reason', 'PDGLD-34: alta autorizada de cuenta y contexto inicial', true)`;

      let clubId = authorized.clubId;
      if (data.club?.kind === "new") {
        const club = await tx.clubs.create({
          data: { name: data.club.name, league_id: data.leagueId!, reference_number: `CLB-${randomUUID()}` },
          select: { id: true, league_id: true, status: true },
        });
        clubId = club.id;
        await tx.audit_logs.create({ data: {
          user_id: actor.id, action: "INSERT", table_name: "clubs", entity_id: club.id,
          new_data: { league_id: club.league_id, status: club.status },
          reason: "PDGLD-34: registro inicial de club sin afiliación",
        } });
      }

      let personId: string;
      if ("id" in data.person) {
        const people = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM sports_management.people WHERE id = ${data.person.id}::uuid FOR UPDATE
        `;
        if (!people.length || await tx.users.findUnique({ where: { person_id: data.person.id }, select: { id: true } }))
          throw new AccountInputError("PERSON_UNAVAILABLE", 409);
        personId = data.person.id;
      } else {
        const person = await tx.people.create({
          data: { first_name: data.person.firstName, paternal_surname: data.person.paternalSurname,
            maternal_surname: data.person.maternalSurname || null },
          select: { id: true },
        });
        personId = person.id;
      }
      const user = await tx.users.create({
        data: { person_id: personId, username: data.username, email: data.email,
          password_hash: passwordHash, is_active: true, must_change_password: true },
        select: { id: true, must_change_password: true },
      });
      // users no tiene trigger de auditoría. Registrar un DTO sin PII ni secretos.
      await tx.audit_logs.create({ data: {
        user_id: actor.id, action: "INSERT", table_name: "users", entity_id: user.id,
        new_data: { person_id: personId, is_active: true, must_change_password: true },
        reason: "PDGLD-34: creación de cuenta con cambio obligatorio",
      } });
      const assignments = [];
      for (const role of catalog) {
        const assignment = await tx.user_roles.create({
          data: { user_id: user.id, role_id: role.id,
            delegate_position: role.code === "CLUB_DELEGATE" ? data.delegatePosition! : null,
            ...(role.code === "CLUB_DELEGATE" && data.delegatePeriod ? {
              starts_at: new Date(data.delegatePeriod.startsAt),
              ends_at: data.delegatePeriod.endsAt ? new Date(data.delegatePeriod.endsAt) : null,
            } : {}),
            league_id: data.leagueId ?? null,
            club_id: role.code === "CLUB_DELEGATE" ? clubId! : null },
          select: { id: true },
        });
        // El trigger del baseline registra exactamente una vez cada vínculo.
        assignments.push({ id: assignment.id, role: role.code,
          delegatePosition: role.code === "CLUB_DELEGATE" ? data.delegatePosition! : null });
      }
      return { id: user.id, personId, mustChangePassword: user.must_change_password,
        leagueId: data.leagueId ?? null, clubId: clubId ?? null, assignments };
    });
  } catch (error) {
    const delegateError = accountDatabaseError(error);
    if (delegateError) throw delegateError;
    // Los índices lower(email)/lower(username) cubren también la concurrencia.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new AccountInputError("DUPLICATE_ACCOUNT", 409);
    throw error;
  }
}

