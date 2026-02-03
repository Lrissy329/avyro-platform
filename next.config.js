const remotePatterns = [
  {
    protocol: "https",
    hostname: "source.unsplash.com",
    port: "",
    pathname: "/**",
  },
];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl) {
  try {
    const { hostname } = new URL(supabaseUrl);
    if (hostname) {
      remotePatterns.push({
        protocol: "https",
        hostname,
        port: "",
        pathname: "/storage/v1/object/public/**",
      });
    }
  } catch {
    // ignore malformed url
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns,
  },
};

module.exports = nextConfig;
