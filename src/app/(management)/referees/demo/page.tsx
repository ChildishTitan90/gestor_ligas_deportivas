import { redirect } from "next/navigation";

/** Compatibilidad con enlaces de la revisión visual ya retirada. */
export default function Page() {
  redirect("/referees");
}
