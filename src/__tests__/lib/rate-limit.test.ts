/**
 * rate-limit.test.ts
 * src/lib/rate-limit.ts 의 checkRateLimit, getRateLimitKey, RATE_LIMITS 단위 테스트
 *
 * vi.useFakeTimers() 로 Date.now()를 제어하여 시간 윈도우 만료를 시뮬레이션합니다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit'

// ---------------------------------------------------------------------------
// 헬퍼: 모듈 내부 store를 초기화하기 위해 매 테스트마다 모듈을 리임포트
// store는 모듈 스코프 Map이므로, vi.resetModules()로 각 테스트를 격리합니다.
// ---------------------------------------------------------------------------

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // store를 비우기 위해 모듈을 다시 로드
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('첫 번째 요청은 allowed=true, remaining=maxRequests-1을 반환한다', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const config = { windowMs: 60_000, maxRequests: 10 }

    const result = checkRateLimit('test-key', config)

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9)
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('maxRequests번 요청 후에는 allowed=false, remaining=0을 반환한다', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const config = { windowMs: 60_000, maxRequests: 3 }
    const key = 'limit-test-key'

    // 3번 소진
    checkRateLimit(key, config)
    checkRateLimit(key, config)
    checkRateLimit(key, config)

    // 4번째 요청 → 한도 초과
    const result = checkRateLimit(key, config)

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('시간 윈도우 만료 후에는 새 윈도우가 시작되어 allowed=true로 복구된다', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const config = { windowMs: 60_000, maxRequests: 2 }
    const key = 'window-reset-key'

    // 한도 소진
    checkRateLimit(key, config)
    checkRateLimit(key, config)
    const blocked = checkRateLimit(key, config)
    expect(blocked.allowed).toBe(false)

    // 윈도우(60초) 경과
    vi.advanceTimersByTime(60_001)

    // 새 윈도우에서 첫 요청 → 복구
    const recovered = checkRateLimit(key, config)
    expect(recovered.allowed).toBe(true)
    expect(recovered.remaining).toBe(1)
  })

  it('다른 키는 독립적으로 카운트된다', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const config = { windowMs: 60_000, maxRequests: 1 }

    // keyA 한도 소진
    checkRateLimit('keyA', config)
    const blockedA = checkRateLimit('keyA', config)
    expect(blockedA.allowed).toBe(false)

    // keyB는 별도 카운트이므로 첫 요청은 허용
    const allowedB = checkRateLimit('keyB', config)
    expect(allowedB.allowed).toBe(true)
  })

  it('다른 엔드포인트는 독립적으로 카운트된다', async () => {
    const { checkRateLimit, getRateLimitKey } = await import('@/lib/rate-limit')
    const config = { windowMs: 60_000, maxRequests: 1 }
    const ip = '1.2.3.4'

    const keyA = getRateLimitKey(ip, 'endpoint-a')
    const keyB = getRateLimitKey(ip, 'endpoint-b')

    // endpoint-a 한도 소진
    checkRateLimit(keyA, config)
    const blockedA = checkRateLimit(keyA, config)
    expect(blockedA.allowed).toBe(false)

    // endpoint-b는 별도 키이므로 첫 요청 허용
    const allowedB = checkRateLimit(keyB, config)
    expect(allowedB.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getRateLimitKey
// ---------------------------------------------------------------------------

describe('getRateLimitKey', () => {
  it('"ip:endpoint" 형태의 문자열을 반환한다', () => {
    expect(getRateLimitKey('192.168.1.1', 'generate-copy')).toBe('192.168.1.1:generate-copy')
    expect(getRateLimitKey('unknown', 'render')).toBe('unknown:render')
  })
})

// ---------------------------------------------------------------------------
// RATE_LIMITS 상수
// ---------------------------------------------------------------------------

describe('RATE_LIMITS 상수', () => {
  it('AI_API는 windowMs=60000, maxRequests=10이다', () => {
    expect(RATE_LIMITS.AI_API.windowMs).toBe(60_000)
    expect(RATE_LIMITS.AI_API.maxRequests).toBe(10)
  })

  it('UPLOAD는 windowMs=60000, maxRequests=30이다', () => {
    expect(RATE_LIMITS.UPLOAD.windowMs).toBe(60_000)
    expect(RATE_LIMITS.UPLOAD.maxRequests).toBe(30)
  })

  it('RENDER는 windowMs=60000, maxRequests=5이다', () => {
    expect(RATE_LIMITS.RENDER.windowMs).toBe(60_000)
    expect(RATE_LIMITS.RENDER.maxRequests).toBe(5)
  })
})
