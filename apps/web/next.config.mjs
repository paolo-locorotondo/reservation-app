/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@carbon/react", "@carbon/icons-react", "@reservation/shared"],
  sassOptions: {
    includePaths: ["./src/styles"],
  },
};

export default nextConfig;
