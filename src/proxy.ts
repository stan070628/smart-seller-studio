/**
 * proxy.ts
 * Next.js 16+ Edge 프록시 — 라우트 보호 비활성화 (개인 사용 전용)
 */

import { NextRequest, NextResponse } from 'next/server'

export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/editor/:path*', '/projects/:path*'],
}
