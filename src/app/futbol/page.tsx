import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";
import { FootballPortal } from "@/features/public-portal/components/football-portal";

export const metadata: Metadata = {
  title: "Portal público de fútbol",
  description: "Partidos, resultados y posiciones publicados por la Liga Municipal de Fútbol de Morelia. Acceso para espectadores sin cuenta.",
};

export default function FootballPage() {
  return <PublicShell football><FootballPortal /></PublicShell>;
}
