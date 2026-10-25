import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Aislar compilación/lock de las pruebas sin interrumpir el dev del equipo.
  distDir: process.env.AUTH_TEST_RUN === "1" ? ".next-auth-tests" : ".next",
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
