import { z } from "zod";

export const rgbSchema = z.strictObject({ r: z.number().int().min(0).max(255), g: z.number().int().min(0).max(255), b: z.number().int().min(0).max(255) });
export const uniformKitSchema = z.strictObject({ primary: rgbSchema, secondary: rgbSchema });
export const uniformKitsSchema = z.strictObject({ home: uniformKitSchema, away: uniformKitSchema });
export type RGB = z.infer<typeof rgbSchema>;
export type UniformKit = z.infer<typeof uniformKitSchema>;
export type UniformKits = z.infer<typeof uniformKitsSchema>;
export const rgbHex = (rgb: RGB) => `#${[rgb.r, rgb.g, rgb.b].map(n => n.toString(16).padStart(2, "0")).join("")}`;
export const hexRGB = (hex: string): RGB => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
export const rgbText = (rgb: RGB) => `RGB(${rgb.r}, ${rgb.g}, ${rgb.b})`;
export const describeKits = (kits: UniformKits) => `Local: ${rgbText(kits.home.primary)} / ${rgbText(kits.home.secondary)}. Visitante: ${rgbText(kits.away.primary)} / ${rgbText(kits.away.secondary)}.`;
export const defaultUniformKits: UniformKits = { home: { primary: { r: 22, g: 61, b: 75 }, secondary: { r: 255, g: 255, b: 255 } }, away: { primary: { r: 255, g: 255, b: 255 }, secondary: { r: 22, g: 61, b: 75 } } };
