/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permite requests al Predictive Engine desde Server Components si se necesitan
  async rewrites() {
    return [
      {
        source: '/api/engine/:path*',
        destination: `${process.env.NEXT_PUBLIC_ENGINE_URL}/:path*`,
      },
    ]
  },
}

export default nextConfig