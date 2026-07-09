/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Permite requests al Predictive Engine desde Server Components si se necesitan
  async rewrites() {
    return [
      {
        source: '/api/engine/:path*',
        destination: `${process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:8000/api/v1'}/:path*`,
      },
    ]
  },
}

export default nextConfig