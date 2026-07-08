import type { NextConfig } from "next";
import path from "path";

const sharedPath = path.resolve(__dirname, '../shared');

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, '..'),
    resolveAlias: {
      '@shared': sharedPath,
    },
  },
  webpack(config) {
    config.resolve.alias['@shared'] = sharedPath;
    return config;
  },
};

export default nextConfig;
