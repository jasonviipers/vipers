import type { NextConfig } from "next";
import { withPwa } from "./pwa.config";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  serverExternalPackages: ["@mastra/*"],
  experimental: {
    useTypeScriptCli: true,
  },
};

export default withPwa(nextConfig);
