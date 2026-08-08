import type { AllowedMimeType } from '@/lib/ai/claude-vision';

/**
 * 영수증 이미지의 Storage 경로.
 *
 * 공개 버킷에 저장하므로 완화책은 경로 추측 불가능성뿐이다.
 * draft uuid를 경로에 넣어 순번만으로는 다른 영수증에 도달할 수 없게 한다.
 */

const EXT: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function receiptImagePath(
  userId: string,
  draftId: string,
  index: number,
  mimeType: AllowedMimeType,
): string {
  if (index < 0 || !Number.isInteger(index)) {
    throw new Error(`index는 0 이상의 정수여야 합니다: ${index}`);
  }
  return `receipts/${userId}/${draftId}/${index}.${EXT[mimeType]}`;
}
