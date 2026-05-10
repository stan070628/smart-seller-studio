// src/lib/detail-page/section-renderer.ts
// 각 SectionType을 받아서 인라인 스타일 HTML 문자열을 반환하는 순수 렌더링 함수
// 쿠팡 상세페이지 제약: 인라인 스타일만 허용

import type {
  DetailSection,
  DetailPageTheme,
  HeroContent,
  SellingPointsContent,
  FeaturesContent,
  StatsContent,
  SpecTableContent,
  UsageStepsContent,
  WarningContent,
  CtaContent,
} from '@/types/detail-page';
import type { PaletteColors } from '@/lib/detail-page/palette-config';
import { PALETTES } from '@/lib/detail-page/palette-config';

// ─────────────────────────────────────────
// 보안 헬퍼
// ─────────────────────────────────────────

// HTML 특수문자를 이스케이프하여 XSS/인젝션 방지
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 이미지 URL 검증: http:// 또는 https://로 시작하지 않으면 빈 문자열 반환
function sanitizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return '';
}

// ─────────────────────────────────────────
// 첨부 이미지 렌더러
// ─────────────────────────────────────────

// 첨부 이미지가 있으면 첫 번째 이미지를 반환, 없으면 빈 문자열
function renderAttachedImage(section: DetailSection): string {
  if (section.attachedImages.length === 0) return '';
  const img = section.attachedImages[0];
  const safeUrl = sanitizeUrl(img.url);
  if (!safeUrl) return '';
  return `<img src="${escapeHtml(safeUrl)}" alt="" style="width:100%;display:block;max-width:100%;height:auto;" />`;
}

// ─────────────────────────────────────────
// 섹션 렌더러
// ─────────────────────────────────────────

// hero 섹션: fullbleed 레이아웃, headline h2(32px bold) + subheadline p(18px)
function renderHero(content: HeroContent, section: DetailSection, colors: PaletteColors): string {
  const imageHtml = renderAttachedImage(section);

  return `<div data-section-id="${escapeHtml(section.id)}" style="background-color:${colors.bg};color:${colors.text};padding:60px 40px;text-align:center;width:100%;box-sizing:border-box;">
  ${imageHtml}
  <h2 style="font-size:32px;font-weight:700;color:${colors.text};margin:0 0 16px 0;line-height:1.3;">${escapeHtml(content.headline)}</h2>
  <p style="font-size:18px;color:${colors.textSub};margin:0;line-height:1.6;">${escapeHtml(content.subheadline)}</p>
</div>`;
}

// selling_points 섹션: 최대 2컬럼 그리드, icon + title + description, cardBg 배경
function renderSellingPoints(content: SellingPointsContent, section: DetailSection, colors: PaletteColors): string {
  const imageHtml = renderAttachedImage(section);

  const pointsHtml = content.points
    .map(
      (point) => `<div style="flex:1;min-width:calc(50% - 12px);background-color:${colors.cardBg};border:1px solid ${colors.border};border-radius:8px;padding:24px;box-sizing:border-box;">
      <div style="font-size:28px;margin-bottom:12px;line-height:1;">${escapeHtml(point.icon)}</div>
      <div style="font-size:16px;font-weight:700;color:${colors.text};margin-bottom:8px;">${escapeHtml(point.title)}</div>
      <div style="font-size:14px;color:${colors.textSub};line-height:1.6;">${escapeHtml(point.description)}</div>
    </div>`
    )
    .join('\n');

  return `<div data-section-id="${escapeHtml(section.id)}" style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;gap:24px;">
    ${pointsHtml}
  </div>
</div>`;
}

// features 섹션: title + description 쌍, bgAlt 배경, 각 아이템 border-bottom
function renderFeatures(content: FeaturesContent, section: DetailSection, colors: PaletteColors): string {
  const imageHtml = renderAttachedImage(section);

  const itemsHtml = content.items
    .map(
      (item, index) => `<div style="padding:24px 0;border-bottom:${index < content.items.length - 1 ? `1px solid ${colors.border}` : 'none'};">
      <div style="font-size:18px;font-weight:700;color:${colors.text};margin-bottom:8px;">${escapeHtml(item.title)}</div>
      <div style="font-size:15px;color:${colors.textSub};line-height:1.7;">${escapeHtml(item.description)}</div>
    </div>`
    )
    .join('\n');

  return `<div data-section-id="${escapeHtml(section.id)}" style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  ${itemsHtml}
</div>`;
}

// stats 섹션: 숫자 48px bold accent색, 레이블 16px textSub, 수평 배치
function renderStats(content: StatsContent, section: DetailSection, colors: PaletteColors): string {
  const imageHtml = renderAttachedImage(section);

  const statsHtml = content.stats
    .map(
      (stat) => `<div style="text-align:center;flex:1;min-width:120px;padding:16px;">
      <div style="font-size:48px;font-weight:700;color:${colors.accent};line-height:1.1;margin-bottom:8px;">${escapeHtml(stat.value)}</div>
      <div style="font-size:16px;color:${colors.textSub};">${escapeHtml(stat.label)}</div>
    </div>`
    )
    .join('\n');

  return `<div data-section-id="${escapeHtml(section.id)}" style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0;">
    ${statsHtml}
  </div>
</div>`;
}

// spec_table 섹션: 2컬럼 테이블, label=bgAlt, value=cardBg, border=colors.border
function renderSpecTable(content: SpecTableContent, section: DetailSection, colors: PaletteColors): string {
  const imageHtml = renderAttachedImage(section);

  const rowsHtml = content.specs
    .map(
      (spec) => `<tr>
      <td style="padding:12px 16px;background-color:${colors.bgAlt};color:${colors.text};font-weight:600;font-size:14px;border:1px solid ${colors.border};width:35%;vertical-align:top;">${escapeHtml(spec.label)}</td>
      <td style="padding:12px 16px;background-color:${colors.cardBg};color:${colors.textSub};font-size:14px;border:1px solid ${colors.border};vertical-align:top;">${escapeHtml(spec.value)}</td>
    </tr>`
    )
    .join('\n');

  return `<div data-section-id="${escapeHtml(section.id)}" style="background-color:${colors.bg};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
    ${rowsHtml}
  </table>
</div>`;
}

// usage_steps 섹션: 번호 뱃지(원형, accent 배경, accentTextColor 텍스트) + 단계 설명, 수직 스택
function renderUsageSteps(content: UsageStepsContent, section: DetailSection, colors: PaletteColors): string {
  const imageHtml = renderAttachedImage(section);

  const stepsHtml = content.steps
    .map(
      (step, index) => `<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:24px;">
      <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background-color:${colors.accent};color:${colors.accentTextColor};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;line-height:36px;text-align:center;min-width:36px;">${index + 1}</div>
      <div style="font-size:16px;color:${colors.text};line-height:1.7;padding-top:6px;">${escapeHtml(step)}</div>
    </div>`
    )
    .join('\n');

  return `<div data-section-id="${escapeHtml(section.id)}" style="background-color:${colors.bgAlt};padding:60px 40px;box-sizing:border-box;">
  ${imageHtml}
  ${stepsHtml}
</div>`;
}

// warning 섹션: 배경 #FFF3CD, border-left 4px solid #FFC107, 각 항목 앞에 ⚠️ 접두
// 경고 섹션은 WCAG 가시성 보장을 위해 고정 색상 사용 (palette 색상 미적용)
function renderWarning(content: WarningContent, section: DetailSection): string {
  const itemsHtml = content.warnings
    .map(
      (warning) => `<div style="margin-bottom:12px;font-size:15px;color:#6B4F00;line-height:1.6;">⚠️ ${escapeHtml(warning)}</div>`
    )
    .join('\n');

  return `<div data-section-id="${escapeHtml(section.id)}" style="background-color:#FFF3CD;border-left:4px solid #FFC107;padding:32px 40px;box-sizing:border-box;">
  ${itemsHtml}
</div>`;
}

// cta 섹션: fullbleed, accent 배경, 중앙 정렬, 32px 이상 폰트
function renderCta(content: CtaContent, section: DetailSection, colors: PaletteColors): string {
  const imageHtml = renderAttachedImage(section);

  return `<div data-section-id="${escapeHtml(section.id)}" style="background-color:${colors.accent};padding:60px 40px;text-align:center;box-sizing:border-box;">
  ${imageHtml}
  <p style="font-size:36px;font-weight:700;color:${colors.accentTextColor};margin:0;line-height:1.4;">${escapeHtml(content.text)}</p>
</div>`;
}

// 단일 섹션 렌더링 — section.type 기반 discriminated union으로 타입 안전성 보장
export function renderSection(section: DetailSection, theme: DetailPageTheme): string {
  const colors = PALETTES[theme.palette];
  switch (section.type) {
    case 'hero':
      return renderHero(section.content as HeroContent, section, colors);
    case 'selling_points':
      return renderSellingPoints(section.content as SellingPointsContent, section, colors);
    case 'features':
      return renderFeatures(section.content as FeaturesContent, section, colors);
    case 'stats':
      return renderStats(section.content as StatsContent, section, colors);
    case 'spec_table':
      return renderSpecTable(section.content as SpecTableContent, section, colors);
    case 'usage_steps':
      return renderUsageSteps(section.content as UsageStepsContent, section, colors);
    case 'warning':
      return renderWarning(section.content as WarningContent, section);
    case 'cta':
      return renderCta(section.content as CtaContent, section, colors);
  }
}

// 전체 섹션 배열을 order 기준으로 정렬 후 HTML 문자열로 합산
export function renderAllSections(sections: DetailSection[], theme: DetailPageTheme): string {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => renderSection(s, theme))
    .join('\n');
}
