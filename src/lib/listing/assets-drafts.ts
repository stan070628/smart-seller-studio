/**
 * assets-drafts.ts
 * 상품 소재 임시저장 클라이언트 라이브러리
 *
 * /api/listing/assets/drafts 엔드포인트를 호출하는 fetch 래퍼 함수 모음
 */

export interface AssetsDraftMeta {
  id: string;
  name: string;
  draftData: Record<string, unknown>;
  createdAt: string;
}

/**
 * 임시저장 목록 조회
 * 인증 실패나 서버 에러 시 빈 배열 반환 (non-throwing)
 */
export async function getAssetsDrafts(): Promise<AssetsDraftMeta[]> {
  try {
    const res = await fetch('/api/listing/assets/drafts');
    if (!res.ok) return [];
    const json = await res.json();
    return json.drafts ?? [];
  } catch {
    return [];
  }
}

/**
 * 임시저장 생성
 * 서버 에러 시 에러를 던진다
 */
export async function saveAssetsDraft(
  name: string,
  draftData: Record<string, unknown>,
): Promise<AssetsDraftMeta> {
  const res = await fetch('/api/listing/assets/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, draftData }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? '임시저장 실패');
  return {
    id: json.id as string,
    name,
    draftData,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 임시저장 삭제
 * 서버 에러 시 에러를 던진다
 */
export async function deleteAssetsDraft(id: string): Promise<void> {
  const res = await fetch(`/api/listing/assets/drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? '삭제 실패');
  }
}
