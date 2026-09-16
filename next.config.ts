import type { NextConfig } from "next";
import { withPwa } from "./pwa.config";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  experimental: {
    useTypeScriptCli: true,
  },
};

export default withPwa(nextConfig);
