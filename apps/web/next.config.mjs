/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages import from source (.ts) rather than dist — Next needs
  // to know to transpile them rather than treat them as opaque node_modules.
  transpilePackages: [
    "@shri/db",
    "@shri/storage",
    "@shri/ai",
    "@shri/prompts-fs",
    "@shri/tools",
  ],
  // Avoid bundling these into edge/server bundles — they pull native deps
  // (sharp, opencv, ffmpeg) that should stay external. Next 14 spelling.
  experimental: {
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
