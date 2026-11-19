import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/offline/report", headers: [{ key: "X-Report-Offline-Build", value: process.env.NODE_ENV === "production" ? "production" : "development" }] },
    ];
  },
  // Aislar compilación/lock de las pruebas sin interrumpir el dev del equipo.
  distDir: process.env.MATCH_REPORT_OFFLINE_TEST === "1" ? ".next-offline-tests" : process.env.AUTH_TEST_RUN === "1" ? `.next-auth-tests-${new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3198").port || "default"}` : ".next",
  allowedDevOrigins: process.env.NODE_ENV === "development" && process.env.PLAYER_DEMO_ORIGIN
    ? [new URL(process.env.PLAYER_DEMO_ORIGIN).hostname] : [],
  experimental: {
    agentUpgrade: "security",
    // Next 16.4: evita el fallo IPC de procesos CSS en Windows/Node 24.9.
    turbopackPluginRuntimeStrategy: "workerThreads",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
