// src/lib/ai/reference-images.ts
/**
 * 멀티참조 이미지 로더
 * 다양한 입력 소스(직접 base64, URL, 단일 하위호환 필드)를 받아
 * 최대 3장의 정규화된 참조 이미지(장변 1024px JPEG)로 변환한다.
 */
import sharp from 'sharp';

export interface ReferenceImage {
  /** data URL prefix 제외 base64 */
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
}

export interface LoadReferenceImagesInput {
  /** 직접 전달된 base64 참조 (data URL prefix 제외) */
  referenceImages?: Array<{ base64: string; mimeType?: string }>;
  /** 서버가 fetch할 이미지 URL 목록 */
  productImageUrls?: string[];
  /** @deprecated 하위호환: 단일 base64 */
  productImageBase64?: string;
  /** @deprecated 무시됨 — 출력은 항상 image/jpeg로 정규화된다 */
  productImageMimeType?: string;
  /** @deprecated 하위호환: 단일 URL */
  productImageUrl?: string;
}

const MAX_REFERENCES = 3;
const MAX_EDGE = 1024;

export interface LoadReferenceImagesOptions {
  /**
   * true: 무손실 PNG로 정규화(장변 1024 유지) — 배경제거(rembg) 입력 등
   * 화질이 중요한 용도. q80 JPEG 재압축은 페더/미세 가장자리를 뭉갠다.
   * 기본(false): 기존과 동일하게 JPEG q80 (LLM 컨텍스트용, 용량 우선).
   */
  lossless?: boolean;
}

/**
 * 서버가 fetch해도 되는 이미지 호스트 allowlist를 구성한다.
 * 기본은 Supabase Storage 호스트(업로드된 사용자 이미지)이며,
 * REFERENCE_IMAGE_ALLOWED_HOSTS(쉼표구분)로 확장할 수 있다.
 * SSRF 방어: allowlist에 없는 호스트(사내망·메타데이터 IP 등)는 fetch하지 않는다.
 */
function getAllowedImageHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const) {
    const v = process.env[key];
    if (!v) continue;
    try {
      hosts.add(new URL(v).hostname.toLowerCase());
    } catch {
      /* 잘못된 URL은 무시 */
    }
  }
  const extra = process.env.REFERENCE_IMAGE_ALLOWED_HOSTS;
  if (extra) {
    for (const h of extra.split(',')) {
      const t = h.trim().toLowerCase();
      if (t) hosts.add(t);
    }
  }
  return hosts;
}

/** allowlist에 속한 http(s) URL만 허용 (대소문자 무시) */
function isAllowedImageUrl(raw: string, allowed: Set<string>): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  return allowed.has(u.hostname.toLowerCase());
}

/** 단일 Buffer를 장변 1024px로 정규화하여 base64 반환 (기본 JPEG q80, lossless 시 PNG) */
async function normalizeBuffer(buf: Buffer, lossless: boolean): Promise<string> {
  const resized = sharp(buf).resize(MAX_EDGE, MAX_EDGE, {
    fit: 'inside',
    withoutEnlargement: true,
  });
  const out = lossless
    ? await resized.png().toBuffer()
    : await resized.jpeg({ quality: 80 }).toBuffer();
  return out.toString('base64');
}

export async function loadReferenceImages(
  input: LoadReferenceImagesInput,
  options?: LoadReferenceImagesOptions,
): Promise<ReferenceImage[]> {
  const lossless = options?.lossless ?? false;
  const buffers: Buffer[] = [];

  // 1. base64 직접 입력 (referenceImages → 단일 productImageBase64)
  const directBase64: string[] = [];
  if (input.referenceImages?.length) {
    for (const r of input.referenceImages) directBase64.push(r.base64);
  }
  if (input.productImageBase64) directBase64.push(input.productImageBase64);
  for (const b64 of directBase64) {
    buffers.push(Buffer.from(b64, 'base64'));
  }

  // 2. URL 입력 (병렬 fetch) — base64 입력만으로 상한을 이미 채웠으면 생략
  if (buffers.length < MAX_REFERENCES) {
    const urls: string[] = [];
    if (input.productImageUrls?.length) urls.push(...input.productImageUrls);
    if (input.productImageUrl) urls.push(input.productImageUrl);
    const remaining = MAX_REFERENCES - buffers.length;
    // SSRF 방어: allowlist에 속한 호스트만 fetch한다.
    const allowedHosts = getAllowedImageHosts();
    const urlsToFetch = urls
      .filter((u) => {
        const ok = isAllowedImageUrl(u, allowedHosts);
        if (!ok) console.warn('[reference-images] 허용되지 않은 이미지 호스트, fetch 생략:', u);
        return ok;
      })
      .slice(0, remaining);
    if (urlsToFetch.length) {
      const fetched = await Promise.all(
        urlsToFetch.map(async (u) => {
          try {
            const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
            if (!res.ok) return null;
            return Buffer.from(await res.arrayBuffer());
          } catch {
            return null;
          }
        }),
      );
      for (const f of fetched) if (f) buffers.push(f);
    }
  }

  // 3. 상한 적용 + 정규화
  const limited = buffers.slice(0, MAX_REFERENCES);
  const mimeType = lossless ? ('image/png' as const) : ('image/jpeg' as const);
  const normalized = await Promise.all(
    limited.map(async (b) => {
      try {
        return { base64: await normalizeBuffer(b, lossless), mimeType };
      } catch {
        return null;
      }
    }),
  );
  return normalized.filter((x): x is ReferenceImage => x !== null);
}
