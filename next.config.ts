import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /**
   * 개발 서버를 LAN IP로 접근할 때 필요하다.
   * Next.js는 기본적으로 dev 리소스(/_next/*)의 cross-origin 요청을 막는데,
   * 그러면 폰에서 HTML은 받지만 JS 번들을 못 받아 React가 붙지 않는다 —
   * 화면은 보이는데 버튼이 전부 죽는다.
   *
   * 프로덕션 빌드에는 영향이 없다.
   */
  allowedDevOrigins: ['192.168.0.183', '192.168.0.*', 'localhost'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  /**
   * 네이티브 바이너리(@resvg/resvg-js, sharp)는 번들러 외부로 처리.
   * Turbopack/Webpack이 platform-specific .node 모듈을 번들에 포함하지 않도록 한다.
   */
  serverExternalPackages: ['@resvg/resvg-js', 'sharp', 'puppeteer-core', '@sparticuz/chromium-min', 'pg'],
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
