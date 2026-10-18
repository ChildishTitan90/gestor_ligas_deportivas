import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionActivity } from "@/features/auth/components/session-activity";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Liga Municipal de Morelia",
    template: "%s | Liga Municipal de Morelia",
  },
  description: "Gestión de la Liga Municipal de Fútbol de Morelia.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionActivity />
        {children}
      </body>
    </html>
  );
}
