/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint still runs locally via `npm run lint`; we don't let a lint
  // hiccup fail the Vercel production build. Type errors still fail it.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Profile avatars are served from Supabase Storage — allow next/image
  // (and plain <img>) to load them without host warnings.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
