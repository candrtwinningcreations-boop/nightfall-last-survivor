const path = require('path');

const requestedOutputMode = process.env.NEXT_OUTPUT_MODE;
const isSupportedOutputMode = requestedOutputMode === 'standalone' || requestedOutputMode === 'export';

// Vercel handles Next.js output automatically.
// Forcing custom output modes there (especially "standalone") can lead to deploy-time 404 routing.
const outputMode = process.env.VERCEL ? undefined : (isSupportedOutputMode ? requestedOutputMode : undefined);

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: outputMode,
  productionBrowserSourceMaps: false,
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../'),
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.output.filename = 'static/chunks/[name]-[contenthash:8].js';
      config.output.chunkFilename = 'static/chunks/[contenthash:16].js';
    }
    return config;
  },
};

module.exports = nextConfig;
