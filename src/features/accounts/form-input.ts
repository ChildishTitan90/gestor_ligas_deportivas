import { createAccountSchema } from "./schemas";

export function parseAccountForm(values: FormData, roles: string[], leagueId: string, personMode: string, clubMode: string) {
  return createAccountSchema.safeParse({
    username: values.get("username"), email: values.get("email"), temporaryPassword: values.get("temporaryPassword"),
    person: personMode === "existing" ? { id: values.get("person.id") } : {
      firstName: values.get("person.firstName"), paternalSurname: values.get("person.paternalSurname"), maternalSurname: values.get("person.maternalSurname") ?? "",
    }, roles, ...(!roles.includes("SUPERADMIN") && leagueId ? { leagueId } : {}),
    ...(roles.includes("CLUB_DELEGATE") ? { club: clubMode === "new" ? { kind: "new", name: values.get("club.name") } : { kind: "existing", id: values.get("club.id") } } : {}),
  });
}
