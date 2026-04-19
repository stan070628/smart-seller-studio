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
    <section style="position:relative;width:100%;min-height:480px;display:flex;align-items:flex-end;overflow:hidden;">
      <img
        src="${toDataUrl(heroImage)}"
        alt="${escapeHtml(content.headline)}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"
      />
      <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.75) 0%,rgba(0,0,0,0.2) 60%,transparent 100%);"></div>
      <div style="position:relative;z-index:1;padding:40px 24px 48px;width:100%;box-sizing:border-box;">
        <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;color:#fff;line-height:1.3;letter-spacing:-0.5px;">${escapeHtml(content.headline)}</h1>
        <p style="margin:0;font-size:16px;color:rgba(255,255,255,0.88);line-height:1.6;">${escapeHtml(content.subheadline)}</p>
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

function buildSpecsSection(content: DetailPageContent): string {
  const rows = content.specs
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

const RETURN_NOTICE_URL =
  'https://mvergrjqfjuwndveztts.supabase.co/storage/v1/object/public/smart-seller-studio/static/return-notice.jpg';

function buildReturnNoticeSection(): string {
  return `
    <section style="width:100%;padding:0;">
      <img
        src="${RETURN_NOTICE_URL}"
        alt="교환/반품 안내"
        style="width:100%;display:block;"
      />
    </section>`;
}

// ─────────────────────────────────────────
// 메인 빌더
// ─────────────────────────────────────────

function buildSections(content: DetailPageContent, images: ImageInput[]): string {
  const heroImage = images[0];
  const galleryImages = images.slice(1);

  return [
    buildHeroSection(content, heroImage),
    buildSellingPointsSection(content),
    galleryImages.length > 0 ? buildGallerySection(galleryImages) : "",
    buildFeaturesSection(content),
    buildSpecsSection(content),
    buildUsageSection(content),
    buildWarningsSection(content),
    buildCtaSection(content),
    buildReturnNoticeSection(),
  ]
    .filter(Boolean)
    .join("\n");
}

/** 쿠팡 상세 페이지 에디터에 붙여넣을 HTML snippet (body 내용만) */
export function buildDetailPageSnippet(
  content: DetailPageContent,
  images: ImageInput[]
): string {
  const sections = buildSections(content, images);
  return `<div style="max-width:800px;margin:0 auto;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;">\n${sections}\n</div>`;
}

/** 미리보기용 전체 HTML 문서 */
export function buildDetailPageHtml(
  content: DetailPageContent,
  images: ImageInput[]
): string {
  const sections = buildSections(content, images);

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
      max-width: 800px;
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
