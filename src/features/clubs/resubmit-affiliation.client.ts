import { affiliationResubmissionSchema } from "./affiliation-review";
import { affiliationErrorMessage, affiliationResultSchema } from "./affiliation-feedback";
import type { AffiliationSubmitOutcome } from "./submit-affiliation.client";
import { z } from "zod";

const resultSchema = affiliationResultSchema.extend({
  status: z.literal("PENDING"), replayed: z.literal(false),
  version: z.number().int().nonnegative().max(2147483647), reviewPhase: z.literal("AWAITING_REVIEW"),
});
export type AffiliationResubmitOutcome = AffiliationSubmitOutcome |
  { kind: "conflict" | "access-denied"; message: string };

/** La captura conserva su versión; un conflicto nunca incrementa ni repite PATCH. */
export async function resubmitAffiliationRequest(id: string, input: unknown,
  fetcher: typeof fetch = fetch): Promise<AffiliationResubmitOutcome> {
  const parsed = affiliationResubmissionSchema.safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success)
    return { kind: "rejected", message: "Revisa los datos y las tres firmas antes de reenviar." };
  const uncertain = { kind: "unconfirmed", message:
    "No pudimos confirmar el reenvío. Consulta la solicitud antes de repetirlo; conservamos los datos en esta pantalla." } as const;
  try {
    const response = await fetcher(`/api/affiliations/${encodeURIComponent(id)}/resubmit`, {
      method: "PATCH", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 409) return { kind: "conflict", message:
      "La solicitud cambió o ya no admite este reenvío. Vuelve a consultarla antes de continuar." };
    if (response.status === 401 || response.status === 403) return { kind: "access-denied", message:
      "No se autorizó el reenvío. Comprueba tu sesión y vuelve a consultar la solicitud." };
    const body: unknown = await response.json();
    if (response.status === 200) {
      const saved = resultSchema.safeParse(body);
      if (!saved.success || saved.data.id !== id || saved.data.version !== parsed.data.expectedVersion + 1) return uncertain;
      return { kind: "confirmed", result: saved.data };
    }
    if (response.status >= 400 && response.status < 500)
      return { kind: "rejected", message: affiliationErrorMessage(body) };
    return uncertain;
  } catch { return uncertain; }
}
