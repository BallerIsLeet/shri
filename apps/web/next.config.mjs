import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained build for Docker deployment.
  output: 'standalone',
  // Workspace packages import from source (.ts) rather than dist — Next needs
  // to know to transpile them rather than treat them as opaque node_modules.
  transpilePackages: [
    "@shri/db",
    "@shri/storage",
    "@shri/ai",
    "@shri/prompts-fs",
    "@shri/tools",
    "@shri/orchestrator",
    "@shri/seedance",
  ],
  // Workspace packages use TypeScript ESM-style imports (./foo.js → foo.ts).
  // Webpack's default resolver takes .js literally; extensionAlias fixes that.
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };

    if (isServer) {
      // serverComponentsExternalPackages handles static imports, but native-addon
      // packages with broken ESM internals (opencv) or platform-.node binaries
      // (resvg-js) also fail during dynamic import() resolution. webpack externals
      // fires before resolution and covers both cases.
      const prev = [config.externals].flat().filter(Boolean);
      config.externals = [
        ...prev,
        ({ request }, callback) => {
          if (
            request === '@u4/opencv4nodejs' ||
            request?.startsWith('@u4/opencv4nodejs/') ||
            request === '@resvg/resvg-js' ||
            request?.startsWith('@resvg/resvg-js-')
          ) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }

    return config;
  },
  experimental: {
    // Required so Next's output-file tracer uses repo root as the base path,
    // keeping the standalone directory structure correct for the monorepo.
    outputFileTracingRoot: path.join(__dirname, '../../'),
    // Avoid bundling these into server bundles — they pull native deps
    // (sharp, opencv, ffmpeg) that must be loaded at runtime.
    serverComponentsExternalPackages: [
      "@prisma/client",
      "prisma",
      "sharp",
      "@u4/opencv4nodejs",
      "@resvg/resvg-js",
      "fluent-ffmpeg",
      "ffmpeg-static",
      "@aws-sdk/client-s3",
      "@aws-sdk/s3-request-presigner",
      "bullmq",
      "ioredis",
    ],
  },
};

export default nextConfig;
