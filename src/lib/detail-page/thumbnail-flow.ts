/**
 * detail-maker 썸네일 생성/수정 흐름.
 * 신규 백엔드 없이 기존 API를 조합한다.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export interface TextBadgeOptions {
  text: string;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

/**
 * 참고 이미지 URL + 연출 방향으로 썸네일을 생성하고 쿠팡 규격으로 리사이즈한 최종 URL을 반환한다.
 * 흐름: generate-thumbnail → upload-ai → coupang-resize → (선택) add-text-badge
 */
export async function generateCoupangThumbnail(
  refImageUrls: string[],
  direction: string,
  textBadge?: TextBadgeOptions,
): Promise<string> {
  // 1. 생성
  const genRes = await fetch('/api/ai/generate-thumbnail', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ refImageUrls, direction }),
  });
  const genJson = (await genRes.json()) as
    | { success: true; data: { imageBase64: string; mimeType: string } }
    | { success: false; error: string };
  if (!genRes.ok || !genJson.success) {
    throw new Error(genJson.success === false ? genJson.error : '썸네일 생성 실패');
  }

  // 2. Supabase 영속화
  const upRes = await fetch('/api/image/upload-ai', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      imageBase64: genJson.data.imageBase64,
      mimeType: genJson.data.mimeType,
    }),
  });
  const upJson = (await upRes.json()) as { success: boolean; url?: string; error?: string };
  if (!upRes.ok || !upJson.success || !upJson.url) {
    throw new Error(upJson.error ?? '이미지 업로드 실패');
  }
  const tempUrl = upJson.url;

  // 3. 쿠팡 규격 리사이즈 (실패해도 치명적 아님 → 업로드 URL 폴백)
  let finalUrl = tempUrl;
  try {
    const rsRes = await fetch('/api/image/coupang-resize', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ imageUrl: tempUrl }),
    });
    const rsJson = (await rsRes.json()) as { url?: string; error?: string };
    if (rsRes.ok && rsJson.url) {
      finalUrl = rsJson.url;
    } else {
      console.warn('[thumbnail-flow] coupang-resize 실패, 원본 사용:', rsJson.error);
    }
  } catch (e) {
    console.warn('[thumbnail-flow] coupang-resize 예외, 원본 사용:', e);
  }

  // 4. 텍스트 뱃지 합성 (선택)
  if (textBadge?.text) {
    try {
      const badgeRes = await fetch('/api/image/add-text-badge', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          imageUrl: finalUrl,
          text: textBadge.text,
          position: textBadge.position ?? 'top-right',
        }),
      });
      const badgeJson = (await badgeRes.json()) as { success: boolean; url?: string; error?: string };
      if (badgeRes.ok && badgeJson.success && badgeJson.url) {
        return badgeJson.url;
      }
      console.warn('[thumbnail-flow] add-text-badge 실패, 뱃지 없이 반환:', badgeJson.error);
    } catch (e) {
      console.warn('[thumbnail-flow] add-text-badge 예외, 뱃지 없이 반환:', e);
    }
  }

  return finalUrl;
}

/**
 * 기존 썸네일 URL을 프롬프트로 AI 수정한다. edit-thumbnail이 쿠팡 1200² 후처리를 내장한다.
 */
export async function editThumbnail(imageUrl: string, prompt: string): Promise<string> {
  const res = await fetch('/api/ai/edit-thumbnail', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ imageUrl, prompt }),
  });
  const json = (await res.json()) as
    | { success: true; data: { editedUrl: string } }
    | { success: false; error: string };
  if (!res.ok || !json.success) {
    throw new Error(json.success === false ? json.error : '썸네일 수정 실패');
  }
  return json.data.editedUrl;
}
