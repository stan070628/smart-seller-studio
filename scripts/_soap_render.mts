/**
 * soap_layout.json을 HTML로 렌더한다. 레이아웃 생성과 렌더를 분리해 둔다 —
 * 카피만 고쳐 다시 렌더할 때 비전 호출을 반복하지 않기 위해서다.
 *
 * 아직 만들지 않은 AI 슬롯은 회색 플레이스홀더 + promptHint로 표시한다.
 * 사용자 승인 전에는 AI 이미지를 만들지 않는다(2026-09-05 지시).
 *
 * 사용: npx --no-install tsx scripts/_soap_render.mts [--scale 1.8]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { renderAllSections } from '@/lib/detail-page/section-renderer';
import { validateProLayout } from '@/lib/detail-page/layout-validator';
import type { DetailSection, DetailPageTheme, AttachedImage } from '@/types/detail-page';

const SRC = '/Volumes/Mac_SSD/Seller/보테니컬 비누';
const OUT = '/Volumes/Mac_SSD/Seller/26.09월/보태니컬 비누 리뉴얼';

/** _soap_gen.mts의 FILES와 순서가 같아야 한다 — imageRef가 이 배열의 인덱스다. */
const FILES = [
  `${SRC}/thumb_v3/v3_A_square1500.jpg`,
  `${SRC}/IMG_3619.JPG`,
  `${SRC}/IMG_2912.JPG`,
];

const used: string[] = [];
const PH = (f: string) => `https://local.img/${encodeURIComponent(f)}`;
/** 검토본은 원본 해상도가 필요 없다 — 가로 1000px JPEG로 줄여 파일을 20MB대에서 2MB대로 낮춘다.
 *  채널 반영용 최종본을 만들 때는 --full로 원본을 그대로 쓴다. */
const FULL = process.argv.includes('--full');
async function inline(html: string): Promise<string> {
  let out = html;
  for (const f of used) {
    const buf = FULL
      ? readFileSync(f)
      : await sharp(f).resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    out = out.split(PH(f)).join('data:image/jpeg;base64,' + buf.toString('base64'));
  }
  return out;
}

const theme: DetailPageTheme = {
  palette: 'cream_cozy', primaryColor: '#7A5C10', accentColor: '#7A5C10',
  fontStyle: 'sans', imageLayout: 'composed', layoutMode: 'mobile',
};

type Slot = { slotType: string; promptHint?: string; beforeHint?: string; imageRef?: number };
type Sec = {
  type: 'claude_layout'; beat?: string; title: string; blocks: unknown[];
  bgStyle?: 'white' | 'light' | 'dark' | 'primary'; padding?: 'normal' | 'compact' | 'wide';
  imageSlots?: Slot[];
};

const layout = JSON.parse(readFileSync(path.join(OUT, 'soap_layout.json'), 'utf8')) as Sec[];
const v = validateProLayout(layout);
console.log(`검증: 섹션 ${layout.length}개 · isClean=${v.isClean} · 위반 ${v.violations.length}건`);
for (const x of v.violations) console.log(`  [${x.severity}] ${x.code} — ${x.message.slice(0, 100)}`);

/** 아직 못 만든 AI 슬롯 — 무엇이 들어갈 자리인지 보이게 표시한다. */
const pending: Array<{ sec: number; slot: Slot }> = [];
function placeholderDataUri(label: string, hint: string): string {
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
  const lines: string[] = [];
  let cur = '';
  for (const w of hint.split(' ')) {
    if ((cur + ' ' + w).trim().length > 34) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  const body = lines.slice(0, 6).map((l, i) => `<text x="320" y="${230 + i * 26}" font-size="15" fill="#8a8a8a" text-anchor="middle">${esc(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="440"><rect width="640" height="440" fill="#eceae6"/><rect x="8" y="8" width="624" height="424" fill="none" stroke="#c9c5bd" stroke-width="2" stroke-dasharray="10 8"/><text x="320" y="180" font-size="22" font-weight="700" fill="#6b6b6b" text-anchor="middle">${esc(label)}</text>${body}</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

const sections: DetailSection[] = layout.map((s, i) => {
  const imgs: AttachedImage[] = (s.imageSlots ?? []).map((slot, order) => {
    if (typeof slot.imageRef === 'number' && FILES[slot.imageRef]) {
      const f = FILES[slot.imageRef]!;
      if (!used.includes(f)) used.push(f);
      return { url: PH(f), order, processingMode: 'bg_removed' as const };
    }
    pending.push({ sec: i, slot });
    return {
      url: placeholderDataUri(`AI 생성 예정 · ${slot.slotType}`, slot.promptHint ?? ''),
      order, processingMode: 'bg_removed' as const,
    };
  });
  return {
    id: `s${i}`, type: 'claude_layout' as const,
    content: {
      type: 'claude_layout' as const, title: s.title, blocks: s.blocks as never,
      bgStyle: s.bgStyle ?? 'white', padding: s.padding ?? 'normal',
    },
    attachedImages: imgs,
    eyebrow: (s.beat ?? '').toUpperCase(),
  };
});

let body = renderAllSections(sections, theme, 'export');

/** 모바일 가독성 — 780px 캔버스가 390px에서 절반이 되므로 font-size만 키운다.
 *  레이아웃·패딩은 건드리지 않는다([[채널별 상세 HTML 주입]]). */
const scaleArg = process.argv.indexOf('--scale');
const SCALE = scaleArg > -1 ? Number(process.argv[scaleArg + 1]) : 1.8;
if (SCALE !== 1) {
  body = body
    .replace(/font-size:(\d+(?:\.\d+)?)px/g, (_m, n) => `font-size:${Math.round(Number(n) * SCALE)}px`)
    .replace(/font-size:clamp\((\d+(?:\.\d+)?)px,([^,]+),(\d+(?:\.\d+)?)px\)/g,
      (_m, a, mid, b) => `font-size:clamp(${Math.round(Number(a) * SCALE)}px,${mid},${Math.round(Number(b) * SCALE)}px)`);
}

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>보태니컬 비누 4개입 선물세트</title>
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;background:#f0f0f0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
.page{max-width:780px;margin:0 auto;background:#fff;overflow:hidden}</style></head>
<body><div class="page">${await inline(body)}</div></body></html>`;

const outName = process.argv.includes('--legacy') ? 'soap_v1_현행렌더러.html' : 'soap_v2_개선렌더러.html';
writeFileSync(path.join(OUT, outName), html);
console.log(`\n저장: ${path.join(OUT, outName)} · ${(html.length / 1024 / 1024).toFixed(2)}MB · 실물 ${used.length}장 · 폰트 ${SCALE}배`);
if (pending.length) {
  console.log(`\n🔴 승인 후 만들 AI 이미지 ${pending.length}건:`);
  for (const p of pending) console.log(`  [섹션 ${p.sec}] ${p.slot.slotType} :: ${(p.slot.promptHint ?? '').slice(0, 90)}`);
}
