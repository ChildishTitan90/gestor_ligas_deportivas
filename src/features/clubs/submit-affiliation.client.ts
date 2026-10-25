import { affiliationSubmissionSchema } from "./affiliation-submission";
import {
  affiliationErrorMessage,
  affiliationResultSchema,
  type AffiliationResult,
} from "./affiliation-feedback";

export type AffiliationSubmitOutcome =
  | { kind: "confirmed"; result: AffiliationResult }
  | { kind: "rejected"; message: string }
  | { kind: "unconfirmed"; message: string };

function unconfirmed(): AffiliationSubmitOutcome {
  return {
    kind: "unconfirmed",
    message:
      "No pudimos confirmar el resultado. Reintenta con los mismos datos para recuperar la solicitud sin duplicarla.",
  };
}

export async function submitAffiliationRequest(
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<AffiliationSubmitOutcome> {
  const parsed = affiliationSubmissionSchema.safeParse(input);

  if (!parsed.success) {
    return {
      kind: "rejected",
      message:
        "Revisa el club, la temporada, las categorías, los directivos y las tres firmas.",
    };
  }

  // No generar submissionKey aquí: el formulario debe conservarla
  // junto con los mismos datos durante los reintentos.
  const body = JSON.stringify(parsed.data);

  let response: Response;

  try {
    response = await fetcher("/api/affiliations", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // Puede haberse registrado aunque la respuesta no llegara.
    return unconfirmed();
  }

  let responseBody: unknown;

  try {
    responseBody = await response.json();
  } catch {
    return unconfirmed();
  }

  if (response.status === 200 || response.status === 201) {
    const result = affiliationResultSchema.safeParse(responseBody);

    if (!result.success) return unconfirmed();

    return {
      kind: "confirmed",
      result: result.data,
    };
  }

  if (response.status >= 400 && response.status < 500) {
    return {
      kind: "rejected",
      message: affiliationErrorMessage(responseBody),
    };
  }

  return unconfirmed();
}