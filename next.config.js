const path = require('path');

const requestedOutputMode = process.env.NEXT_OUTPUT_MODE;
const isSupportedOutputMode = requestedOutputMode === 'standalone' || requestedOutputMode === 'export';

// Vercel handles Next.js output automatically.
// Forcing custom output modes there (especially "standalone") can lead to deploy-time 404 routing.
const outputMode = process.env.VERCEL ? undefined : (isSupportedOutputMode ? requestedOutputMode : undefined);

// Keep Vercel on the framework default dist directory (.next) even if NEXT_DIST_DIR is set.
// A custom distDir on Vercel can cause the runtime to miss built routes and surface 404s.
const distDir = process.env.VERCEL ? '.next' : (process.env.NEXT_DIST_DIR || '.next');

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
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
