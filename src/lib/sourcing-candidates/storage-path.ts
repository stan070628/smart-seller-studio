/**
 * 소싱 후보 캡처의 Storage 경로.
 * 공개 버킷이라 완화책은 경로 추측 불가능성뿐이다(영수증과 같다) — uuid를 경로에 넣는다.
 * 브라우저가 전부 JPEG로 만들어 보내므로 확장자는 jpg 하나다.
 * 판독 후에도 지우지 않는다 — 오독을 원본과 대조해야 한다.
 */
function assertIndex(index: number) {
  if (index < 0 || !Number.isInteger(index)) throw new Error(`index는 0 이상의 정수여야 합니다: ${index}`);
}

export function scanImagePath(userId: string, scanId: string, index: number): string {
  assertIndex(index);
  return `sourcing-candidates/${userId}/scans/${scanId}/${index}.jpg`;
}

export function offerImagePath(userId: string, offerId: string, index: number): string {
  assertIndex(index);
  return `sourcing-candidates/${userId}/offers/${offerId}/${index}.jpg`;
}
