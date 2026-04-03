/**
 * AI API 탄력성 유틸리티 (api_resilience.py → TypeScript 포팅)
 *
 * - 지수 백오프 + jitter (calc_backoff)
 * - 429/5xx 자동 재시도, Retry-After 헤더 처리 (with_retry)
 * - Anthropic SDK / Google Gemini SDK / 네트워크 에러 분류
 * - API 키 오류·404·4xx → 재시도 없이 즉시 실패
 *
 * NOTE: instanceof 대신 duck-typing 사용
 *   — Anthropic.APIError 등 중첩 클래스가 런타임에 생성자로 노출되지 않는
 *     환경(Edge Runtime, 일부 번들러)에서 "instanceof 우변이 객체가 아님" 오류 방지
 */

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 60_000;
const DEFAULT_JITTER = 0.2;

// ─────────────────────────────────────────
// 백오프 계산 (api_resilience.py calc_backoff 대응)
// ─────────────────────────────────────────

function calcBackoff(
  attempt: number,
  base = DEFAULT_BASE_DELAY_MS,
  maxDelay = DEFAULT_MAX_DELAY_MS,
  jitter = DEFAULT_JITTER
): number {
  const delay = Math.min(base * 2 ** attempt, maxDelay);
  const jitterRange = delay * jitter;
  return delay + (Math.random() * 2 - 1) * jitterRange;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────
// Duck-typing 헬퍼
// ─────────────────────────────────────────

/** Anthropic SDK HTTPError 계열 — status 숫자 + headers 객체 보유 */
function isAnthropicHttpError(
  error: unknown
): error is { status: number; headers: Record<string, string> } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as Record<string, unknown>).status === "number" &&
    "headers" in error
  );
}

/** Anthropic SDK 연결/타임아웃 오류 — status 없음, code 문자열 보유 */
function isAnthropicConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { constructor?: { name?: string } }).constructor?.name;
  return name === "APIConnectionError" || name === "APITimeoutError";
}

// ─────────────────────────────────────────
// 에러 분류 (api_resilience.py with_retry 내부 로직 대응)
// ─────────────────────────────────────────

interface RetryDecision {
  retryable: boolean;
  waitMs: number;
}

function classifyError(error: unknown, attempt: number): RetryDecision {
  // ── Anthropic SDK HTTP 에러 (duck-typing) ─────────────
  if (isAnthropicHttpError(error)) {
    const status = error.status;

    if (status === 429) {
      // Retry-After 헤더 우선 적용 (api_resilience.py 429 처리와 동일)
      const retryAfter = error.headers?.["retry-after"];
      const waitMs = retryAfter
        ? parseFloat(retryAfter) * 1_000
        : calcBackoff(attempt);
      return { retryable: true, waitMs };
    }

    if (RETRYABLE_HTTP_STATUS.has(status)) {
      return { retryable: true, waitMs: calcBackoff(attempt) };
    }

    // 4xx (429 제외) → API 키 오류·권한 오류 등 재시도 불필요
    if (status >= 400 && status < 500) {
      return { retryable: false, waitMs: 0 };
    }
  }

  // Anthropic 연결/타임아웃 (duck-typing) → 재시도
  if (isAnthropicConnectionError(error)) {
    return { retryable: true, waitMs: calcBackoff(attempt) };
  }

  // ── Error 메시지 기반 분류 (Gemini SDK + 공통) ─────────
  if (error instanceof Error) {
    const msg = error.message;

    // API 키 오류·모델 없음·권한 없음 → 즉시 실패
    if (
      msg.includes("API_KEY") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("404") ||
      msg.includes("is not found") ||
      msg.includes("not supported")
    ) {
      return { retryable: false, waitMs: 0 };
    }

    // Quota / Rate limit — 재시도 불필요 (분/일 단위 한도 초과는 즉시 실패)
    if (
      msg.includes("RESOURCE_EXHAUSTED") ||
      msg.includes("quota") ||
      msg.includes("429")
    ) {
      return { retryable: false, waitMs: 0 };
    }

    // 서버 오류 → 일반 백오프 재시도
    if (
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504")
    ) {
      return { retryable: true, waitMs: calcBackoff(attempt) };
    }

    // 네트워크 오류 → 재시도
    if (
      msg.includes("fetch") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ETIMEDOUT") ||
      msg.toLowerCase().includes("network")
    ) {
      return { retryable: true, waitMs: calcBackoff(attempt) };
    }
  }

  return { retryable: false, waitMs: 0 };
}

// ─────────────────────────────────────────
// 재시도 래퍼 (api_resilience.py with_retry 대응)
// ─────────────────────────────────────────

interface RetryOptions {
  maxRetries?: number;
  label?: string;
}

/**
 * 지수 백오프 + jitter 재시도 래퍼
 *
 * @param fn - 실행할 비동기 함수
 * @param options.maxRetries - 최대 재시도 횟수 (기본 3)
 * @param options.label - 로그 식별자
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = DEFAULT_MAX_RETRIES, label = "API" }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const { retryable, waitMs } = classifyError(error, attempt);

      if (!retryable || attempt === maxRetries) throw error;

      console.warn(
        `[Resilience] ${label} attempt ${attempt + 1}/${maxRetries + 1}, ` +
          `retry in ${(waitMs / 1_000).toFixed(1)}s — ` +
          (error instanceof Error ? error.message : String(error))
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}
