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
  // Avoid bundling these into edge/server bundles — they pull native deps
  // (sharp, opencv, ffmpeg) that should stay external. Next 14 spelling.
  // Workspace packages use TypeScript ESM-style imports (./foo.js → foo.ts).
  // Webpack's default resolver takes .js literally; extensionAlias fixes that.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
  experimental: {
    // Required so Next's output-file tracer uses repo root as the base path,
    // keeping the standalone directory structure correct for the monorepo.
    outputFileTracingRoot: path.join(__dirname, '../../'),
    serverComponentsExternalPackages: [
      "@prisma/client",
      "prisma",
      "sharp",
      "@u4/opencv4nodejs",
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
