import { redirect } from "next/navigation";
import { requireOperationalUser } from "@/server/auth/session";
export default async function Page() {
  await requireOperationalUser();
  redirect("/matches");
}
