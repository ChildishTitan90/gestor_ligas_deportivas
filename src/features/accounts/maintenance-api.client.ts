import { z } from "zod";
import { administrativeResetReceiptSchema } from "./administrative-reset-contract";
import { maintenanceAccountSchema, maintenanceIdentifiersSchema, MaintenanceClientError, type MaintenanceDetail } from "./maintenance-ui";
import type { EmailChangeResult } from "./email-change-contract";
import type { MaintenanceApi } from "./maintenance-controller";

const delivery = z.enum(["NOT_CONFIGURED", "PENDING", "ACCEPTED", "FAILED", "UNKNOWN"]);
const emailResult = z.object({ id: z.uuid(), status: z.enum(["PENDING", "CONFIRMED", "SUPERSEDED"]), revision: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime(), confirmationDelivery: delivery, previousNoticeDelivery: delivery, completionNoticeDelivery: delivery });

export function createMaintenanceApi(request: typeof fetch = fetch): MaintenanceApi {
  async function call(path: string, body?: unknown, method = "GET", signal?: AbortSignal): Promise<unknown> {
    try {
      const response = await request(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
      let value: unknown;
      try { value = await response.json(); }
      catch {
        if (response.status === 401) throw new MaintenanceClientError("UNAUTHENTICATED", 401);
        if (response.status === 403) throw new MaintenanceClientError("FORBIDDEN", 403);
        throw new MaintenanceClientError("INVALID_RESPONSE");
      }
      if (!response.ok) {
        const code = z.object({ code: z.string() }).safeParse(value);
        throw new MaintenanceClientError(response.status === 401 ? "UNAUTHENTICATED" : code.success ? code.data.code : "SERVICE_UNAVAILABLE", response.status);
      }
      return value;
    } catch (error) {
      if (error instanceof MaintenanceClientError) throw error;
      throw new MaintenanceClientError("NETWORK");
    }
  }
  const base = (id: string) => {
    if (!z.uuid().safeParse(id).success) throw new MaintenanceClientError("VALIDATION_ERROR", 400);
    return `/api/account-maintenance/${id}`;
  };
  function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new MaintenanceClientError("INVALID_RESPONSE");
    return result.data;
  }
  return {
    async detail(id, editable, signal): Promise<MaintenanceDetail> {
      const account = parsed(maintenanceAccountSchema, await call(base(id), undefined, "GET", signal));
      if (account.id !== id) throw new MaintenanceClientError("INVALID_RESPONSE");
      if (!editable) return { account };
      const identifiers = parsed(maintenanceIdentifiersSchema, await call(`${base(id)}/identifiers`, undefined, "GET", signal));
      if (account.id !== id || identifiers.id !== id || identifiers.revision !== account.revision || identifiers.username !== account.username)
        throw new MaintenanceClientError("ACCOUNT_CHANGED", 409);
      return { account, identifiers };
    },
    async write(id, kind, payload) {
      if (kind === "reset") return parsed(administrativeResetReceiptSchema,
        await call(`${base(id)}/reset-access`, payload, "POST"));
      const path = kind === "email" ? "email-change" : kind === "username" ? "identifiers" : "status";
      const value = await call(`${base(id)}/${path}`, payload, kind === "email" ? "POST" : "PATCH");
      return kind === "email" ? parsed(emailResult, value) : parsed(maintenanceAccountSchema, value);
    },
    async emailStatus(id, key): Promise<EmailChangeResult> {
      if (!z.uuid().safeParse(key).success) throw new MaintenanceClientError("VALIDATION_ERROR", 400);
      return parsed(emailResult, await call(`${base(id)}/email-change?${new URLSearchParams({ operationKey: key })}`));
    },
  };
}
