import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: appDir,
  // Hide the "N▴" dev-mode indicator that floats in the bottom-left
  // during `next dev` — it sits on top of the dashboard's own chrome
  // and is visible in screenshots. Production builds never render it.
  devIndicators: false
};

export default nextConfig;
