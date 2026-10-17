import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createAccountSchema, accountRoleCodes } from "../schemas";
import { getPrisma } from "@/server/db/prisma";
import { assertAccountAdministrator } from "@/server/auth/account-administrator";
import { requireOperationalUser } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";

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
    await assertAccountAdministrator(tx, actor.id);
    const roles = await tx.roles.findMany({
      where: { code: { in: [...accountRoleCodes] } },
      select: { code: true, name: true }, orderBy: { name: "asc" },
    });
    const leagues = await tx.leagues.findMany({
      where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: "asc" },
    });
    if (leagueId && !leagues.some((league) => league.id === leagueId))
      throw new AccountInputError("INVALID_CONTEXT");
    // El formulario solicita los clubes de la liga elegida, sin mezclar ámbitos.
    const clubs = leagueId ? await tx.clubs.findMany({
      where: { league_id: leagueId, status: "ACTIVE" },
      select: { id: true, name: true, reference_number: true },
      orderBy: [{ name: "asc" }, { id: "asc" }], take: 100,
    }) : [];
    return { roles, leagues, clubs };
  });
}

export async function createAccount(input: unknown) {
  const actor = await requireOperationalUser();
  // Autorizar antes del KDF y volver a comprobar dentro de la escritura.
  await getPrisma().$transaction((tx) => assertAccountAdministrator(tx, actor.id));
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) throw new AccountInputError("VALIDATION_ERROR");
  const data = parsed.data;
  const passwordHash = await hashPassword(data.temporaryPassword);
  try {
    return await getPrisma().$transaction(async (tx) => {
      await assertAccountAdministrator(tx, actor.id);
      const catalog = await tx.roles.findMany({
        where: { code: { in: data.roles } }, select: { id: true, code: true },
      });
      if (catalog.length !== data.roles.length) throw new AccountInputError("INVALID_CONTEXT");
      if (data.leagueId) {
        const league = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM sports_management.leagues
          WHERE id = ${data.leagueId}::uuid AND is_active FOR SHARE
        `;
        if (!league.length) throw new AccountInputError("INVALID_CONTEXT");
      }
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
        set_config('app.reason', 'PDGLD-34: alta autorizada de cuenta y contexto inicial', true)`;

      let clubId: string | undefined;
      if (data.club?.kind === "existing") {
        const club = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM sports_management.clubs WHERE id = ${data.club.id}::uuid
            AND league_id = ${data.leagueId!}::uuid AND status = 'ACTIVE' FOR SHARE
        `;
        if (!club.length) throw new AccountInputError("INVALID_CONTEXT");
        clubId = club[0].id;
      } else if (data.club?.kind === "new") {
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

