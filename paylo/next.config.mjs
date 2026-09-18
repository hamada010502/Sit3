/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['better-sqlite3'] },
  images: { unoptimized: true },
};
export default nextConfig;
