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
 * hero 섹션: 전체 폭 이미지 + headline + subheadline
 * 슬롯이 없으면 이미지 없이 텍스트만 렌더링한다.
 */
function buildHeroSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const imgTag = slot
    ? `<img
        src="${escapeHtml(slot.url)}"
        alt="${escapeHtml(content.headline)}"
        style="width:100%;height:auto;display:block;"
      />`
    : '';

  return `
    <section style="width:100%;background:#fff;">
      ${imgTag}
      <div style="padding:40px 28px 32px;text-align:center;">
        <h1 style="margin:0 0 14px;font-size:30px;font-weight:300;color:#111;line-height:1.3;letter-spacing:-0.5px;">${escapeHtml(content.headline)}</h1>
        <p style="margin:0;font-size:17px;font-weight:400;color:#777;line-height:1.8;letter-spacing:0.2px;">${escapeHtml(content.subheadline)}</p>
      </div>
    </section>`;
}

/**
 * lifestyle 섹션: 2컬럼 (텍스트 좌 + 이미지 우)
 * sellingPoints[0] 텍스트 사용. 600px 이하에서는 1컬럼.
 */
function buildLifestyleSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const sp = content.sellingPoints[0];
  if (!sp && !slot) return '';

  const textBlock = sp
    ? `<div class="ai-col-text" style="flex:1;min-width:0;padding:32px 24px;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:11px;font-weight:600;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">Highlight</div>
        <div style="font-size:26px;margin-bottom:16px;">${escapeHtml(sp.icon)}</div>
        <div style="font-size:20px;font-weight:600;color:#111;margin-bottom:12px;line-height:1.4;">${escapeHtml(sp.title)}</div>
        <div style="font-size:15px;color:#666;line-height:1.8;">${escapeHtml(sp.description)}</div>
      </div>`
    : '<div class="ai-col-text" style="flex:1;min-width:0;"></div>';

  const imgBlock = slot
    ? `<div class="ai-col-img" style="flex:1;min-width:0;">
        <img
          src="${escapeHtml(slot.url)}"
          alt="${sp ? escapeHtml(sp.title) : 'lifestyle'}"
          style="width:100%;height:100%;object-fit:cover;display:block;min-height:280px;"
        />
      </div>`
    : '';

  return `
    <section style="background:#fafafa;">
      <div class="ai-two-col" style="display:flex;">
        ${textBlock}
        ${imgBlock}
      </div>
    </section>`;
}

/**
 * detail 섹션: 2컬럼 (이미지 좌 + 텍스트 우)
 * sellingPoints[1] 텍스트 사용. 600px 이하에서는 1컬럼.
 */
function buildDetailSection(content: DetailPageContent, slot?: AiImageSlot): string {
  const sp = content.sellingPoints[1];
  if (!sp && !slot) return '';

  const imgBlock = slot
    ? `<div class="ai-col-img" style="flex:1;min-width:0;">
        <img
          src="${escapeHtml(slot.url)}"
          alt="${sp ? escapeHtml(sp.title) : 'detail'}"
          style="width:100%;height:100%;object-fit:cover;display:block;min-height:280px;"
        />
      </div>`
    : '';

  const textBlock = sp
    ? `<div class="ai-col-text" style="flex:1;min-width:0;padding:32px 24px;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:11px;font-weight:600;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">Detail</div>
        <div style="font-size:26px;margin-bottom:16px;">${escapeHtml(sp.icon)}</div>
        <div style="font-size:20px;font-weight:600;color:#111;margin-bottom:12px;line-height:1.4;">${escapeHtml(sp.title)}</div>
        <div style="font-size:15px;color:#666;line-height:1.8;">${escapeHtml(sp.description)}</div>
      </div>`
    : '<div class="ai-col-text" style="flex:1;min-width:0;"></div>';

  return `
    <section style="background:#fff;">
      <div class="ai-two-col" style="display:flex;">
        ${imgBlock}
        ${textBlock}
      </div>
    </section>`;
}

/**
 * feature 섹션: 전체 폭 이미지 + features 목록
 * 슬롯이 없으면 이미지 없이 features만 렌더링한다.
 */
function buildFeatureSection(content: DetailPageContent, slot?: AiImageSlot): string {
  if (content.features.length === 0 && !slot) return '';

  const imgTag = slot
    ? `<img
        src="${escapeHtml(slot.url)}"
        alt="상품 특징"
        style="width:100%;height:auto;display:block;"
      />`
    : '';

  const featureItems = content.features
    .map(
      (f) => `
        <li style="padding:20px 0;border-bottom:1px solid #ebebeb;">
          <div style="font-size:16px;font-weight:600;color:#111;margin-bottom:6px;letter-spacing:0.3px;">${escapeHtml(f.title)}</div>
          <div style="font-size:15px;color:#888;line-height:1.8;">${escapeHtml(f.description)}</div>
        </li>`
    )
    .join('');

  const featureList = content.features.length > 0
    ? `<div style="padding:40px 28px;">
        <div style="font-size:11px;font-weight:600;color:#aaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Features</div>
        <h2 style="margin:0 0 24px;font-size:22px;font-weight:300;color:#111;letter-spacing:-0.3px;">상품 특징</h2>
        <ul style="list-style:none;margin:0;padding:0;border-top:1px solid #ebebeb;">
          ${featureItems}
        </ul>
      </div>`
    : '';

  return `
    <section style="background:#fff;">
      ${imgTag}
      ${featureList}
    </section>`;
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
    .ai-two-col { flex-direction: column !important; }
    .ai-col-img img { min-height: 200px !important; }
  }
</style>`;

// ─────────────────────────────────────────
// 메인 빌더
// ─────────────────────────────────────────

/** 역할 기반 섹션 배열을 조합한다 */
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
  return `${RESPONSIVE_STYLE}<div style="max-width:${maxWidth}px;margin:0 auto;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;">
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
      .ai-two-col { flex-direction: column !important; }
      .ai-col-img img { min-height: 200px !important; }
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
