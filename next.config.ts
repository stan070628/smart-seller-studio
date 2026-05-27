import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // node_modules.nosync 심링크로 인해 build trace 수집 시 양쪽 경로를 모두 스캔해
  // 메모리를 2배 이상 소모하는 문제를 방지한다.
  // serverExternalPackages에 포함된 무거운 패키지들은 trace에서 제외한다.
  outputFileTracingExcludes: {
    '**': [
      '**/node_modules*/@swc/**',
      '**/node_modules*/sharp/**',
      '**/node_modules*/@resvg/**',
      '**/node_modules*/puppeteer-core/**',
      '**/node_modules*/@sparticuz/**',
      '**/node_modules*/typescript/**',
      '**/node_modules*/webpack/**',
      '**/node_modules*/esbuild/**',
      '**/node_modules*/next/dist/compiled/webpack/**',
      '**/node_modules*/next/dist/server/lib/router-utils/**',
      '**/*.node',
    ],
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
      // node_modules.nosync 심링크로 인해 serverExternalPackages 매칭이 실패하는 문제 보완.
      // 네이티브 바이너리 패키지를 명시적으로 externals에 추가한다.
      const nativeExternals = [
        '@resvg/resvg-js',
        /^@resvg\//,
        'sharp',
        'puppeteer-core',
        '@sparticuz/chromium-min',
        'pg',
      ];
      if (Array.isArray(config.externals)) {
        config.externals.push(...nativeExternals);
      } else {
        config.externals = [config.externals, ...nativeExternals].filter(Boolean);
      }
    }
    return config;
  },
};

export default nextConfig;
