import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createAccountSchema, accountRoleCodes, type CreateAccountInput } from "../schemas";
import { getPrisma } from "@/server/db/prisma";
import { assertAccountAdministrator } from "@/server/auth/account-administrator";
import { requireOperationalUser } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import {
  assertCanGrantRole, AuthorizationError, getPermissionGrants, grantCoversContext,
  lockAuthorization, resolveAuthorizationContext, assertPermission, type AuthorizationContext,
} from "@/server/auth/authorization";

export class AccountInputError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "INVALID_CONTEXT" | "PERSON_UNAVAILABLE" | "DUPLICATE_ACCOUNT",
    public readonly status: number = 400,
  ) { super(code); }
}

export async function getAccountCreationOptions(leagueId?: string) {
  const actor = await requireOperationalUser();
  if (leagueId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leagueId))
    throw new AccountInputError("INVALID_CONTEXT");
  return getPrisma().$transaction(async (tx) => {
    const grants = await getPermissionGrants(tx, actor.id, "users", "READ");
    if (!grants.length) throw new AuthorizationError();
    const global = grants.some((grant) => !grant.contextOnly && !grant.leagueId && !grant.clubId);
    // Solo consultar ámbitos que alguna asignación con READ realmente cubre.
    const clubScopes = await tx.clubs.findMany({
      where: { id: { in: grants.flatMap((grant) => grant.clubId ? [grant.clubId] : []) }, status: "ACTIVE" },
      select: { id: true, league_id: true },
    });
    const leagueIds = [...new Set([
      ...grants.flatMap((grant) => grant.leagueId ? [grant.leagueId] : []),
      ...clubScopes.map((club) => club.league_id),
    ])];
    const leagues = await tx.leagues.findMany({
      where: { is_active: true, ...(global ? {} : { id: { in: leagueIds } }) },
      select: { id: true, name: true }, orderBy: { name: "asc" },
    });
    if (!global && !leagues.length) throw new AuthorizationError();
    if (leagueId) {
      const league = await tx.leagues.findFirst({ where: { id: leagueId, is_active: true }, select: { id: true } });
      if (!league) throw new AccountInputError("INVALID_CONTEXT");
      if (!leagues.some((entry) => entry.id === leagueId)) throw new AuthorizationError();
    }
    const leagueWideRead = global || grants.some((grant) => grant.leagueId === leagueId && !grant.clubId);
    const clubs = leagueId ? await tx.clubs.findMany({
      where: { league_id: leagueId, status: "ACTIVE", ...(leagueWideRead ? {} : {
        id: { in: clubScopes.filter((club) => club.league_id === leagueId).map((club) => club.id) },
      }) },
      select: { id: true, name: true, reference_number: true },
      orderBy: [{ name: "asc" }, { id: "asc" }], take: 100,
    }) : [];
    const catalog = await tx.roles.findMany({
      where: { code: { in: [...accountRoleCodes] } },
      select: { id: true, code: true, name: true }, orderBy: { name: "asc" },
    });
    const roles: { code: string; name: string }[] = [];
    for (const role of catalog) {
      // La forma del contexto corresponde al contrato existente del formulario.
      const contexts: AuthorizationContext[] = role.code === "SUPERADMIN" ? [{}]
        : (leagueId ? leagues.filter((league) => league.id === leagueId) : leagues)
          .map((league) => ({ leagueId: league.id }));
      if (role.code === "CLUB_DELEGATE") {
        contexts.push(...clubs.map((club) => ({ leagueId, clubId: club.id })),
          ...(!leagueId ? clubScopes.map((club) => ({ leagueId: club.league_id, clubId: club.id })) : []));
      }
      for (const context of contexts) {
        try {
          const resolved = await resolveAuthorizationContext(tx, context);
          if (!grants.some((grant) => grantCoversContext(grant, resolved))) continue;
          await assertAccountAdministrator(tx, actor.id, "CREATE", context);
          await assertCanGrantRole(tx, actor.id, role.id, context);
          roles.push({ code: role.code, name: role.name });
          break;
        } catch (error) {
          if (!(error instanceof AuthorizationError)) throw error;
        }
      }
    }
    return { roles, leagues, clubs };
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
  if (!parsed.success) throw new AccountInputError("VALIDATION_ERROR");
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
            league_id: data.leagueId ?? null,
            club_id: role.code === "CLUB_DELEGATE" ? clubId! : null },
          select: { id: true },
        });
        // El trigger del baseline registra exactamente una vez cada vínculo.
        assignments.push({ id: assignment.id, role: role.code });
      }
      return { id: user.id, personId, mustChangePassword: user.must_change_password,
        leagueId: data.leagueId ?? null, clubId: clubId ?? null, assignments };
    });
  } catch (error) {
    // Los índices lower(email)/lower(username) cubren también la concurrencia.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new AccountInputError("DUPLICATE_ACCOUNT", 409);
    throw error;
  }
}

