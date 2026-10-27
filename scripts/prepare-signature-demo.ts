import { createRequire } from "node:module";

const requireFromProject = createRequire(import.meta.url);
const { loadEnvConfig } = requireFromProject("@next/env") as {
  loadEnvConfig: (
    directory: string,
    development: boolean,
    logger: {
      info: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    },
  ) => unknown;
};
import { randomUUID } from "node:crypto";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";
import { DEMO_CONTEXT } from "../prisma/seed-demo-data";
import { getPrisma } from "../src/server/db/prisma";
import { assertSignatureUploadAccess } from
  "../src/features/clubs/server/signature-access";

loadEnvConfig(process.cwd(), true, {
  info() {},
  error() {},
});

let phase = "validar destino local";

async function main() {
  // Rechaza producción, Supabase y bases distintas de gestor_ligas_dev.
  readDevelopmentSeedDatabaseUrl();

  const db = getPrisma();

  try {
    const result = await db.$transaction(async (tx) => {
      phase = "consultar datos DEMO";

      const club = await tx.clubs.findUniqueOrThrow({
        where: { id: DEMO_CONTEXT.clubAId },
        select: {
          id: true,
          league_id: true,
          status: true,
        },
      });

      if (
        club.league_id !== DEMO_CONTEXT.leagueId ||
        club.status !== "ACTIVE"
      ) {
        throw new Error("INVALID_DEMO_CONTEXT");
      }

      const delegate = await tx.users.findFirstOrThrow({
        where: { username: "demo-delegado-a" },
        select: { id: true },
      });

      const auditActor = await tx.users.findFirstOrThrow({
        where: { username: "seed-pdgld-47-audit" },
        select: { id: true },
      });

      const sport = await tx.sports.findUniqueOrThrow({
        where: { code: "SOCCER" },
        select: { id: true },
      });

      await tx.$queryRaw`
        SELECT
          set_config('app.user_id', ${auditActor.id}, true),
          set_config(
            'app.reason',
            'PDGLD-59: preparar datos sintéticos locales',
            true
          )
      `;

      const suffix = randomUUID().slice(0, 8);
      const start = new Date("2026-01-01T00:00:00Z");
      const end = new Date("2026-12-31T00:00:00Z");

      phase = "crear temporada sintética";

      const season = await tx.seasons.create({
        data: {
          league_id: club.league_id,
          sport_id: sport.id,
          name: `PRUEBA PDGLD-59 firmas ${suffix}`,
          start_date: start,
          end_date: end,
          status: "PLANNED",
        },
        select: {
          id: true,
          name: true,
        },
      });

      phase = "comprobar permisos vigentes del delegado";

      // No añade ni restaura permisos.
      // Si el delegado perdió CREATE, se revierte toda la preparación.
      await assertSignatureUploadAccess(tx, delegate.id, {
        clubId: club.id,
        seasonId: season.id,
      });

      phase = "crear categoría y reglamento sintéticos";

      const category = await tx.categories.create({
        data: {
          league_id: club.league_id,
          sport_id: sport.id,
          name: `PRUEBA categoría PDGLD-59 ${suffix}`,
        },
        select: { id: true },
      });

      const rule = await tx.competition_rules.create({
        data: {
          season_id: season.id,
          version_number: 1,
          status: "DRAFT",
        },
        select: { id: true },
      });

      const seasonCategory = await tx.season_categories.create({
        data: {
          season_id: season.id,
          category_id: category.id,
          competition_rule_id: rule.id,
          hierarchy_order: 1,
          type: "OPEN",
          age_cutoff_date: start,
        },
        select: { id: true },
      });

      return {
        temporada: season.name,
        seasonId: season.id,
        categoryId: category.id,
        ruleId: rule.id,
        seasonCategoryId: seasonCategory.id,
      };
    }, { timeout: 15_000 });

    console.log("Contexto sintético local creado:");
    console.log(result);
    console.log(
      "Recarga /affiliations/new con el delegado A y selecciona esta temporada.",
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error(`No se completó la preparación. Fase: ${phase}.`);
  process.exitCode = 1;
});
