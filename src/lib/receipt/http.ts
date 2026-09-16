/**
 * 영수증 API 응답 읽기.
 *
 * 🔴 **res.json()을 곧바로 부르지 않는다.** 이 앱의 라우트는 실패해도 JSON을
 * 돌려주지만, **함수에 닿기 전에 플랫폼이 끊는 응답은 JSON이 아니다** —
 * Vercel은 요청 본문이 4.5MB를 넘으면 함수를 실행하지 않고 text/plain 413을
 * 반환한다. 그 본문에 .json()을 걸면 브라우저가 파싱 예외를 던지고, 사파리는
 * 그것을 "The string did not match the expected pattern."이라는 영문으로
 * 표현한다. 2026-09-16 아이폰에서 그 문구가 그대로 사용자에게 노출됐다.
 *
 * 브라우저가 무엇을 던지든 사용자는 **무엇을 해야 하는지**를 읽어야 한다.
 */

/** 본문이 JSON이 아닐 때 사용자에게 보일 문장 */
function describeNonJson(status: number, snippet: string): string {
  if (status === 413) {
    return `사진 용량이 커서 서버가 받지 못했습니다 (413). 장수를 줄이거나 다시 촬영해 주세요.`;
  }
  if (status === 401 || status === 403) {
    return `로그인이 풀렸습니다 (${status}). 새로고침 후 다시 로그인해 주세요.`;
  }
  if (status === 504 || status === 408) {
    return `서버 응답이 시간 안에 오지 않았습니다 (${status}). 잠시 뒤 다시 시도해 주세요.`;
  }
  if (status >= 500) {
    return `서버 오류입니다 (${status}). 잠시 뒤 다시 시도해 주세요.`;
  }
  // 분류되지 않은 경우에만 원문 조각을 붙인다 — 단서를 아주 버리지는 않는다
  return snippet
    ? `서버가 JSON이 아닌 응답을 보냈습니다 (${status}): ${snippet}`
    : `서버가 JSON이 아닌 응답을 보냈습니다 (${status}).`;
}

/**
 * JSON이면 파싱해 돌려주고, 아니면 한국어 Error를 던진다.
 *
 * 상태코드가 4xx·5xx여도 **본문이 JSON이면 그대로 파싱한다** — 라우트가
 * 담아 보낸 한국어 메시지(`지원하지 않는 형식` 등)를 살려야 하기 때문이다.
 */
export async function readJsonOrThrow<T = unknown>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }

  const snippet = (await res.text().catch(() => ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  throw new Error(describeNonJson(res.status, snippet));
}
