"use client";
import { useState } from "react";
import Image from "next/image";
import { rgbHex, type UniformKit } from "@/features/clubs/uniform-kits";
import type { ReportPlayer } from "../types";

export function PlayerBadge({ player, jersey, kit, showPhoto = false }: { player?: ReportPlayer; jersey?: number | null; kit: UniformKit | null; showPhoto?: boolean }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const image = player?.photoUrl;
  return <span className="relative mx-auto block size-12 shrink-0 sm:size-14">
    {showPhoto && image && failedPhoto !== image ? <Image src={image} alt="" fill sizes="56px" unoptimized onError={() => setFailedPhoto(image)} className="rounded-xl border border-white/40 object-cover" /> : <svg viewBox="0 0 48 50" className="size-full drop-shadow-sm" aria-hidden="true"><path d="M14 4 5 10 1 21 10 25 13 19 12 47H36L35 19 38 25 47 21 43 10 34 4 29 2C29 9 19 9 19 2Z" fill={kit ? rgbHex(kit.primary) : "#e8eeee"} stroke="white" strokeWidth="1.3" /><path d="M15 5 19 3C20 10 28 10 29 3L33 5M15 40H34" fill="none" stroke={kit ? rgbHex(kit.secondary) : "#183e4a"} strokeWidth="3" /><rect x="17" y="17" width="15" height="17" rx="4" fill="white" opacity=".95" /><text x="24.5" y="29" textAnchor="middle" fill="#17282d" fontSize="12" fontWeight="700">{jersey ?? "+"}</text></svg>}
    {showPhoto && image && failedPhoto !== image && <span className="absolute -bottom-1 -right-1 min-w-5 rounded-md bg-white px-1 text-center text-xs font-bold text-[#17282d]">{jersey ?? "–"}</span>}
  </span>;
}
