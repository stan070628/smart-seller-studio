import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /**
   * Turbopack resolve alias 설정
   * - canvas: Fabric.js 선택적 서버 의존성 무력화
   * - dompurify: browser-only 패키지를 SSR 빌드에서 identity stub으로 대체
   */
  turbopack: {
    resolveAlias: {
      canvas: "./src/lib/empty-module.ts",
      dompurify: "./src/lib/dompurify-ssr.ts",
    },
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: path.resolve("./src/lib/empty-module.ts"),
        dompurify: path.resolve("./src/lib/dompurify-ssr.ts"),
      };
    }
    return config;
  },
};

export default nextConfig;
