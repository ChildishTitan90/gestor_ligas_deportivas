import { createAccountSchema } from "./schemas";
import { formDelegatePeriod } from "./delegate-options.client";

export function parseAccountForm(values: FormData, roles: string[], leagueId: string, personMode: string, clubMode: string) {
  return createAccountSchema.safeParse({
    username: values.get("username"), email: values.get("email"), temporaryPassword: values.get("temporaryPassword"),
    person: personMode === "existing" ? { id: values.get("person.id") } : {
      firstName: values.get("person.firstName"), paternalSurname: values.get("person.paternalSurname"), maternalSurname: values.get("person.maternalSurname") ?? "",
    }, roles, ...(!roles.includes("SUPERADMIN") && leagueId ? { leagueId } : {}),
    ...(roles.includes("CLUB_DELEGATE") ? { delegatePosition: values.get("delegatePosition") ?? undefined } : {}),
    ...(roles.includes("CLUB_DELEGATE") ? { delegatePeriod: formDelegatePeriod(
      String(values.get("delegatePeriodMode") ?? "now"),
      String(values.get("delegatePeriod.startsAt") ?? ""), String(values.get("delegatePeriod.endsAt") ?? "")) } : {}),
    ...(roles.includes("CLUB_DELEGATE") ? { club: clubMode === "new" ? { kind: "new", name: values.get("club.name") } : { kind: "existing", id: values.get("club.id") } } : {}),
  });
}
