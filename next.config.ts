import type { NextConfig } from "next";

const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const githubPagesBasePath = "/ink-ritual";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  ...(isGitHubActions
    ? {
        assetPrefix: `${githubPagesBasePath}/`,
      }
    : {}),
};

export default nextConfig;
