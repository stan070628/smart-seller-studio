import type { DetailPageContent } from "@/lib/ai/prompts/detail-page";

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

interface ImageInput {
  imageBase64: string;
  mimeType: string;
  publicUrl?: string;
}

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

function toDataUrl(img: ImageInput): string {
  if (img.publicUrl) return img.publicUrl;
  return `data:${img.mimeType};base64,${img.imageBase64}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─────────────────────────────────────────
// 섹션 빌더
// ─────────────────────────────────────────

function buildHeroSection(content: DetailPageContent, heroImage: ImageInput): string {
  return `
    <section style="width:100%;">
      <img
        src="${toDataUrl(heroImage)}"
        alt="${escapeHtml(content.headline)}"
        style="width:100%;height:auto;display:block;"
      />
      <div style="padding:28px 24px 32px;background:#fff;">
        <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1a1a1a;line-height:1.35;letter-spacing:-0.5px;">${escapeHtml(content.headline)}</h1>
        <p style="margin:0;font-size:15px;color:#555;line-height:1.7;">${escapeHtml(content.subheadline)}</p>
      </div>
    </section>`;
}

function buildSellingPointsSection(content: DetailPageContent): string {
  const cards = content.sellingPoints
    .map(
      (sp) => `
        <div style="flex:1;min-width:0;background:#fff;border-radius:16px;padding:24px 16px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
          <div style="font-size:32px;margin-bottom:12px;">${escapeHtml(sp.icon)}</div>
          <div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:8px;line-height:1.4;">${escapeHtml(sp.title)}</div>
          <div style="font-size:13px;color:#555;line-height:1.6;">${escapeHtml(sp.description)}</div>
        </div>`
    )
    .join("");

  return `
    <section style="padding:48px 20px 40px;background:#f7f8fa;">
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${cards}
      </div>
    </section>`;
}

function buildGallerySection(images: ImageInput[]): string {
  if (images.length === 0) return "";

  const items = images
    .map(
      (img, idx) => `
        <div style="width:100%;">
          <img
            src="${toDataUrl(img)}"
            alt="상품 이미지 ${idx + 2}"
            style="width:100%;display:block;border-radius:12px;"
          />
        </div>`
    )
    .join("");

  return `
    <section style="padding:40px 20px;display:flex;flex-direction:column;gap:16px;">
      ${items}
    </section>`;
}

function buildFeaturesSection(content: DetailPageContent): string {
  const items = content.features
    .map(
      (f) => `
        <li style="padding:20px 0;border-bottom:1px solid #f0f0f0;">
          <div style="font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:6px;">${escapeHtml(f.title)}</div>
          <div style="font-size:14px;color:#555;line-height:1.7;">${escapeHtml(f.description)}</div>
        </li>`
    )
    .join("");

  return `
    <section style="padding:48px 20px;">
      <h2 style="margin:0 0 24px;font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;">상품 특징</h2>
      <ul style="list-style:none;margin:0;padding:0;border-top:2px solid #1a1a1a;">
        ${items}
      </ul>
    </section>`;
}

function buildSpecsSection(specs: Array<{ label: string; value: string }>): string {
  if (specs.length === 0) return '';

  const rows = specs
    .map(
      (s, idx) => `
        <tr style="background:${idx % 2 === 0 ? "#fff" : "#f7f8fa"};">
          <td style="padding:14px 16px;font-size:14px;font-weight:600;color:#444;width:40%;border-bottom:1px solid #eee;">${escapeHtml(s.label)}</td>
          <td style="padding:14px 16px;font-size:14px;color:#1a1a1a;border-bottom:1px solid #eee;">${escapeHtml(s.value)}</td>
        </tr>`
    )
    .join("");

  return `
    <section style="padding:0 20px 48px;">
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;">스펙</h2>
      <table style="width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden;border:1px solid #eee;">
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>`;
}

function buildUsageSection(content: DetailPageContent): string {
  const steps = content.usageSteps
    .map(
      (step, idx) => `
        <li style="display:flex;align-items:flex-start;gap:16px;padding:16px 0;border-bottom:1px solid #f0f0f0;">
          <div style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:#1a1a1a;color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;">${idx + 1}</div>
          <div style="font-size:15px;color:#333;line-height:1.6;padding-top:6px;">${escapeHtml(step)}</div>
        </li>`
    )
    .join("");

  return `
    <section style="padding:0 20px 48px;background:#fff;">
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;">사용법</h2>
      <ul style="list-style:none;margin:0;padding:0;border-top:2px solid #1a1a1a;">
        ${steps}
      </ul>
    </section>`;
}

function buildWarningsSection(content: DetailPageContent): string {
  const items = content.warnings
    .map(
      (w) => `
        <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
          <span style="flex-shrink:0;font-size:16px;">&#9888;</span>
          <span style="font-size:14px;color:#7a5500;line-height:1.6;">${escapeHtml(w)}</span>
        </li>`
    )
    .join("");

  return `
    <section style="padding:0 20px 48px;">
      <div style="background:#fffbeb;border:1.5px solid #f5d060;border-radius:16px;padding:24px 20px;">
        <h3 style="margin:0 0 16px;font-size:16px;font-weight:700;color:#7a5500;">주의사항</h3>
        <ul style="list-style:none;margin:0;padding:0;">
          ${items}
        </ul>
      </div>
    </section>`;
}

function buildCtaSection(content: DetailPageContent): string {
  return `
    <section style="padding:0 20px 64px;">
      <div style="background:#1a1a1a;border-radius:20px;padding:40px 24px;text-align:center;">
        <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#fff;line-height:1.5;">${escapeHtml(content.headline)}</p>
        <button
          style="display:inline-block;background:#fff;color:#1a1a1a;font-size:17px;font-weight:800;padding:16px 48px;border-radius:50px;border:none;cursor:pointer;letter-spacing:-0.3px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"
        >${escapeHtml(content.ctaText)}</button>
      </div>
    </section>`;
}

// ─────────────────────────────────────────
// 스튜디오 전용 섹션 빌더 (프리미엄·미니멀 비주얼)
// ─────────────────────────────────────────

function buildStudioHeroSection(content: DetailPageContent, heroImage: ImageInput): string {
  return `
    <section style="width:100%;background:#fff;">
      <img
        src="${toDataUrl(heroImage)}"
        alt="${escapeHtml(content.headline)}"
        style="width:100%;height:auto;display:block;"
      />
      <div style="padding:40px 28px 32px;text-align:center;">
        <h1 style="margin:0 0 14px;font-size:28px;font-weight:300;color:#111;line-height:1.3;letter-spacing:-0.5px;">${escapeHtml(content.headline)}</h1>
        <p style="margin:0;font-size:15px;font-weight:400;color:#777;line-height:1.8;letter-spacing:0.2px;">${escapeHtml(content.subheadline)}</p>
      </div>
    </section>`;
}

function buildStudioSellingPointsSection(content: DetailPageContent): string {
  const cards = content.sellingPoints
    .map(
      (sp, idx) => `
        <div style="flex:1;min-width:0;padding:28px 16px;text-align:center;${idx < content.sellingPoints.length - 1 ? 'border-right:1px solid #e8e8e8;' : ''}">
          <div style="font-size:28px;margin-bottom:10px;">${escapeHtml(sp.icon)}</div>
          <div style="font-size:13px;font-weight:600;color:#111;margin-bottom:6px;line-height:1.4;letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(sp.title)}</div>
          <div style="font-size:12px;color:#888;line-height:1.7;">${escapeHtml(sp.description)}</div>
        </div>`
    )
    .join("");

  return `
    <section style="border-top:1px solid #e8e8e8;border-bottom:1px solid #e8e8e8;background:#fff;">
      <div style="display:flex;">
        ${cards}
      </div>
    </section>`;
}

function buildStudioGallerySection(images: ImageInput[]): string {
  if (images.length === 0) return "";
  const items = images
    .map(
      (img, idx) => `
        <div style="width:100%;">
          <img
            src="${toDataUrl(img)}"
            alt="상품 이미지 ${idx + 2}"
            style="width:100%;display:block;"
          />
        </div>`
    )
    .join("");
  return `
    <section style="background:#fff;display:flex;flex-direction:column;gap:2px;">
      ${items}
    </section>`;
}

function buildStudioFeaturesSection(content: DetailPageContent): string {
  const items = content.features
    .map(
      (f) => `
        <li style="padding:24px 0;border-bottom:1px solid #ebebeb;">
          <div style="font-size:14px;font-weight:600;color:#111;margin-bottom:6px;letter-spacing:0.3px;">${escapeHtml(f.title)}</div>
          <div style="font-size:13px;color:#888;line-height:1.8;">${escapeHtml(f.description)}</div>
        </li>`
    )
    .join("");

  return `
    <section style="padding:48px 28px;background:#fff;">
      <h2 style="margin:0 0 4px;font-size:11px;font-weight:600;color:#aaa;letter-spacing:2px;text-transform:uppercase;">Features</h2>
      <h3 style="margin:0 0 28px;font-size:22px;font-weight:300;color:#111;letter-spacing:-0.3px;">상품 특징</h3>
      <ul style="list-style:none;margin:0;padding:0;border-top:1px solid #ebebeb;">
        ${items}
      </ul>
    </section>`;
}

function buildStudioSpecsSection(specs: Array<{ label: string; value: string }>): string {
  if (specs.length === 0) return '';
  const rows = specs
    .map(
      (s) => `
        <tr>
          <td style="padding:14px 0;font-size:13px;font-weight:500;color:#888;width:40%;border-bottom:1px solid #ebebeb;">${escapeHtml(s.label)}</td>
          <td style="padding:14px 0;font-size:13px;color:#111;border-bottom:1px solid #ebebeb;">${escapeHtml(s.value)}</td>
        </tr>`
    )
    .join("");
  return `
    <section style="padding:0 28px 48px;background:#fff;">
      <h2 style="margin:0 0 4px;font-size:11px;font-weight:600;color:#aaa;letter-spacing:2px;text-transform:uppercase;">Specs</h2>
      <h3 style="margin:0 0 20px;font-size:22px;font-weight:300;color:#111;letter-spacing:-0.3px;">스펙</h3>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #ebebeb;">
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function buildStudioUsageSection(content: DetailPageContent): string {
  const steps = content.usageSteps
    .map(
      (step, idx) => `
        <li style="display:flex;align-items:flex-start;gap:20px;padding:20px 0;border-bottom:1px solid #ebebeb;">
          <div style="flex-shrink:0;width:28px;height:28px;border:1px solid #ddd;border-radius:50%;font-size:12px;font-weight:500;color:#888;display:flex;align-items:center;justify-content:center;">${idx + 1}</div>
          <div style="font-size:14px;color:#444;line-height:1.7;padding-top:5px;">${escapeHtml(step)}</div>
        </li>`
    )
    .join("");
  return `
    <section style="padding:0 28px 48px;background:#fafafa;">
      <div style="padding-top:48px;">
        <h2 style="margin:0 0 4px;font-size:11px;font-weight:600;color:#aaa;letter-spacing:2px;text-transform:uppercase;">How to use</h2>
        <h3 style="margin:0 0 20px;font-size:22px;font-weight:300;color:#111;letter-spacing:-0.3px;">사용법</h3>
        <ul style="list-style:none;margin:0;padding:0;border-top:1px solid #ebebeb;">
          ${steps}
        </ul>
      </div>
    </section>`;
}

function buildStudioWarningsSection(content: DetailPageContent): string {
  const items = content.warnings
    .map(
      (w) => `
        <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
          <span style="flex-shrink:0;font-size:14px;color:#bbb;">—</span>
          <span style="font-size:13px;color:#888;line-height:1.7;">${escapeHtml(w)}</span>
        </li>`
    )
    .join("");
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

function buildStudioCtaSection(content: DetailPageContent): string {
  return `
    <section style="padding:0 28px 64px;background:#fafafa;">
      <div style="border:1px solid #111;padding:40px 24px;text-align:center;">
        <p style="margin:0 0 20px;font-size:16px;font-weight:300;color:#111;line-height:1.6;letter-spacing:0.2px;">${escapeHtml(content.headline)}</p>
        <span style="display:inline-block;background:#111;color:#fff;font-size:14px;font-weight:500;padding:14px 44px;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(content.ctaText)}</span>
      </div>
    </section>`;
}

// ─────────────────────────────────────────
// 메인 빌더
// ─────────────────────────────────────────

function buildSections(
  content: DetailPageContent,
  images: ImageInput[],
  specOverride?: Array<{ label: string; value: string }>,
  studioMode = false
): string {
  const heroImage = images[0];
  const galleryImages = images.slice(1);

  const finalSpecs =
    specOverride && specOverride.length > 0 ? specOverride : content.specs;

  if (studioMode) {
    return [
      buildStudioHeroSection(content, heroImage),
      buildStudioSellingPointsSection(content),
      galleryImages.length > 0 ? buildStudioGallerySection(galleryImages) : "",
      buildStudioFeaturesSection(content),
      buildStudioSpecsSection(finalSpecs),
      buildStudioUsageSection(content),
      buildStudioWarningsSection(content),
      buildStudioCtaSection(content),
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    buildHeroSection(content, heroImage),
    buildSellingPointsSection(content),
    galleryImages.length > 0 ? buildGallerySection(galleryImages) : "",
    buildFeaturesSection(content),
    buildSpecsSection(finalSpecs),
    buildUsageSection(content),
    buildWarningsSection(content),
    buildCtaSection(content),
  ]
    .filter(Boolean)
    .join("\n");
}

/** 상세 페이지 에디터에 붙여넣을 HTML snippet (body 내용만)
 *  @param maxWidth 최대 너비(px) — 쿠팡: 780, 네이버: 860 (기본값 780)
 *  @param studioMode 스튜디오 전용 미니멀 템플릿 사용 여부 */
export function buildDetailPageSnippet(
  content: DetailPageContent,
  images: ImageInput[],
  specOverride?: Array<{ label: string; value: string }>,
  maxWidth = 780,
  studioMode = false
): string {
  const sections = buildSections(content, images, specOverride, studioMode);
  return `<div style="max-width:${maxWidth}px;margin:0 auto;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;">\n${sections}\n</div>`;
}

/** 미리보기용 전체 HTML 문서
 *  @param maxWidth 최대 너비(px) — 쿠팡: 780, 네이버: 860 (기본값 780)
 *  @param studioMode 스튜디오 전용 미니멀 템플릿 사용 여부 */
export function buildDetailPageHtml(
  content: DetailPageContent,
  images: ImageInput[],
  specOverride?: Array<{ label: string; value: string }>,
  maxWidth = 780,
  studioMode = false
): string {
  const sections = buildSections(content, images, specOverride, studioMode);

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
  </style>
</head>
<body>
  <div class="page-wrapper">
    ${sections}
  </div>
</body>
</html>`;
}
