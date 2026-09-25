// src/lib/jobs/mask.ts
/**
 * 작업 로그·텔레그램에 남기기 전에 개인정보와 비밀값을 가린다.
 * 주문 수집이 붙으면 오류 메시지에 수취인 연락처가 섞여 들어올 수 있다 — 기록 전에 반드시 거친다.
 */
const MAX_LEN = 500;

export function maskPII(input: string): string {
  return input
    .replace(/(01[016789])(-?)(\d{3,4})(-?)(\d{4})/g, (_m, a, s1, _mid, s2, d) => `${a}${s1}****${s2}${d}`)
    .replace(/([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2')
    .replace(/(Bearer\s+)\S+/gi, '$1***')
    .replace(/([?&](?:secret|token|key|signature)=)[^&\s]+/gi, '$1***')
    .slice(0, MAX_LEN);
}
