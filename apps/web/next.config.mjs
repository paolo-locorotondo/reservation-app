import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `standalone` produce un bundle self-contained in `.next/standalone/` con
  // solo i file effettivamente necessari (server.js + node_modules tracciati).
  // Imprescindibile per immagini Docker piccole.
  output: "standalone",
  // In monorepo, Next traccia i file partendo da `outputFileTracingRoot` per
  // includere anche le workspace dep (es. `@reservation/shared`, `@carbon/*`).
  // Senza questa riga, lo standalone dimentica deps fuori da `apps/web/`.
  // NB: in Next 14 sta sotto `experimental`; è promosso top-level in Next 15.
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../.."),
  },
  transpilePackages: ["@carbon/react", "@carbon/icons-react", "@reservation/shared"],
  sassOptions: {
    includePaths: ["./src/styles"],
  },
};

export default nextConfig;
