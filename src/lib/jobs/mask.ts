// src/lib/jobs/mask.ts
/**
 * 작업 로그·텔레그램에 남기기 전에 개인정보와 비밀값을 가린다.
 * 주문 수집이 붙으면 오류 메시지에 수취인 연락처가 섞여 들어올 수 있다 — 기록 전에 반드시 거친다.
 * 이 함수는 이름·주소를 가리지 못한다 — 호출부는 응답 본문·요청 헤더가 아니라 오류 code·message만 넘긴다.
 */
const MAX_LEN = 500;
const SCAN_LEN = 2_000; // 정규식 비용 상한. MAX_LEN + 최장 매치보다 충분히 커야 경계 누출이 없다

export function maskPII(input: string): string {
  const window =
    input.length > SCAN_LEN
      ? input.slice(0, SCAN_LEN).replace(/[\d+\s.-]*\S{0,64}$/, '') // 경계에 걸린 번호·이메일 조각 제거
      : input;
  return window
    .replace(
      /(?<!\d)(\+82[-\s]?|0)(1[016789])([-\s]?)\d{3,4}([-\s]?)(\d{4})(?!\d)/g,
      (_m, p, a, s1, s2, d) => `${p}${a}${s1}****${s2}${d}`
    )
    .replace(/([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2')
    .replace(/(Bearer\s+)\S+/gi, '$1***')
    .replace(/([?&][\w-]*(?:secret|token|key|signature|sign)=)[^&\s]+/gi, '$1***')
    .slice(0, MAX_LEN);
}
