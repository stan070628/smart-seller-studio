import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

/** AI가 생성한 이미지 슬롯 — 역할(role)에 따라 레이아웃 위치가 결정된다 */
export interface AiImageSlot {
  /** 슬롯 역할: hero(전체 폭 히어로) | lifestyle(라이프스타일) | detail(상세 디테일) | feature(피처) */
  role: 'hero' | 'lifestyle' | 'detail' | 'feature';
  /** Storage에 업로드된 공개 URL */
  url: string;
  /** 이미지 생성에 사용된 프롬프트 */
  prompt: string;
  /** 사용자가 이미지를 교체했는지 여부 */
  isReplaced: boolean;
}

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

/** HTML 특수 문자를 이스케이프한다 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 슬롯 배열에서 특정 role을 찾아 반환한다 */
function findSlot(slots: AiImageSlot[], role: AiImageSlot['role']): AiImageSlot | undefined {
  return slots.find((s) => s.role === role);
}

// ─────────────────────────────────────────
// 섹션 빌더
// ─────────────────────────────────────────

/**
 * hero 섹션: 전체 폭 이미지 위에 하단 그라디언트 오버레이로 headline + subheadline 표시
 * 슬롯이 없으면 이미지 없이 텍스트만 fallback으로 렌더링한다.
 */
function buildHeroSection(content: DetailPageContent, slot?: AiImageSlot): string {
  if (!slot) {
    return `<div style="padding:32px 28px;background:#f8f9fa;">
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;color:#111;line-height:1.3;">${escapeHtml(content.headline)}</h1>
      <p style="margin:0;font-size:16px;color:#555;line-height:1.6;">${escapeHtml(content.subheadline ?? '')}</p>
    </div>`;
  }
  return `<div style="position:relative;width:100%;line-height:0;overflow:hidden;">
    <img src="${escapeHtml(slot.url)}" style="width:100%;display:block;max-height:500px;object-fit:cover;" alt="" />
    <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.72));padding:28px 28px 24px;">
      <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#fff;line-height:1.3;text-shadow:0 1px 3px rgba(0,0,0,0.4);">${escapeHtml(content.headline)}</h1>
      <p style="margin:0;font-size:15px;color:rgba(255,255,255,0.88);line-height:1.5;">${escapeHtml(content.subheadline ?? '')}</p>
    </div>
  </div>`;
}

/**
 * lifestyle 섹션: 이미지 위 좌측 반투명 패널 오버레이로 sellingPoints[0] 표시
 * 슬롯이 없으면 텍스트만 fallback으로 렌더링한다.
 * sellingPoints 항목이 객체({icon, title, description})이면 title을 사용하고,
 * 문자열이면 그대로 사용한다.
 */
function buildLifestyleSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const raw = content.sellingPoints[0] as unknown;
  const text = raw == null ? '' : typeof raw === 'string' ? raw : ((raw as { title?: string }).title ?? '');

  if (!text && !slot) return '';

  if (!slot) {
    return `<div style="padding:28px;background:#fff;border-top:1px solid #f0f0f0;">
      <p style="margin:0;font-size:15px;color:#444;line-height:1.7;">${escapeHtml(text)}</p>
    </div>`;
  }
  return `<div style="position:relative;width:100%;line-height:0;overflow:hidden;">
    <img src="${escapeHtml(slot.url)}" style="width:100%;display:block;max-height:480px;object-fit:cover;" alt="" />
    <div style="position:absolute;top:0;left:0;bottom:0;width:42%;background:rgba(255,255,255,0.88);padding:24px 20px;display:flex;align-items:center;box-sizing:border-box;">
      <p style="margin:0;font-size:14px;color:#333;line-height:1.8;">${escapeHtml(text)}</p>
    </div>
  </div>`;
}

/**
 * detail 섹션: 이미지 위 우측 반투명 패널 오버레이로 sellingPoints[1] 표시
 * 슬롯이 없으면 텍스트만 fallback으로 렌더링한다.
 * sellingPoints 항목이 객체({icon, title, description})이면 title을 사용하고,
 * 문자열이면 그대로 사용한다.
 */
function buildDetailSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const raw = content.sellingPoints[1] as unknown;
  const text = raw == null ? '' : typeof raw === 'string' ? raw : ((raw as { title?: string }).title ?? '');

  if (!text && !slot) return '';

  if (!slot) {
    return `<div style="padding:28px;background:#fafafa;border-top:1px solid #f0f0f0;">
      <p style="margin:0;font-size:15px;color:#444;line-height:1.7;">${escapeHtml(text)}</p>
    </div>`;
  }
  return `<div style="position:relative;width:100%;line-height:0;overflow:hidden;">
    <img src="${escapeHtml(slot.url)}" style="width:100%;display:block;max-height:480px;object-fit:cover;" alt="" />
    <div style="position:absolute;top:0;right:0;bottom:0;width:42%;background:rgba(255,255,255,0.88);padding:24px 20px;display:flex;align-items:center;box-sizing:border-box;">
      <p style="margin:0;font-size:14px;color:#333;line-height:1.8;">${escapeHtml(text)}</p>
    </div>
  </div>`;
}

/**
 * feature 항목 하나에서 표시할 텍스트 문자열을 추출한다.
 * 항목이 객체({title, description})이면 title을 반환하고, 문자열이면 그대로 반환한다.
 */
function featureText(f: unknown): string {
  if (typeof f === 'string') return f;
  if (f && typeof (f as { title?: unknown }).title === 'string') {
    return (f as { title: string }).title;
  }
  return String(f ?? '');
}

/**
 * feature 섹션: 이미지 위 하단 반투명 오버레이에 feature 태그 목록 표시
 * 슬롯이 없으면 이미지 없이 features만 fallback으로 렌더링한다.
 * features 항목이 객체({title, description})이면 title을 태그 텍스트로 사용하고,
 * 문자열이면 그대로 사용한다.
 */
function buildFeatureSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const features = content.features as unknown as unknown[];
  if (features.length === 0 && !slot) return '';

  if (!slot) {
    const fallbackTags = features
      .map(
        (f) =>
          `<span style="display:inline-block;background:#f0f4ff;border:1px solid #c7d7ff;color:#2952a3;padding:5px 14px;border-radius:20px;font-size:13px;">${escapeHtml(featureText(f))}</span>`,
      )
      .join('');
    return `<div style="padding:28px;background:#fff;border-top:1px solid #f0f0f0;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;">${fallbackTags}</div>
    </div>`;
  }

  const tags = features
    .map(
      (f) =>
        `<span style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);color:#fff;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:500;">${escapeHtml(featureText(f))}</span>`,
    )
    .join(' ');

  return `<div style="position:relative;width:100%;line-height:0;overflow:hidden;">
    <img src="${escapeHtml(slot.url)}" style="width:100%;display:block;max-height:480px;object-fit:cover;" alt="" />
    <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.62);padding:16px 20px;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;">${tags}</div>
    </div>
  </div>`;
}

/** specs 테이블 섹션 */
function buildSpecsSection(specs: Array<{ label: string; value: string }>): string {
  if (specs.length === 0) return '';

  const rows = specs
    .map(
      (s) => `
        <tr>
          <td style="padding:14px 0;font-size:15px;font-weight:500;color:#888;width:40%;border-bottom:1px solid #ebebeb;">${escapeHtml(s.label)}</td>
          <td style="padding:14px 0;font-size:15px;color:#111;border-bottom:1px solid #ebebeb;">${escapeHtml(s.value)}</td>
        </tr>`
    )
    .join('');

  return `
    <section style="padding:0 28px 48px;background:#fff;">
      <div style="font-size:11px;font-weight:600;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Specs</div>
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:300;color:#111;letter-spacing:-0.3px;">스펙</h2>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #ebebeb;">
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

/** usageSteps 섹션 */
function buildUsageSection(content: DetailPageContent): string {
  if (content.usageSteps.length === 0) return '';

  const steps = content.usageSteps
    .map(
      (step, idx) => `
        <li style="display:flex;align-items:flex-start;gap:20px;padding:20px 0;border-bottom:1px solid #ebebeb;">
          <div style="flex-shrink:0;width:28px;height:28px;border:1px solid #ddd;border-radius:50%;font-size:12px;font-weight:500;color:#888;display:flex;align-items:center;justify-content:center;">${idx + 1}</div>
          <div style="font-size:16px;color:#444;line-height:1.7;padding-top:5px;">${escapeHtml(step)}</div>
        </li>`
    )
    .join('');

  return `
    <section style="padding:0 28px 48px;background:#fafafa;">
      <div style="padding-top:48px;">
        <div style="font-size:11px;font-weight:600;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">How to use</div>
        <h2 style="margin:0 0 20px;font-size:22px;font-weight:300;color:#111;letter-spacing:-0.3px;">사용법</h2>
        <ul style="list-style:none;margin:0;padding:0;border-top:1px solid #ebebeb;">
          ${steps}
        </ul>
      </div>
    </section>`;
}

/** warnings 섹션 */
function buildWarningsSection(content: DetailPageContent): string {
  if (content.warnings.length === 0) return '';

  const items = content.warnings
    .map(
      (w) => `
        <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
          <span style="flex-shrink:0;font-size:16px;color:#bbb;">—</span>
          <span style="font-size:15px;color:#888;line-height:1.7;">${escapeHtml(w)}</span>
        </li>`
    )
    .join('');

  return `
    <section style="padding:0 28px 48px;background:#fafafa;">
      <div style="border:1px solid #e8e8e8;border-radius:4px;padding:24px 20px;">
        <h3 style="margin:0 0 14px;font-size:12px;font-weight:600;color:#bbb;letter-spacing:1.5px;text-transform:uppercase;">주의사항</h3>
        <ul style="list-style:none;margin:0;padding:0;">
          ${items}
        </ul>
      </div>
    </section>`;
}

// ─────────────────────────────────────────
// 미디어 쿼리 (2컬럼 → 1컬럼, 600px 이하)
// ─────────────────────────────────────────

const RESPONSIVE_STYLE = `<style>
  @media (max-width: 600px) {
    #ai-dp-root .ai-two-col { flex-direction: column !important; }
    #ai-dp-root .ai-col-img,
    #ai-dp-root .ai-col-text { width: 100%; }
    #ai-dp-root .ai-col-img img { min-height: 200px !important; }
  }
</style>`;

// ─────────────────────────────────────────
// 메인 빌더
// ─────────────────────────────────────────

/**
 * 역할 기반 섹션 배열을 조합한다.
 *
 * Layout uses 4 image roles: hero, lifestyle, detail, feature.
 * sellingPoints[0] → lifestyle section, sellingPoints[1] → detail section.
 * sellingPoints[2+] are not rendered in image sections (no slot for them).
 */
function buildAllSections(
  content: DetailPageContent,
  slots: AiImageSlot[],
  specOverride?: Array<{ label: string; value: string }>,
): string {
  const heroSlot = findSlot(slots, 'hero');
  const lifestyleSlot = findSlot(slots, 'lifestyle');
  const detailSlot = findSlot(slots, 'detail');
  const featureSlot = findSlot(slots, 'feature');

  const finalSpecs =
    specOverride && specOverride.length > 0 ? specOverride : content.specs;

  return [
    buildHeroSection(content, heroSlot),
    buildLifestyleSection(content, lifestyleSlot),
    buildDetailSection(content, detailSlot),
    buildFeatureSection(content, featureSlot),
    buildSpecsSection(finalSpecs),
    buildUsageSection(content),
    buildWarningsSection(content),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 상세 페이지 에디터에 붙여넣을 HTML snippet (body 내용만)
 * @param content AI 생성 콘텐츠
 * @param slots 역할 기반 이미지 슬롯 배열
 * @param specOverride content.specs 대신 사용할 스펙 배열 (없으면 content.specs 사용)
 * @param maxWidth 최대 너비(px) — 쿠팡: 780, 네이버: 860 (기본값 780)
 */
export function buildAiDetailPageSnippet(
  content: DetailPageContent,
  slots: AiImageSlot[],
  specOverride?: Array<{ label: string; value: string }>,
  maxWidth = 780,
): string {
  const sections = buildAllSections(content, slots, specOverride);
  return `${RESPONSIVE_STYLE}<div id="ai-dp-root" style="max-width:${maxWidth}px;margin:0 auto;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;">
${sections}
</div>`;
}

/**
 * 미리보기용 전체 HTML 문서
 * @param content AI 생성 콘텐츠
 * @param slots 역할 기반 이미지 슬롯 배열
 * @param specOverride content.specs 대신 사용할 스펙 배열 (없으면 content.specs 사용)
 * @param maxWidth 최대 너비(px) — 쿠팡: 780, 네이버: 860 (기본값 780)
 */
export function buildAiDetailPageHtml(
  content: DetailPageContent,
  slots: AiImageSlot[],
  specOverride?: Array<{ label: string; value: string }>,
  maxWidth = 780,
): string {
  const sections = buildAllSections(content, slots, specOverride);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(content.headline)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: #f0f0f0;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .page-wrapper {
      max-width: ${maxWidth}px;
      margin: 0 auto;
      background: #fff;
      overflow: hidden;
    }
    /* 2컬럼 섹션은 600px 이하에서 1컬럼으로 전환 */
    @media (max-width: 600px) {
      #ai-dp-root .ai-two-col { flex-direction: column !important; }
      #ai-dp-root .ai-col-img,
      #ai-dp-root .ai-col-text { width: 100%; }
      #ai-dp-root .ai-col-img img { min-height: 200px !important; }
    }
  </style>
</head>
<body>
  <div class="page-wrapper">
    ${sections}
  </div>
</body>
</html>`;
}
