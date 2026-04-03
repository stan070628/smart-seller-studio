import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Turbopack resolve alias 설정
   * Fabric.js 의 선택적 node-canvas 의존성이 서버에서 오류를 일으키지 않도록
   * 빈 모듈로 대체한다.
   */
  turbopack: {
    resolveAlias: {
      canvas: "./src/lib/empty-module.ts",
    },
  },
};

export default nextConfig;
