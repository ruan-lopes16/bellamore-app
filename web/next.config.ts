import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {},
  webpack(config) {
    config.resolve.alias['@shared'] = path.resolve(process.cwd(), '../shared');
    return config;
  },
};

export default nextConfig;
