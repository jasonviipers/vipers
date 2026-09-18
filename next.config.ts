import type { NextConfig } from "next";
import { withPwa } from "./pwa.config";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  output: "standalone",
  experimental: {
    useTypeScriptCli: true,
  },
  async headers() {
    return [
      {
        // llms.txt discovery: HTML document responses advertise the
        // file that describes them (llms.txt spec link relation).
        source: "/:path*",
        has: [
          {
            type: "header",
            key: "accept",
            value: ".*text/html.*",
          },
        ],
        headers: [
          {
            key: "Link",
            value: '</llms.txt>; rel="describedby"; type="text/markdown"',
          },
        ],
      },
    ];
  },
};

export default withPwa(nextConfig);
