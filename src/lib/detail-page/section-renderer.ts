// src/lib/detail-page/section-renderer.ts
// 각 SectionType을 받아서 인라인 스타일 HTML 문자열을 반환하는 순수 렌더링 함수
// 쿠팡 상세페이지 제약: 인라인 스타일만 허용

import type {
  DetailSection,
  DetailPageTheme,
  ImageLayout,
  HeroContent,
  SellingPointsContent,
  FeaturesContent,
  StatsContent,
  SpecTableContent,
  UsageStepsContent,
  WarningContent,
  CtaContent,
  BrandHeaderContent,
  PointContent,
  ImageGridContent,
  PointSectionContent,
  StatCalloutContent,
  BarChartContent,
  WhyIconsContent,
  CertificationsContent,
  InfographicStepsContent,
  ClaudeLayoutContent,
  LayoutBlock,
  AttachedImage,
  YoutubeContent,
} from '@/types/detail-page';
import type { PaletteColors } from '@/lib/detail-page/palette-config';
import { PALETTES } from '@/lib/detail-page/palette-config';
import { editableMarkupText } from '@/lib/detail-page/inline-markup';
import { YOUTUBE_ID_RE } from '@/lib/detail-page/youtube';

// ─────────────────────────────────────────
// 보안 헬퍼
// ─────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return '';
}

function editableText(path: string, value: string): string {
  return `<span data-edit-path="${escapeHtml(path)}">${escapeHtml(value)}</span>`;
}

const SECTION_LABELS: Record<DetailSection['type'], string> = {
  hero: '히어로',
  selling_points: '셀링 포인트',
  features: '특징',
  stats: '통계',
  spec_table: '사양 테이블',
  usage_steps: '사용법',
  warning: '주의사항',
  cta: '구매 유도',
  brand_header: '브랜드 헤더',
  point: '포인트',
  image_grid: '이미지 그리드',
  point_section: 'POINT 섹션',
  stat_callout: '수치 강조',
  bar_chart: '바 차트',
  why_icons: 'WHY 아이콘',
  certifications: '인증 배지',
  infographic_steps: '사용법 인포그래픽',
  claude_layout: 'AI 레이아웃',
  youtube: '유튜브 영상',
};

function sectionAttrs(section: DetailSection): string {
  return `data-section-id="${escapeHtml(section.id)}" data-section-type="${escapeHtml(section.type)}" data-section-label="${escapeHtml(SECTION_LABELS[section.type])}"`;
}

function headingFontStyle(fontStyle: string): string {
  return fontStyle !== 'sans' ? ";font-family:'Batang','HY신명조',Georgia,serif" : '';
}

// eyebrow 레이블 — section.eyebrow가 있을 때만 렌더링
function renderEyebrow(section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  if (!section.eyebrow) return '';
  const fontFamily =
    theme.fontStyle !== 'sans'
      ? "'Batang','HY신명조',Georgia,serif"
      : 'system-ui,-apple-system,sans-serif';
  return `<div style="font-size:10px;letter-spacing:3px;color:${colors.labelColor};text-transform:uppercase;font-weight:600;margin-bottom:8px;font-family:${fontFamily};">${escapeHtml(section.eyebrow)}</div>`;
}

// ─────────────────────────────────────────
// 첨부 이미지 렌더러
// ─────────────────────────────────────────

const IMAGE_SINGLE_STYLE: Record<ImageLayout, string> = {
  fullbleed: 'width:100%;display:block;max-width:100%;height:auto;margin-bottom:24px;',
  composed:  'width:88%;max-width:560px;display:block;margin:0 auto 24px;height:auto;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.12);',
  split:     'width:100%;display:block;max-width:100%;height:auto;margin-bottom:24px;border-radius:6px;',
};

function renderAttachedImage(section: DetailSection, imageLayout: ImageLayout): string {
  if (section.attachedImages.length === 0) return '';

  if (section.attachedImages.length >= 2) {
    const img1 = section.attachedImages[0];
    const img2 = section.attachedImages[1];
    const safeUrl1 = sanitizeUrl(img1.url);
    const safeUrl2 = sanitizeUrl(img2.url);
    if (!safeUrl1 && !safeUrl2) return '';
    const isComposed = imageLayout === 'composed';
    const itemStyle = isComposed
      ? 'flex:1;min-width:0;width:50%;display:block;height:auto;border-radius:8px;'
      : 'flex:1;min-width:0;width:50%;display:block;height:auto;';
    const imgTag = (url: string) =>
      url
        ? `<img src="${escapeHtml(url)}" alt="" style="${itemStyle}" />`
        : `<div style="flex:1;min-width:0;width:50%;"></div>`;
    const gap = isComposed ? '16px' : '8px';
    return `<div style="display:flex;gap:${gap};width:100%;box-sizing:border-box;margin-bottom:24px;">${imgTag(safeUrl1)}${imgTag(safeUrl2)}</div>`;
  }

  const img = section.attachedImages[0];
  const safeUrl = sanitizeUrl(img.url);
  if (!safeUrl) return '';
  return `<img src="${escapeHtml(safeUrl)}" alt="" style="${IMAGE_SINGLE_STYLE[imageLayout]}" />`;
}

// ─────────────────────────────────────────
// 섹션 렌더러
// ─────────────────────────────────────────

function renderHero(content: HeroContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  if (theme.layoutMode === 'mobile') return renderMobileHero(content, section, colors, theme);

  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};color:${colors.text};padding:60px 40px;text-align:center;width:100%;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <h2 style="font-size:clamp(20px,4vw,32px);font-weight:700;color:${colors.text};margin:0 0 16px 0;line-height:1.3${headingFont};">${editableText('content.headline', content.headline)}</h2>
  <p style="font-size:18px;color:${colors.textSub};margin:0;line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>
</div>`;
}

// 모바일 hero — 쿠팡 모바일 스타일: 필기체 eyebrow + 34px 헤드라인 + 해시태그/문단 subheadline
function renderMobileHero(content: HeroContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = section.eyebrow
    ? `<div style="font-family:'Snell Roundhand','Brush Script MT',cursive;font-size:22px;color:${colors.labelColor};margin-bottom:10px;">${escapeHtml(section.eyebrow)}</div>`
    : '';
  const sub = content.subheadline.trim();
  const subHtml = sub.startsWith('#')
    ? `<div style="text-align:center;"><span data-edit-path="content.subheadline" style="font-size:18px;font-weight:700;color:${colors.text};word-spacing:12px;line-height:1.8;">${escapeHtml(sub)}</span></div>`
    : `<p style="margin:0;font-size:17px;color:${colors.textSub};line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>`;
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:0;box-sizing:border-box;">
  <div style="padding:32px 20px 24px;text-align:center;">
    ${eyebrowHtml}
    <h1 style="margin:0 0 14px;font-size:34px;font-weight:800;color:${colors.text};letter-spacing:-1px;line-height:1.3${headingFont};">${editableText('content.headline', content.headline)}</h1>
    ${subHtml}
  </div>
  ${renderFullBleedImages(section)}
</div>`;
}

function renderSellingPoints(content: SellingPointsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const pointsHtml = content.points
    .map(
      (point, index) => `<div style="flex:1;min-width:calc(50% - 12px);background-color:${colors.cardBg};border:1px solid ${colors.border};border-top:4px solid ${colors.accent};border-radius:8px;padding:24px;box-sizing:border-box;">
      <div style="font-size:16px;font-weight:700;color:${colors.text};margin-bottom:8px${headingFont};">${editableText(`content.points.${index}.title`, point.title)}</div>
      <div style="font-size:14px;color:${colors.textSub};line-height:1.6;">${editableMarkupText(`content.points.${index}.description`, point.description, colors.accent)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;gap:24px;">
    ${pointsHtml}
  </div>
</div>`;
}

function renderFeatures(content: FeaturesContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const itemsHtml = content.items
    .map(
      (item, index) => `<div style="padding:24px 0;border-bottom:${index < content.items.length - 1 ? `1px solid ${colors.border}` : 'none'};">
      <div style="font-size:18px;font-weight:700;color:${colors.text};margin-bottom:8px${headingFont};">${editableText(`content.items.${index}.title`, item.title)}</div>
      <div style="font-size:15px;color:${colors.textSub};line-height:1.7;">${editableMarkupText(`content.items.${index}.description`, item.description, colors.accent)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  ${itemsHtml}
</div>`;
}

function renderStats(content: StatsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const statsHtml = content.stats
    .map(
      (stat, index) => `<div style="text-align:center;flex:1;min-width:120px;padding:16px;">
      <div style="font-size:48px;font-weight:700;color:${colors.accent};line-height:1.1;margin-bottom:8px${headingFont};">${editableText(`content.stats.${index}.value`, stat.value)}</div>
      <div style="font-size:16px;color:${colors.textSub};">${editableText(`content.stats.${index}.label`, stat.label)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0;">
    ${statsHtml}
  </div>
</div>`;
}

function renderSpecTable(content: SpecTableContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  if (theme.layoutMode === 'mobile') return renderMobileSpecTable(content, section, colors);

  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const rowsHtml = content.specs
    .map(
      (spec, index) => `<tr>
      <td style="padding:12px 16px;background-color:${colors.bgAlt};color:${colors.text};font-weight:600;font-size:14px;border:1px solid ${colors.border};width:35%;vertical-align:top;word-break:break-word${headingFont};">${editableText(`content.specs.${index}.label`, spec.label)}</td>
      <td style="padding:12px 16px;background-color:${colors.cardBg};color:${colors.textSub};font-size:14px;border:1px solid ${colors.border};vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.value`, spec.value)}</td>
    </tr>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
    ${rowsHtml}
  </table>
</div>`;
}

// 모바일 spec_table — 쿠팡 모바일 스타일: 팔레트 패널 안에 보더리스 행
function renderMobileSpecTable(content: SpecTableContent, section: DetailSection, colors: PaletteColors): string {
  // 패널은 외곽(cardBg)과 구분되어야 한다 — bg가 cardBg와 같은 팔레트(cool_white 등)는 bgAlt 사용
  const panelBg = colors.bg.toLowerCase() === colors.cardBg.toLowerCase() ? colors.bgAlt : colors.bg;
  const rowsHtml = content.specs
    .map(
      (spec, index) => `<tr>
      <td style="padding:14px 8px;font-size:15px;font-weight:600;color:${colors.textSub};width:32%;border-bottom:1px solid ${colors.border};vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.label`, spec.label)}</td>
      <td style="padding:14px 8px;font-size:15px;color:${colors.text};border-bottom:1px solid ${colors.border};vertical-align:top;word-break:break-word;">${editableText(`content.specs.${index}.value`, spec.value)}</td>
    </tr>`,
    )
    .join('\n');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:32px 20px;box-sizing:border-box;">
  <div style="background-color:${panelBg};border-radius:8px;padding:8px 16px;">
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      ${rowsHtml}
    </table>
  </div>
</div>`;
}

function renderUsageSteps(content: UsageStepsContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);

  const stepsHtml = content.steps
    .map(
      (step, index) => `<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:24px;">
      <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background-color:${colors.accent};color:${colors.accentTextColor};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;line-height:36px;text-align:center;min-width:36px${headingFont};">${index + 1}</div>
      <div style="font-size:16px;color:${colors.text};line-height:1.7;padding-top:6px;">${editableMarkupText(`content.steps.${index}`, step, colors.accent)}</div>
    </div>`
    )
    .join('\n');

  return `<div ${sectionAttrs(section)} style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  ${stepsHtml}
</div>`;
}

// warning: 배경·border 고정 색상 유지 (WCAG 가시성), markup은 palette accent 적용
function renderWarning(content: WarningContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const eyebrowHtml = renderEyebrow(section, colors, theme);
  const itemsHtml = content.warnings
    .map(
      (warning, index) => `<div style="margin-bottom:12px;font-size:15px;color:#6B4F00;line-height:1.6;"><span style="font-weight:700;margin-right:6px;">&#9650;</span>${editableMarkupText(`content.warnings.${index}`, warning, colors.accent)}</div>`
    )
    .join('\n');
  const pad = theme.layoutMode === 'mobile' ? '32px 20px' : '32px 40px';

  return `<div ${sectionAttrs(section)} style="background-color:#FFF3CD;border-left:4px solid #FFC107;padding:${pad};box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  ${itemsHtml}
</div>`;
}

function renderCta(content: CtaContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const imageHtml = renderAttachedImage(section, theme.imageLayout);
  const headingFont = headingFontStyle(theme.fontStyle);
  const eyebrowHtml = renderEyebrow(section, colors, theme);
  const pad = theme.layoutMode === 'mobile' ? '40px 20px' : '60px 40px';
  const fontSize = theme.layoutMode === 'mobile' ? '24px' : '36px';

  return `<div ${sectionAttrs(section)} style="background-color:${colors.accent};padding:${pad};text-align:center;box-sizing:border-box;">
  ${eyebrowHtml}
  ${imageHtml}
  <p style="font-size:${fontSize};font-weight:700;color:${colors.accentTextColor};margin:0;line-height:1.4${headingFont};">${editableText('content.text', content.text)}</p>
</div>`;
}

// ─────────────────────────────────────────
// 모바일 섹션 렌더러 (brand_header / point / image_grid)
// ─────────────────────────────────────────

/** attachedImages 전체를 전체폭 이미지로 렌더링 (패딩 0) */
function renderFullBleedImages(section: DetailSection): string {
  return section.attachedImages
    .map((img) => {
      const safe = sanitizeUrl(img.url);
      return safe ? `<img src="${escapeHtml(safe)}" alt="" style="width:100%;display:block;" />` : '';
    })
    .join('');
}

/** #RGB/#RGBA/#RRGGBB/#RRGGBBAA hex만 허용, 그 외 기본 회색 (CSS 인젝션 방지) */
function sanitizeSwatchColor(color: string | undefined): string {
  return color && /^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color) ? color : '#cccccc';
}

function renderBrandHeader(content: BrandHeaderContent, section: DetailSection, colors: PaletteColors): string {
  return `<div ${sectionAttrs(section)} style="display:flex;justify-content:space-between;align-items:baseline;padding:16px 20px;border-bottom:1px solid ${colors.border};background-color:${colors.cardBg};box-sizing:border-box;">
  <span style="font-size:15px;font-weight:600;color:${colors.text};">${editableText('content.brandName', content.brandName)}</span>
  <span style="font-size:13px;color:${colors.textSub};">${editableText('content.rightLabel', content.rightLabel)}</span>
</div>`;
}

function renderPoint(content: PointContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const headingFont = headingFontStyle(theme.fontStyle);
  const safeUrl = section.attachedImages[0] ? sanitizeUrl(section.attachedImages[0].url) : '';

  if (!safeUrl) {
    // 이미지 없는 경우: 텍스트만 렌더링
    const labelHtml = content.pointLabel
      ? `<div style="margin-bottom:12px;"><span style="display:block;font-size:18px;color:${colors.labelColor};margin-bottom:6px;">&#9745;</span><span style="font-family:Georgia,serif;font-style:italic;font-size:26px;color:${colors.labelColor};">${editableText('content.pointLabel', content.pointLabel)}</span></div>`
      : '';
    return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 20px 28px;text-align:center;box-sizing:border-box;">
  ${labelHtml}
  <h2 style="margin:0 0 10px;font-size:28px;font-weight:800;color:${colors.text};line-height:1.35;letter-spacing:-0.5px${headingFont};">${editableText('content.headline', content.headline)}</h2>
  <p style="margin:0;font-size:17px;color:${colors.textSub};line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>
</div>`;
  }

  // textPosition에 따라 오버레이 위치 결정 (기본값: bottom)
  const tp = content.textPosition ?? 'bottom';
  const overlayStyle =
    tp === 'top'
      ? 'position:absolute;top:0;left:0;right:0;background:linear-gradient(rgba(0,0,0,0.82) 0%,rgba(0,0,0,0.60) 65%,transparent 100%);padding:28px 20px 24px;text-align:center;line-height:1.4;box-sizing:border-box;'
      : tp === 'center'
      ? 'position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);background:rgba(0,0,0,0.70);padding:20px;text-align:center;line-height:1.4;box-sizing:border-box;'
      : 'position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent 0%,rgba(0,0,0,0.60) 35%,rgba(0,0,0,0.82) 100%);padding:24px 20px 28px;text-align:center;line-height:1.4;box-sizing:border-box;';

  const labelHtml = content.pointLabel
    ? `<div style="margin-bottom:8px;"><span style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:rgba(255,255,255,0.92);">${editableText('content.pointLabel', content.pointLabel)}</span></div>`
    : '';
  return `<div ${sectionAttrs(section)} style="position:relative;width:100%;overflow:hidden;line-height:0;box-sizing:border-box;">
  <img src="${escapeHtml(safeUrl)}" alt="" style="width:100%;display:block;" />
  <div style="${overlayStyle}">
    ${labelHtml}
    <h2 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#fff;line-height:1.3;letter-spacing:-0.5px;text-shadow:0 2px 8px rgba(0,0,0,0.8),0 0 20px rgba(0,0,0,0.5)${headingFont};">${editableText('content.headline', content.headline)}</h2>
    <p style="margin:0;font-size:16px;color:rgba(255,255,255,0.88);line-height:1.5;">${editableMarkupText('content.subheadline', content.subheadline, 'rgba(255,255,255,0.7)')}</p>
  </div>
</div>`;
}

function renderImageGrid(content: ImageGridContent, section: DetailSection, colors: PaletteColors): string {
  // points가 있으면 배경 이미지 + Point 스타일 오버레이 렌더링
  if (content.points && content.points.length > 0) {
    const bgUrl = section.attachedImages[0]?.url ?? '';
    const safeUrl = bgUrl ? sanitizeUrl(bgUrl) : '';
    const escapedTitle = escapeHtml(content.title);
    const bulletItems = content.points
      .map(p => `<li style="margin-bottom:6px;font-size:14px;line-height:1.4;">${escapeHtml(p)}</li>`)
      .join('');

    return `<div ${sectionAttrs(section)} style="position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;">
  ${safeUrl ? `<img src="${escapeHtml(safeUrl)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />` : ''}
  <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%);padding:24px 20px 20px;color:#fff;">
    ${escapedTitle ? `<p style="margin:0 0 10px;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${escapedTitle}</p>` : ''}
    <ul style="margin:0;padding-left:16px;">${bulletItems}</ul>
  </div>
</div>`;
  }

  // fallback: 기존 그리드 렌더링 (points 없는 경우)
  const titleHtml = content.title
    ? `<h2 style="margin:0 0 24px;font-family:Georgia,serif;font-size:26px;font-weight:400;color:${colors.textSub};text-align:center;">${editableText('content.title', content.title)}</h2>`
    : '';
  const cells = content.items
    .map((item, i) => {
      const img = section.attachedImages[i];
      const safe = img ? sanitizeUrl(img.url) : '';
      const imgHtml = safe ? `<img src="${escapeHtml(safe)}" alt="" style="width:100%;display:block;border-radius:8px;" />` : '';
      const swatchHtml = item.swatchColor !== undefined
        ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background-color:${sanitizeSwatchColor(item.swatchColor)};margin-right:6px;vertical-align:-2px;"></span>`
        : '';
      const labelHtml = item.label
        ? `<div style="margin-top:8px;font-size:15px;color:${colors.text};">${swatchHtml}${editableText(`content.items.${i}.label`, item.label)}</div>`
        : '';
      return `<div style="width:50%;padding:8px;box-sizing:border-box;text-align:center;">${imgHtml}${labelHtml}</div>`;
    })
    .join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 12px;box-sizing:border-box;">
  ${titleHtml}
  <div style="display:flex;flex-wrap:wrap;">${cells}</div>
</div>`;
}

// ─────────────────────────────────────────
// Rich 섹션 렌더러 (6종)
// ─────────────────────────────────────────

function renderPointSection(content: PointSectionContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) =>
    `<div style="background:#f8fafc;border-radius:12px;padding:24px;margin-bottom:12px;display:flex;gap:20px;align-items:flex-start;">
      <div style="flex-shrink:0;"><div style="background:#1e293b;color:#ffffff;font-size:10px;font-weight:800;padding:4px 10px;border-radius:20px;white-space:nowrap;letter-spacing:1px;">POINT ${escapeHtml(String(item.number))}</div></div>
      <div>
        <div style="font-size:18px;font-weight:800;color:${colors.text};margin-bottom:6px;">${editableText(`content.items.${i}.title`, item.title)}</div>
        <div style="font-size:13px;color:${colors.textSub};line-height:1.6;">${editableText(`content.items.${i}.description`, item.description)}</div>
      </div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:40px 24px;width:100%;box-sizing:border-box;">${itemsHtml}</div>`;
}

function renderStatCallout(content: StatCalloutContent, section: DetailSection, colors: PaletteColors): string {
  const cols = Math.max(1, Math.min(content.items.length, 3));
  const itemsHtml = content.items.map((item, i) =>
    `<div style="background:linear-gradient(135deg,#1e293b,#334155);border-radius:12px;padding:20px 16px;text-align:center;">
      <div style="font-size:28px;font-weight:900;color:#f8fafc;line-height:1.2;">${editableText(`content.items.${i}.value`, item.value)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${editableText(`content.items.${i}.label`, item.label)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;">${editableText(`content.items.${i}.description`, item.description)}</div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;">${itemsHtml}</div></div>`;
}

function renderBarChart(content: BarChartContent, section: DetailSection, colors: PaletteColors): string {
  const maxPct = Math.max(...content.items.map(i => i.percentage), 1);
  const itemsHtml = content.items.map((item, i) => {
    const barWidth = Math.min(Math.round((item.percentage / maxPct) * 100), 100);
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <span style="font-size:13px;color:${colors.text};width:100px;flex-shrink:0;">${editableText(`content.items.${i}.label`, item.label)}</span>
      <div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${barWidth}%;background:linear-gradient(90deg,#6366f1,#818cf8);border-radius:4px;"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:#6366f1;width:50px;text-align:right;flex-shrink:0;">${editableText(`content.items.${i}.displayValue`, item.displayValue)}</span>
    </div>`;
  }).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.bg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="background:#f8fafc;border-radius:12px;padding:20px;">${itemsHtml}</div></div>`;
}

function renderWhyIcons(content: WhyIconsContent, section: DetailSection, colors: PaletteColors): string {
  const cols = Math.max(1, Math.min(content.items.length, 4));
  const itemsHtml = content.items.map((item, i) =>
    `<div style="text-align:center;padding:16px 8px;">
      ${accentNumberBadge(i + 1, colors)}
      <div style="font-size:13px;font-weight:700;color:${colors.text};margin-bottom:4px;word-break:keep-all;">${editableText(`content.items.${i}.title`, item.title)}</div>
      <div style="font-size:11px;color:${colors.textSub};line-height:1.4;">${editableText(`content.items.${i}.description`, item.description)}</div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px;">${itemsHtml}</div></div>`;
}

function renderCertifications(content: CertificationsContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) =>
    `<div style="border:2px solid #e2e8f0;border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;">
      <div style="flex-shrink:0;width:24px;height:24px;border-radius:50%;background:${colors.accent};color:${colors.accentTextColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;">✓</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:${colors.text};">${editableText(`content.items.${i}.name`, item.name)}</div>
        <div style="font-size:11px;color:${colors.textSub};margin-top:2px;">${editableText(`content.items.${i}.description`, item.description)}</div>
      </div>
    </div>`
  ).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:flex;gap:12px;flex-wrap:wrap;">${itemsHtml}</div></div>`;
}

function renderInfographicSteps(content: InfographicStepsContent, section: DetailSection, colors: PaletteColors): string {
  const itemsHtml = content.items.map((item, i) => {
    const isLast = i === content.items.length - 1;
    const arrow = isLast ? '' : `<div style="position:absolute;right:-10px;top:18px;color:#94a3b8;font-size:18px;z-index:1;">→</div>`;
    return `<div style="flex:1;text-align:center;position:relative;">
      ${arrow}
      <div style="width:36px;height:36px;background:${colors.accent};color:${colors.accentTextColor};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;margin:0 auto 8px;">${escapeHtml(String(item.step))}</div>
      <div style="font-size:12px;font-weight:700;color:${colors.text};margin-bottom:3px;word-break:keep-all;">${editableText(`content.items.${i}.title`, item.title)}</div>
      <div style="font-size:11px;color:${colors.textSub};">${editableText(`content.items.${i}.description`, item.description)}</div>
    </div>`;
  }).join('');
  return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 24px;width:100%;box-sizing:border-box;"><div style="display:flex;align-items:flex-start;gap:0;">${itemsHtml}</div></div>`;
}

// ─────────────────────────────────────────
// claude_layout 블록 렌더러
// ─────────────────────────────────────────

function resolveBgColor(bgStyle: ClaudeLayoutContent['bgStyle'], colors: PaletteColors): string {
  switch (bgStyle) {
    case 'light':   return colors.cardBg;
    case 'dark':    return '#1e293b';
    case 'primary': return colors.accent;
    default:        return colors.bg;   // 'white' 또는 미지정 → 기본 배경
  }
}

function resolvePad(padding: ClaudeLayoutContent['padding']): string {
  switch (padding) {
    case 'compact': return '24px 16px';
    case 'wide':    return '56px 28px';
    default:        return '40px 24px';
  }
}

// layout_bar_chart 전용 SVG 생성 헬퍼 (쿠팡 SVG 미지원 대응 → base64 img embed)
function buildBarChartSvg(
  block: Extract<LayoutBlock, { type: 'layout_bar_chart' }>
): string {
  const W = 700;
  const LEGEND_H = block.showLegend !== false ? 28 : 0;
  const PAD = { top: 24, right: 20, bottom: 44, left: 52 };
  const chartH = 220;
  const H = chartH + PAD.top + PAD.bottom + LEGEND_H;
  const innerW = W - PAD.left - PAD.right;
  const innerH = chartH;

  const allValues = block.items.flatMap(i => i.values);
  const maxVal = Math.max(...allValues, 1);
  const groups = block.groups;
  const colors = block.groupColors;
  const groupCount = groups.length;
  const itemCount = block.items.length;
  const groupW = innerW / (itemCount || 1);
  const barW = Math.min(24, (groupW - 8) / (groupCount || 1));

  // Y축 눈금 5개
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const yVal = Math.round(maxVal * t);
    const y = PAD.top + innerH - innerH * t;
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${PAD.left + innerW}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>
      <text x="${PAD.left - 6}" y="${(y + 4).toFixed(1)}" font-size="10" fill="#9ca3af" text-anchor="end">${yVal}</text>`;
  });

  // 막대 + x 레이블
  const bars = block.items.map((item, i) => {
    const centerX = PAD.left + i * groupW + groupW / 2;
    const groupBars = groups.map((_, gi) => {
      const val = item.values[gi] ?? 0;
      const barH = Math.max(2, (val / maxVal) * innerH);
      const x = centerX - (groupCount * barW) / 2 + gi * barW;
      const y = PAD.top + innerH - barH;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${barH.toFixed(1)}" fill="${escapeHtml(colors[gi] ?? '#6b7280')}" rx="2"/>`;
    });
    const labelY = PAD.top + innerH + 14;
    return [...groupBars, `<text x="${centerX.toFixed(1)}" y="${labelY}" font-size="10" fill="#6b7280" text-anchor="middle">${escapeHtml(item.label)}</text>`].join('');
  });

  // Y축 단위
  const unitLabel = block.unit
    ? `<text x="${PAD.left - 36}" y="${PAD.top - 8}" font-size="10" fill="#9ca3af">${escapeHtml(block.unit)}</text>`
    : '';

  // 범례
  const legend = block.showLegend !== false
    ? groups.map((g, gi) => {
        const lx = PAD.left + gi * 90;
        return `<rect x="${lx}" y="${H - LEGEND_H + 6}" width="10" height="10" fill="${escapeHtml(colors[gi] ?? '#6b7280')}" rx="2"/>
      <text x="${lx + 14}" y="${H - LEGEND_H + 15}" font-size="11" fill="#6b7280">${escapeHtml(g)}</text>`;
      }).join('')
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    ${ticks.join('')}
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + innerH}" stroke="#d1d5db" stroke-width="1.5"/>
    ${bars.join('')}
    ${unitLabel}
    ${legend}
  </svg>`;
}

// radar_chart 전용 극좌표계 SVG 생성 헬퍼 (쿠팡 SVG 미지원 대응 → base64 img embed)
function buildRadarChartSvg(
  block: Extract<LayoutBlock, { type: 'radar_chart' }>
): string {
  const axes = block.axes;
  if (axes.length === 0) return '';

  const W = 400;
  const H = 380;
  const CX = W / 2;
  const CY = H / 2 - 10;  // 레이블 공간 확보를 위해 살짝 위로
  const R = 130;           // 최대 반지름
  const N = axes.length;
  const color = block.color ?? '#6366f1';

  // 각 축의 각도 (맨 위에서 시작, 시계방향)
  const angleOf = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / N;

  // 값 → 반지름 변환 (max 기본값 100)
  const toRadius = (value: number, max: number) =>
    R * Math.min(1, Math.max(0, value / (max || 100)));

  // 배경 거미줄 (5단계)
  const RINGS = 5;
  const rings = Array.from({ length: RINGS }, (_, k) => {
    const r = (R * (k + 1)) / RINGS;
    const pts = Array.from({ length: N }, (__, i) => {
      const a = angleOf(i);
      return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
    }).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="#e5e7eb" stroke-width="${k === RINGS - 1 ? 1.5 : 0.8}"/>`;
  });

  // 축 선
  const axisLines = axes.map((_, i) => {
    const a = angleOf(i);
    const x2 = (CX + R * Math.cos(a)).toFixed(1);
    const y2 = (CY + R * Math.sin(a)).toFixed(1);
    return `<line x1="${CX}" y1="${CY}" x2="${x2}" y2="${y2}" stroke="#d1d5db" stroke-width="1"/>`;
  });

  // 데이터 폴리곤
  const dataPoints = axes.map((axis, i) => {
    const a = angleOf(i);
    const r = toRadius(axis.value, axis.max ?? 100);
    return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
  });
  const polygon = `<polygon points="${dataPoints.join(' ')}" fill="${escapeHtml(color)}33" stroke="${escapeHtml(color)}" stroke-width="2"/>`;

  // 데이터 점
  const dots = axes.map((axis, i) => {
    const a = angleOf(i);
    const r = toRadius(axis.value, axis.max ?? 100);
    const cx = (CX + r * Math.cos(a)).toFixed(1);
    const cy = (CY + r * Math.sin(a)).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="4" fill="${escapeHtml(color)}" stroke="white" stroke-width="1.5"/>`;
  });

  // 축 레이블
  const LABEL_OFFSET = 18;
  const labels = axes.map((axis, i) => {
    const a = angleOf(i);
    const lx = CX + (R + LABEL_OFFSET) * Math.cos(a);
    const ly = CY + (R + LABEL_OFFSET) * Math.sin(a);
    const anchor = Math.cos(a) > 0.1 ? 'start' : Math.cos(a) < -0.1 ? 'end' : 'middle';
    // 값 표시
    const valPct = Math.round((axis.value / (axis.max ?? 100)) * 100);
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="11" fill="#374151" text-anchor="${anchor}" dominant-baseline="middle">${escapeHtml(axis.label)}</text>
      <text x="${lx.toFixed(1)}" y="${(ly + 14).toFixed(1)}" font-size="10" fill="${escapeHtml(color)}" text-anchor="${anchor}" font-weight="700">${valPct}%</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="white"/>
    ${rings.join('')}
    ${axisLines.join('')}
    ${polygon}
    ${dots.join('')}
    ${labels.join('')}
  </svg>`;
}

// 이모지 아이콘 대신 쓰는 accent 아웃라인 번호 배지. 이모지는 상업 상세페이지에서
// "AI 티"·저품질로 읽히므로 렌더 단계에서 통일된 배지로 대체한다(dark 배경 대응).
function accentNumberBadge(index: number, colors: PaletteColors): string {
  const isDark = colors.text === '#ffffff';
  const c = isDark ? '#ffffff' : colors.accent;
  return `<div style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;border:2px solid ${c};color:${c};font-size:14px;font-weight:800;margin:0 auto 8px;">${index}</div>`;
}

function renderLayoutBlock(
  block: LayoutBlock,
  images: AttachedImage[],
  colors: PaletteColors,
  basePath: string = '',
): string {
  switch (block.type) {
    case 'badge': {
      // dark/primary 배경에서는 accent 배지 배경이 섹션 배경과 같아져 배지가 사라진다.
      const isDark = colors.text === '#ffffff';
      const bg =
        block.color === 'neutral'
          ? (isDark ? 'rgba(255,255,255,0.2)' : '#e2e8f0')
          : (isDark ? 'rgba(255,255,255,0.18)' : colors.accent);
      const fg =
        block.color === 'neutral'
          ? (isDark ? '#ffffff' : '#334155')
          : (isDark ? '#ffffff' : colors.accentTextColor);
      return `<div style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:10px;">${editableText(`${basePath}.text`, block.text)}</div>`;
    }
    case 'heading': {
      // xl(38px)은 짧은 임팩트 헤드라인 전용. 문장형(16자 초과)이 xl이면 lg로 자동
      // 강등해 거대 폰트가 어색하게 줄바꿈되는 것을 막는다.
      const textLen = (block.text ?? '').length;
      const effSize = block.size === 'xl' && textLen > 16 ? 'lg' : block.size;
      const sz = effSize === 'xl' ? '38px' : effSize === 'lg' ? '26px' : '19px';
      const fw = block.bold !== false ? '800' : '600';
      // accent/primary 색 지정이어도 dark 배경(accent가 배경색)에서는 흰색으로.
      const isDark = colors.text === '#ffffff';
      const color =
        block.color === 'accent' || block.color === 'primary'
          ? (isDark ? '#ffffff' : colors.accent)
          : colors.text;
      // word-break:keep-all → 한국어 단어 중간 절단("의 여유") 방지.
      return `<div style="font-size:${sz};font-weight:${fw};color:${color};line-height:1.25;letter-spacing:-0.5px;margin-bottom:10px;word-break:keep-all;overflow-wrap:break-word;">${editableText(`${basePath}.text`, block.text)}</div>`;
    }
    case 'subtext': {
      const align = block.align === 'center' ? 'center' : 'left';
      return `<div style="font-size:15px;color:${colors.textSub};line-height:1.65;text-align:${align};margin-bottom:10px;word-break:keep-all;overflow-wrap:break-word;">${editableText(`${basePath}.text`, block.text)}</div>`;
    }
    case 'image': {
      const img = images[block.attachedIndex];
      if (!img?.url) return '';
      const safeUrl = sanitizeUrl(img.url);
      if (!safeUrl) return '';
      const width = block.width ?? '100%';
      const align =
        block.align === 'left'
          ? 'flex-start'
          : block.align === 'right'
          ? 'flex-end'
          : 'center';
      const radius = block.rounded ? 'border-radius:12px;' : '';
      return `<div style="display:flex;justify-content:${align};margin-bottom:12px;"><img src="${escapeHtml(safeUrl)}" alt="" style="width:${escapeHtml(width)};max-width:100%;object-fit:contain;${radius}" /></div>`;
    }
    case 'stat_row': {
      if (!Array.isArray(block.items)) return '';
      // dark/primary 배경(accent가 배경색)에서는 accent 숫자가 안 보이므로 흰색으로.
      const isDark = colors.text === '#ffffff';
      const valueColor = isDark ? '#ffffff' : colors.accent;
      const items = block.items
        .map(
          (item, i) =>
            `<div style="text-align:center;flex:1;">
              <div style="font-size:44px;font-weight:900;color:${valueColor};line-height:1.05;letter-spacing:-1px;">${editableText(`${basePath}.items.${i}.value`, item.value)}${item.unit ? `<span style="font-size:18px;font-weight:700;margin-left:2px;">${editableText(`${basePath}.items.${i}.unit`, item.unit)}</span>` : ''}</div>
              <div style="font-size:12px;color:${colors.textSub};margin-top:6px;line-height:1.4;">${editableText(`${basePath}.items.${i}.label`, item.label)}</div>
            </div>`,
        )
        .join('');
      return `<div style="display:flex;gap:8px;padding:20px 0;margin-bottom:8px;">${items}</div>`;
    }
    case 'bullet_list': {
      if (!Array.isArray(block.items)) return '';
      const isDark = colors.text === '#ffffff';
      const iconColor = isDark ? 'rgba(255,255,255,0.9)' : colors.accent;
      const icon = block.icon === 'check' ? '✓' : block.icon === 'arrow' ? '→' : '•';
      const items = block.items
        .map(
          (item, i) =>
            `<li style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;font-size:14px;color:${colors.text};line-height:1.5;">
              <span style="color:${iconColor};flex-shrink:0;font-weight:700;">${icon}</span>
              <span>${editableText(`${basePath}.items.${i}`, item)}</span>
            </li>`,
        )
        .join('');
      return `<ul style="list-style:none;margin:0 0 12px;padding:0;">${items}</ul>`;
    }
    case 'columns': {
      if (!Array.isArray(block.cols)) return '';
      const gap = block.gap ?? 12;
      const cols = block.cols
        .map((col, c) => {
          const inner = col.map((b, r) => renderLayoutBlock(b, images, colors, `${basePath}.cols.${c}.${r}`)).join('');
          return `<div style="flex:1;min-width:0;">${inner}</div>`;
        })
        .join('');
      return `<div style="display:flex;gap:${gap}px;align-items:flex-start;margin-bottom:8px;">${cols}</div>`;
    }
    case 'divider':
      return `<hr style="border:none;border-top:1px solid ${colors.border};margin:12px 0;" />`;
    case 'spacer':
      return `<div style="height:${Math.min(block.height, 120)}px;"></div>`;
    case 'progress_bar': {
      if (!Array.isArray(block.items)) return '';
      const isDark = colors.text === '#ffffff';
      const items = block.items.map((item, i) => {
        const pct = Math.min(100, Math.max(0, item.value));
        const barColor = item.highlight
          ? (isDark ? '#ffffff' : colors.accent)
          : (isDark ? 'rgba(255,255,255,0.5)' : '#9ca3af');
        const trackColor = item.highlight
          ? (isDark ? 'rgba(255,255,255,0.25)' : `${colors.accent}22`)
          : (isDark ? 'rgba(255,255,255,0.15)' : '#e5e7eb');
        return `<div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:${colors.text};margin-bottom:4px;">
            <span>${editableText(`${basePath}.items.${i}.label`, item.label)}</span>
            <span style="font-weight:700;color:${barColor};">${editableText(`${basePath}.items.${i}.displayValue`, item.displayValue ?? `${pct}%`)}</span>
          </div>
          <div style="background:${trackColor};border-radius:8px;height:12px;overflow:hidden;">
            <div style="background:${barColor};height:100%;width:${pct}%;border-radius:8px;"></div>
          </div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:16px;">${items}</div>`;
    }
    case 'process_flow': {
      if (!Array.isArray(block.items)) return '';
      const isVertical = block.direction === 'vertical';
      // dark/primary 배경에서는 흰 글씨가 되므로 하드코딩된 밝은 박스 배경을 반투명 흰색으로 교체
      const isDark = colors.text === '#ffffff';
      const badgeBg = isDark ? '#ffffff' : colors.accent;
      const badgeFg = isDark ? '#111111' : colors.accentTextColor;
      const accentBar = isDark ? 'rgba(255,255,255,0.6)' : colors.accent;
      const items = block.items.map((item, i) => {
        const isLast = i === block.items.length - 1;
        const boxBg = item.highlight
          ? (isDark ? 'rgba(255,255,255,0.25)' : `${colors.accent}15`)
          : (isDark ? 'rgba(255,255,255,0.12)' : '#f9fafb');
        const boxBorder = item.highlight
          ? (isDark ? 'rgba(255,255,255,0.6)' : colors.accent)
          : (isDark ? 'rgba(255,255,255,0.25)' : '#e5e7eb');
        const textColor = item.highlight
          ? (isDark ? '#ffffff' : colors.accent)
          : colors.text;
        // 스텝 번호 배지로 시각적 앵커 추가(빈 회색 박스 → 단계감 부여).
        const stepBadge = `<div style="flex-shrink:0;width:26px;height:26px;border-radius:50%;background:${badgeBg};color:${badgeFg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;line-height:1;">${i + 1}</div>`;
        const label = editableText(`${basePath}.items.${i}.label`, item.label);
        const sublabel = item.sublabel
          ? `<div style="font-size:12px;color:${colors.textSub};margin-top:2px;word-break:keep-all;">${editableText(`${basePath}.items.${i}.sublabel`, item.sublabel)}</div>`
          : '';
        const arrow = isLast ? '' : (isVertical
          ? `<div style="text-align:center;color:${accentBar};font-size:14px;line-height:1;padding:2px 0;">↓</div>`
          : `<div style="color:${accentBar};font-size:16px;flex-shrink:0;align-self:center;">→</div>`);
        const box = isVertical
          ? `<div style="display:flex;align-items:center;gap:10px;background:${boxBg};border:1px solid ${boxBorder};border-left:3px solid ${accentBar};border-radius:8px;padding:10px 12px;text-align:left;">
              ${stepBadge}
              <div><div style="font-size:13px;font-weight:700;color:${textColor};word-break:keep-all;">${label}</div>${sublabel}</div>
            </div>`
          : `<div style="flex:1;background:${boxBg};border:1.5px solid ${boxBorder};border-radius:8px;padding:10px 8px;text-align:center;">
              <div style="display:flex;justify-content:center;margin-bottom:6px;">${stepBadge}</div>
              <div style="font-size:12px;font-weight:700;color:${textColor};word-break:keep-all;">${label}</div>${sublabel}
            </div>`;
        return box + (isLast ? '' : arrow);
      });
      const flexDir = isVertical ? 'column' : 'row';
      return `<div style="display:flex;flex-direction:${flexDir};gap:6px;align-items:${isVertical ? 'stretch' : 'center'};flex-wrap:wrap;margin-bottom:16px;">${items.join('')}</div>`;
    }
    case 'icon_grid': {
      if (!Array.isArray(block.items)) return '';
      const isDark = colors.text === '#ffffff';
      const itemBg = isDark ? 'rgba(255,255,255,0.12)' : '#f9fafb';
      const cols = block.cols ?? 3;
      const items = block.items.map((item, i) =>
        `<div style="text-align:center;padding:14px 6px;background:${itemBg};border-radius:10px;">
          ${accentNumberBadge(i + 1, colors)}
          <div style="font-size:13px;font-weight:700;color:${colors.text};line-height:1.3;word-break:keep-all;">${editableText(`${basePath}.items.${i}.title`, item.title)}</div>
          ${item.subtitle ? `<div style="font-size:12px;color:${colors.textSub};margin-top:2px;">${editableText(`${basePath}.items.${i}.subtitle`, item.subtitle)}</div>` : ''}
        </div>`
      ).join('');
      return `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;margin-bottom:16px;">${items}</div>`;
    }
    case 'option_grid': {
      if (!Array.isArray(block.items)) return '';
      // 사이즈·색상·용량 등 순서 없는 병렬 선택 옵션 — 화살표 없이 카드 그리드로 나열.
      // 컬러/구성처럼 옵션마다 대응 이미지가 있으면 카드 상단에 각각 표시한다
      // (attachedImages를 카드 인덱스로 매핑). 사이즈 등 이미지 없는 옵션은 텍스트만.
      const isDark = colors.text === '#ffffff';
      const cols = block.cols ?? (block.items.length >= 3 ? 3 : 2);
      const items = block.items.map((item, i) => {
        const boxBg = item.highlight
          ? (isDark ? 'rgba(255,255,255,0.25)' : `${colors.accent}15`)
          : (isDark ? 'rgba(255,255,255,0.12)' : '#f9fafb');
        const boxBorder = item.highlight
          ? (isDark ? 'rgba(255,255,255,0.6)' : colors.accent)
          : (isDark ? 'rgba(255,255,255,0.25)' : '#e5e7eb');
        const textColor = item.highlight
          ? (isDark ? '#ffffff' : colors.accent)
          : colors.text;
        const cardImg = images[i];
        const cardImgUrl = cardImg?.url ? sanitizeUrl(cardImg.url) : '';
        const cardImgHtml = cardImgUrl
          ? `<div style="margin-bottom:8px;"><img src="${escapeHtml(cardImgUrl)}" alt="" style="width:100%;max-width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;display:block;" /></div>`
          : '';
        const pad = cardImgUrl ? '8px' : '14px 8px';
        return `<div style="background:${boxBg};border:1.5px solid ${boxBorder};border-radius:12px;padding:${pad};text-align:center;">
          ${cardImgHtml}<div style="font-size:14px;font-weight:800;color:${textColor};line-height:1.3;">${editableText(`${basePath}.items.${i}.label`, item.label)}</div>
          ${item.sublabel ? `<div style="font-size:12px;color:${colors.textSub};margin-top:4px;line-height:1.4;">${editableText(`${basePath}.items.${i}.sublabel`, item.sublabel)}</div>` : ''}
        </div>`;
      }).join('');
      return `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;margin-bottom:16px;">${items}</div>`;
    }
    case 'layout_bar_chart': {
      const svg = buildBarChartSvg(block);
      const b64 = Buffer.from(svg).toString('base64');
      const titleHtml = block.title
        ? `<div style="font-size:13px;font-weight:700;margin-bottom:10px;text-align:center;">${escapeHtml(block.title)}</div>`
        : '';
      return `<div style="margin-bottom:16px;">${titleHtml}<img src="data:image/svg+xml;base64,${b64}" alt="${escapeHtml(block.title ?? '차트')}" style="width:100%;max-width:100%;display:block;" /></div>`;
    }
    case 'radar_chart': {
      if (block.axes.length === 0) return '';
      const svg = buildRadarChartSvg(block);
      const b64 = Buffer.from(svg).toString('base64');
      return `<div style="margin-bottom:16px;text-align:center;"><img src="data:image/svg+xml;base64,${b64}" alt="레이더 차트" style="width:100%;max-width:400px;display:inline-block;" /></div>`;
    }
    case 'timeline': {
      if (block.items.length === 0) return '';
      const N = block.items.length;

      const dots = block.items.map((item, i) => {
        const isHighlight = item.highlight ?? false;
        const dotBg = isHighlight ? colors.accent : '#d1d5db';
        const labelColor = isHighlight ? colors.accent : colors.text;
        const isLast = i === N - 1;

        return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;position:relative;">
          ${!isLast ? `<div style="position:absolute;top:12px;left:calc(50% + 12px);width:calc(50% - 12px);height:2px;background:#e5e7eb;z-index:0;"></div>` : ''}
          <div style="width:24px;height:24px;border-radius:50%;background-color:${dotBg};display:flex;align-items:center;justify-content:center;z-index:1;flex-shrink:0;">
            <span style="font-size:11px;font-weight:800;color:#ffffff;">${i + 1}</span>
          </div>
          <div style="margin-top:8px;font-size:12px;font-weight:700;color:${labelColor};text-align:center;">${escapeHtml(item.stage)}</div>
          ${item.value ? `<div style="margin-top:2px;font-size:11px;color:${colors.textSub};text-align:center;">${escapeHtml(item.value)}</div>` : ''}
        </div>`;
      });

      return `<div style="display:flex;flex-direction:row;align-items:flex-start;width:100%;padding:16px 0;position:relative;">
        ${dots.join('')}
      </div>`;
    }
    default:
      return '';
  }
}

function renderClaudeLayout(
  content: ClaudeLayoutContent,
  section: DetailSection,
  colors: PaletteColors,
): string {
  const bg = resolveBgColor(content.bgStyle, colors);
  const pad = resolvePad(content.padding);
  // dark/primary 배경에서는 텍스트 색을 밝게 강제 (팔레트 기본값이 어두운 색이므로)
  const effectiveColors: PaletteColors =
    content.bgStyle === 'dark' || content.bgStyle === 'primary'
      ? { ...colors, text: '#ffffff', textSub: 'rgba(255,255,255,0.72)' }
      : colors;
  const blocksHtml = (content.blocks ?? [])
    .map((b, i) => renderLayoutBlock(b, section.attachedImages, effectiveColors, `content.blocks.${i}`))
    .join('');
  return `<div ${sectionAttrs(section)} style="background-color:${bg};padding:${pad};width:100%;box-sizing:border-box;">${blocksHtml}</div>`;
}

type RenderMode = 'preview' | 'export';

function renderYoutube(content: YoutubeContent, section: DetailSection, mode: RenderMode): string {
  if (!content.enabled || !YOUTUBE_ID_RE.test(content.videoId)) return '';
  const caption = content.caption
    ? `<p style="text-align:center;font-size:12px;color:#888888;margin:8px 0 0;">${escapeHtml(content.caption)}</p>`
    : '';
  const ratio = content.aspect === 'vertical' ? '9 / 16' : '16 / 9';
  const maxW = content.aspect === 'vertical' ? '340px' : '100%';

  if (mode === 'preview') {
    return `<section ${sectionAttrs(section)} style="padding:16px 0;">
      <div style="max-width:${maxW};margin:0 auto;aspect-ratio:${ratio};">
        <iframe width="100%" height="100%" style="border:0;border-radius:12px;"
          src="https://www.youtube.com/embed/${content.videoId}"
          title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>
      </div>${caption}
    </section>`;
  }

  // export — 합성 썸네일 img + 링크
  // 유튜브는 모든 영상에 16:9 썸네일만 제공하므로, 세로(Shorts) 섹션은 프리뷰의
  // 9:16 프레이밍과 맞추기 위해 썸네일을 중앙 크롭한다(재생 버튼은 중앙 합성이라 크롭 후에도 보임).
  const rawSrc = content.exportThumbnailUrl ?? `https://img.youtube.com/vi/${content.videoId}/hqdefault.jpg`;
  const rawHref = content.url || `https://www.youtube.com/watch?v=${content.videoId}`;
  const src = escapeHtml(sanitizeUrl(rawSrc));
  const href = escapeHtml(sanitizeUrl(rawHref));
  const thumbnailHtml = content.aspect === 'vertical'
    ? `<div style="max-width:340px;margin:0 auto;aspect-ratio:9 / 16;overflow:hidden;border-radius:12px;">
      <a href="${href}" target="_blank" rel="noopener" style="display:block;">
        <img src="${src}" alt="유튜브 영상" style="width:100%;height:100%;object-fit:cover;display:block;" />
      </a>
    </div>`
    : `<div style="max-width:100%;">
      <a href="${href}" target="_blank" rel="noopener" style="display:block;">
        <img src="${src}" alt="유튜브 영상" style="width:100%;border-radius:12px;display:block;" />
      </a>
    </div>`;
  return `<section ${sectionAttrs(section)} style="padding:16px 0;">
    ${thumbnailHtml}${caption}
  </section>`;
}

export function renderSection(section: DetailSection, theme: DetailPageTheme, mode: RenderMode = 'export'): string {
  const colors = PALETTES[theme.palette];
  switch (section.type) {
    case 'hero':
      return renderHero(section.content as HeroContent, section, colors, theme);
    case 'selling_points':
      return renderSellingPoints(section.content as SellingPointsContent, section, colors, theme);
    case 'features':
      return renderFeatures(section.content as FeaturesContent, section, colors, theme);
    case 'stats':
      return renderStats(section.content as StatsContent, section, colors, theme);
    case 'spec_table':
      return renderSpecTable(section.content as SpecTableContent, section, colors, theme);
    case 'usage_steps':
      return renderUsageSteps(section.content as UsageStepsContent, section, colors, theme);
    case 'warning':
      return renderWarning(section.content as WarningContent, section, colors, theme);
    case 'cta':
      return renderCta(section.content as CtaContent, section, colors, theme);
    case 'brand_header':
      return renderBrandHeader(section.content as BrandHeaderContent, section, colors);
    case 'point':
      return renderPoint(section.content as PointContent, section, colors, theme);
    case 'image_grid':
      return renderImageGrid(section.content as ImageGridContent, section, colors);
    case 'point_section':
      return renderPointSection(section.content as PointSectionContent, section, colors);
    case 'stat_callout':
      return renderStatCallout(section.content as StatCalloutContent, section, colors);
    case 'bar_chart':
      return renderBarChart(section.content as BarChartContent, section, colors);
    case 'why_icons':
      return renderWhyIcons(section.content as WhyIconsContent, section, colors);
    case 'certifications':
      return renderCertifications(section.content as CertificationsContent, section, colors);
    case 'infographic_steps':
      return renderInfographicSteps(section.content as InfographicStepsContent, section, colors);
    case 'claude_layout':
      return renderClaudeLayout(section.content as ClaudeLayoutContent, section, colors);
    case 'youtube':
      return renderYoutube(section.content as YoutubeContent, section, mode);
  }
}

export function renderAllSections(sections: DetailSection[], theme: DetailPageTheme, mode: RenderMode = 'export'): string {
  return [...sections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => renderSection(s, theme, mode))
    .join('\n');
}
