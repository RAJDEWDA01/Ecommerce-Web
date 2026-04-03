import type { NextConfig } from "next";
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');
const allowLocalImageIps =
  process.env.NEXT_IMAGE_ALLOW_LOCAL_IP === 'true' || process.env.NODE_ENV !== 'production';
const allowThirdPartyRemoteImages =
  process.env.NEXT_IMAGE_ALLOW_THIRD_PARTY === 'true' || process.env.NODE_ENV !== 'production';

const thirdPartyImageOrigins = [
  { protocol: 'https' as const, hostname: 'thumbs.dreamstime.com', port: '' },
  { protocol: 'https' as const, hostname: 'media.istockphoto.com', port: '' },
  { protocol: 'https' as const, hostname: 'tse3.mm.bing.net', port: '' },
  { protocol: 'https' as const, hostname: '*.mm.bing.net', port: '' },
];

const defaultImageOrigins = [
  { protocol: 'http' as const, hostname: 'localhost', port: '5000' },
  { protocol: 'http' as const, hostname: '127.0.0.1', port: '5000' },
  ...(allowThirdPartyRemoteImages ? thirdPartyImageOrigins : []),
];

const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const configuredOrigin =
  configuredApiBaseUrl && (() => {
    try {
      const parsed = new URL(configuredApiBaseUrl);
      return {
        protocol: parsed.protocol.replace(':', '') as 'http' | 'https',
        hostname: parsed.hostname,
        port: parsed.port,
      };
    } catch {
      return null;
    }
  })();

const imageOrigins = configuredOrigin
  ? [...defaultImageOrigins, configuredOrigin]
  : defaultImageOrigins;

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    dangerouslyAllowLocalIP: allowLocalImageIps,
    remotePatterns: imageOrigins.map((origin) => ({
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port || undefined,
      pathname: '/**',
    })),
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
