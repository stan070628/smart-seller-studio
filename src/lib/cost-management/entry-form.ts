/**
 * 입고 폼의 선택 입력 파싱.
 *
 * RG 물류비처럼 「비워두면 서버가 채우는」 칸은 빈 칸과 0원을 구분해야 한다.
 * 0을 기본값으로 두고 항상 보내면 서버의 사이즈 요율 폴백이 무력화된다.
 */

/**
 * 빈 칸이면 `undefined`를 돌려준다 — 페이로드에서 빼면 서버가 기본값을 채운다.
 * 값을 적었으면 정수로 반올림해 그대로 보낸다. 0도 값이다.
 */
export function parseOptionalFee(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}
