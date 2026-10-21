import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";
import { SportSelection } from "@/features/public-portal/components/sport-selection";

export const metadata: Metadata = {
  title: { absolute: "Elige tu deporte | Gestor de Ligas Deportivas" },
  description: "Elige fútbol para iniciar sesión en la Liga Municipal de Morelia o continuar como espectador. Básquetbol y voleibol, próximamente.",
};

export default function Home() {
  return <PublicShell><SportSelection /></PublicShell>;
}
