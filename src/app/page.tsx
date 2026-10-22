import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";
import { SportSelection } from "@/features/public-portal/components/sport-selection";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";

export const metadata: Metadata = {
  title: { absolute: "Elige tu deporte | Gestor de Ligas Deportivas" },
  description: "Elige fútbol para iniciar sesión en la Liga Municipal de Morelia o continuar como espectador. Básquetbol y voleibol, próximamente.",
};

export default async function Home() {
  const current = await getCurrentAccount();
  return <PublicShell current={current}><SportSelection /></PublicShell>;
}
