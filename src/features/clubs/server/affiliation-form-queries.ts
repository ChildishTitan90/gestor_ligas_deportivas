import "server-only";

import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import {
  AuthorizationError,
  getPermissionGrants,
  assertPermission,
} from "@/server/auth/authorization";
import { assertSignatureUploadAccess } from "./signature-access";
import { affiliationOfficeCodes, affiliationFormSchema } from "../schemas";
import { getAffiliation, AffiliationReviewError } from "./affiliation-review-service";
import type { AffiliationFormProps } from "../types";

type ContextOption = {
  value: string;
  clubId: string;
  clubName: string;
  seasonId: string;
  seasonName: string;
};

/** Navegación de captura; UPDATE también permite llegar a correcciones sin CREATE. */
export async function canAccessAffiliationCapture() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    const creation = await getPermissionGrants(tx, actor.id, "clubs", "CREATE");
    const update = await getPermissionGrants(tx, actor.id, "clubs", "UPDATE");
    const delegate = await tx.roles.findUniqueOrThrow({ where: { code: "CLUB_DELEGATE" }, select: { id: true } });
    return [...creation, ...update].some(grant => grant.roleId === delegate.id && grant.clubId !== null);
  });
}

function readStorageOrigin(): string {
  const value = process.env.SUPABASE_URL;

  if (!value) {
    throw new Error("SIGNATURE_STORAGE_NOT_CONFIGURED");
  }

  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("SIGNATURE_STORAGE_NOT_CONFIGURED");
  }

  // Solo se expone el origen público, nunca la credencial.
  return url.origin;
}

export async function getAffiliationFormPageData(
  requestedContext: unknown,
) {
  const actor = await requireOperationalUser();

  return getPrisma().$transaction(async (tx) => {
    const creationGrants = await getPermissionGrants(
      tx,
      actor.id,
      "clubs",
      "CREATE",
    );
    const updateGrants = await getPermissionGrants(tx, actor.id, "clubs", "UPDATE");
    const grants = [...creationGrants, ...updateGrants];

    const delegate = await tx.roles.findUniqueOrThrow({
      where: { code: "CLUB_DELEGATE" },
      select: { id: true },
    });

    // Permiso y club deben proceder de la misma asignación.
    const clubIds = [
      ...new Set(
        grants
          .filter(
            (grant) =>
              grant.roleId === delegate.id &&
              grant.clubId !== null,
          )
          .map((grant) => grant.clubId as string),
      ),
    ];

    if (!clubIds.length) {
      throw new AuthorizationError();
    }

    const clubs = await tx.clubs.findMany({
      where: {
        id: { in: clubIds },
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        league_id: true,
      },
      orderBy: { name: "asc" },
    });

    const seasons = await tx.seasons.findMany({
      where: {
        league_id: {
          in: [...new Set(clubs.map((club) => club.league_id))],
        },
        status: { not: "CLOSED" },
        sports: { code: "SOCCER" },
      },
      select: {
        id: true,
        name: true,
        league_id: true,
        sport_id: true,
      },
      orderBy: { start_date: "desc" },
    });

    const allOptions: ContextOption[] = clubs.flatMap((club) =>
      seasons
        .filter((season) => season.league_id === club.league_id)
        .map((season) => ({
          value: `${club.id}:${season.id}`,
          clubId: club.id,
          clubName: club.name,
          seasonId: season.id,
          seasonName: season.name,
        })),
    );

    const existing = await tx.club_affiliations.findMany({
      where: {
        club_id: { in: clubs.map((club) => club.id) },
        season_id: { in: seasons.map((season) => season.id) },
      },
      select: {
        id: true,
        club_id: true,
        season_id: true,
        reference_number: true,
        status: true,
        requested_by: true,
        review_reason: true,
      },
    });

    const options = allOptions.filter(option => {
      const previous = existing.find(item => item.club_id === option.clubId && item.season_id === option.seasonId);
      const canCreate = creationGrants.some(grant => grant.roleId === delegate.id && grant.clubId === option.clubId);
      const canUpdate = updateGrants.some(grant => grant.roleId === delegate.id && grant.clubId === option.clubId);
      return canCreate || (canUpdate && previous?.requested_by === actor.id &&
        previous.status === "PENDING" && !!previous.review_reason);
    });

    let selected: ContextOption | undefined;

    if (requestedContext !== undefined) {
      const parsed = z.tuple([z.uuid(), z.uuid()]).safeParse(
        typeof requestedContext === "string"
          ? requestedContext.split(":")
          : [],
      );

      if (!parsed.success) {
        throw new AuthorizationError();
      }

      const value = parsed.data
        .map((id) => id.toLowerCase())
        .join(":");

      selected = options.find((option) => option.value === value);

      if (!selected) {
        throw new AuthorizationError();
      }
    } else {
      selected =
        options.find(option => existing.some(item => item.club_id === option.clubId &&
          item.season_id === option.seasonId && item.requested_by === actor.id &&
          item.status === "PENDING" && !!item.review_reason)) ??
        options.find(
          (option) =>
            !existing.some(
              (item) =>
                item.club_id === option.clubId &&
                item.season_id === option.seasonId,
            ),
        ) ?? options[0];
    }

    if (!selected) {
      return {
        options,
        selected: null,
        categories: [],
        existingAffiliation: null,
        submissionContext: null,
      };
    }

    await assertSignatureUploadAccess(tx, actor.id, {
      clubId: selected.clubId,
      seasonId: selected.seasonId,
    });

    const previous = existing.find(
      (item) =>
        item.club_id === selected.clubId &&
        item.season_id === selected.seasonId,
    );

    if (previous) {
      return {
        options,
        selected,
        categories: [],
        existingAffiliation: {
          id: previous.id,
          referenceNumber: previous.reference_number,
          status: previous.status,
          canCorrect: previous.requested_by === actor.id && previous.status === "PENDING" && !!previous.review_reason,
        },
        submissionContext: null,
      };
    }

    const season = seasons.find(
      (item) => item.id === selected.seasonId,
    );

    if (!season) {
      throw new AuthorizationError();
    }

    const configuredCategories = await tx.season_categories.findMany({
      where: {
        season_id: selected.seasonId,
        categories: {
          league_id: season.league_id,
          sport_id: season.sport_id,
        },
      },
      select: {
        category_id: true,
        categories: {
          select: { name: true },
        },
      },
      orderBy: { hierarchy_order: "asc" },
    });

    return {
      options,
      selected,
      categories: configuredCategories.map((item) => ({
        // El endpoint de afiliación recibe categories.id.
        id: item.category_id,
        name: item.categories.name,
      })),
      existingAffiliation: null,
      submissionContext: {
        actorId: actor.id,
        clubId: selected.clubId,
        seasonId: selected.seasonId,
        storageOrigin: readStorageOrigin(),
      },
    };
  });
}

/** Reutiliza el detalle autorizado y verifica que la captura conserve esa versión. */
export async function getAffiliationCorrectionFormPageData(id: string): Promise<AffiliationFormProps> {
  const actor = await requireOperationalUser();
  const detail = await getAffiliation(id);
  if (!detail.submissionKey || detail.reviewPhase !== "CORRECTIONS_REQUESTED") throw new AuthorizationError();
  return getPrisma().$transaction(async tx => {
    await assertSignatureUploadAccess(tx, actor.id, { clubId: detail.clubId, seasonId: detail.seasonId });
    await assertPermission(tx, actor.id, { module: "clubs", action: "READ",
      context: { clubId: detail.clubId, seasonId: detail.seasonId } });
    const current = await tx.club_affiliations.findUniqueOrThrow({ where: { id },
      select: { review_version: true, requested_by: true, status: true, review_reason: true } });
    if (current.requested_by !== actor.id || current.status !== "PENDING" || !current.review_reason)
      throw new AuthorizationError();
    if (current.review_version !== detail.version) throw new AffiliationReviewError("STALE_AFFILIATION", 409);
    const categories = await tx.season_categories.findMany({ where: { season_id: detail.seasonId },
      select: { category_id: true, categories: { select: { name: true } } }, orderBy: { hierarchy_order: "asc" } });
    const officers = Object.fromEntries(affiliationOfficeCodes.map(office => {
      const person = detail.officers.find(item => item.office === office);
      return [office, { firstName: person?.firstName ?? "", paternalSurname: person?.paternalSurname ?? "",
        maternalSurname: person?.maternalSurname ?? "" }];
    }));
    const initialValues = affiliationFormSchema.parse({ clubName: detail.clubName,
      uniformColors: detail.uniformColors ?? "", categoryIds: detail.categoryIds, officers });
    const signatureFileIds = Object.fromEntries(detail.officers.filter(person => person.signatureFileId)
      .map(person => [person.office, person.signatureFileId!])) as NonNullable<AffiliationFormProps["correction"]>["signatureFileIds"];
    return {
      categories: categories.map(item => ({ id: item.category_id, name: item.categories.name })), initialValues,
      submissionContext: { actorId: actor.id, clubId: detail.clubId, seasonId: detail.seasonId, storageOrigin: readStorageOrigin() },
      correction: { id, submissionKey: detail.submissionKey!, expectedVersion: detail.version,
        referenceNumber: detail.referenceNumber, observations: detail.observations ?? "", signatureFileIds },
    };
  });
}
