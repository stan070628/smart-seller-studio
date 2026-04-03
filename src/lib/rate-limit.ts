interface RateLimitEntry {
  count: number
  resetAt: number  // timestamp (ms)
}

// Vercel Serverless 환경에서는 프로세스가 재시작되면 초기화됨
// 단순 메모리 Map 기반으로 구현 (Redis 없이 운영 가능)
const store = new Map<string, RateLimitEntry>()

export interface RateLimitConfig {
  windowMs: number    // 시간 윈도우 (밀리초)
  maxRequests: number // 윈도우 내 최대 요청 수
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    // 새 윈도우 시작
    store.set(key, { count: 1, resetAt: now + config.windowMs })
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs }
  }

  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt }
}

// 키 생성 헬퍼
export function getRateLimitKey(ip: string, endpoint: string): string {
  return `${ip}:${endpoint}`
}

// 사전 정의된 제한 설정
export const RATE_LIMITS = {
  AI_API: { windowMs: 60_000, maxRequests: 10 },  // 분당 10회
  UPLOAD: { windowMs: 60_000, maxRequests: 30 },  // 분당 30회
  RENDER: { windowMs: 60_000, maxRequests: 5 },   // 분당 5회
} as const
