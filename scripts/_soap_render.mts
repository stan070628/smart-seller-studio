/**
 * soap_layout.json을 HTML로 렌더한다. 레이아웃 생성과 렌더를 분리해 둔다 —
 * 카피만 고쳐 다시 렌더할 때 비전 호출을 반복하지 않기 위해서다.
 *
 * 아직 만들지 않은 AI 슬롯은 회색 플레이스홀더 + promptHint로 표시한다.
 * 사용자 승인 전에는 AI 이미지를 만들지 않는다(2026-09-05 지시).
 *
 * 사용: npx --no-install tsx scripts/_soap_render.mts [--scale 1.8]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { renderAllSections } from '@/lib/detail-page/section-renderer';
import { validateProLayout } from '@/lib/detail-page/layout-validator';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
import type { DetailSection, DetailPageTheme, AttachedImage } from '@/types/detail-page';

const SRC = '/Volumes/Mac_SSD/Seller/보테니컬 비누';
const OUT = '/Volumes/Mac_SSD/Seller/26.09월/보태니컬 비누 리뉴얼';

/** _soap_gen.mts의 FILES와 순서가 같아야 한다 — imageRef가 이 배열의 인덱스다. */
const FILES = [
  // 0 = 히어로. 실물 정면컷은 "사고 싶은 마음이 안 든다"는 판정을 받아 AI 연출본(린넨)으로 교체했다.
  `${OUT}/ai_이미지/heroB.jpg`,
  `${SRC}/IMG_3619.JPG`,
  `${SRC}/IMG_2912.JPG`,
  // 3 = 각인 매크로. 같은 밀봉컷이 세 섹션에 반복되던 것을 크롭으로 갈랐다.
  `${OUT}/ai_이미지/detail_engraving.jpg`,
  // 4 = 선물 건네는 장면. 손 클로즈업 하이앵글 판본(얼굴 없음, 따뜻한 자연광).
  `${OUT}/ai_이미지/gift_pick_B.jpg`,
  // 5 = 거품 사용컷(굴다). 세면볼 앞에서 씻는 위치로 교정한 판본.
  `${OUT}/ai_이미지/lather_v6.jpg`,
  // 6~9 = 향 4종 연출컷. 실촬영본을 참조로 통짜 생성했고 각인은 확대 검수로 확인했다.
  //        순서는 option_grid 카드 순서(고트밀크·피치스앤크림·릴리필리·허니앤밀크)와 같아야 한다.
  `${OUT}/ai_이미지/scent_1_고트밀크.jpg`,
  `${OUT}/ai_이미지/scent_2_피치스앤크림.jpg`,
  `${OUT}/ai_이미지/scent_3_릴리필리.jpg`,
  `${OUT}/ai_이미지/scent_4_허니앤밀크.jpg`,
  // 10 = 200g 섹션 스튜디오 컷. 겹쳐 놓아 두께가 드러나게 한 판본.
  `${OUT}/ai_이미지/evidence_stack_v2.jpg`,
  // 11 = 낱개 밀봉 4종 연출컷. 은박 배경 실물컷을 대체한다(비닐은 소구점이라 반드시 유지).
  `${OUT}/ai_이미지/sealed_bars.jpg`,
];

/** 승인용으로 생성한 AI 이미지 — slotType으로 붙인다(imageRef가 없는 슬롯). */
const AI = `${OUT}/ai_이미지`;
const AI_BY_SLOT: Record<string, string> = {
  // imageRef가 없는 슬롯만 여기서 붙인다. 인물 컷들은 FILES 인덱스로 지정한다.
  compare_pair: `${AI}/compare_pair.jpg`,
};

const used: string[] = [];
const PH = (f: string) => `https://local.img/${encodeURIComponent(f)}`;
/** 검토본은 원본 해상도가 필요 없다 — 가로 1000px JPEG로 줄여 파일을 20MB대에서 2MB대로 낮춘다.
 *  채널 반영용 최종본을 만들 때는 --full로 원본을 그대로 쓴다. */
const FULL = process.argv.includes('--full');
/** --urls: base64 대신 네이버에 올린 공개 URL로 치환한다(채널 반영본).
 *  마켓플레이스는 외부 URL을 요구하므로 인라인 base64로는 올릴 수 없다. */
const URL_MAP: Record<string, string> | null = process.argv.includes('--urls')
  ? JSON.parse(readFileSync('/tmp/soap_img_urls.json', 'utf8'))
  : null;
async function inline(html: string): Promise<string> {
  if (URL_MAP) {
    let out = html;
    for (const [key, f] of Object.entries({ ...Object.fromEntries(FILES.map((p, i) => [String(i), p])), compare: AI_BY_SLOT.compare_pair })) {
      const url = URL_MAP[key];
      if (url && used.includes(f)) out = out.split(PH(f)).join(url);
    }
    // 🔴 네이버·쿠팡은 상세 HTML의 인라인 <svg>를 렌더하지 않고 소스 코드로 노출한다
    //    (2026-09-05 스마트스토어 실측). 채널 반영본에서는 아이콘을 이미지 태그로 바꾼다.
    const iconUrls: Record<string, string> = existsSync('/tmp/soap_icon_urls.json')
      ? JSON.parse(readFileSync('/tmp/soap_icon_urls.json', 'utf8')) : {};
    const iconKeys = Object.keys(iconUrls);
    if (iconKeys.length) {
      let idx = 0;
      out = out.replace(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*?<\/svg>/g, () => {
        const url = iconUrls[iconKeys[idx % iconKeys.length]!]!;
        idx += 1;
        return `<img src="${url}" width="26" height="26" alt="" style="display:block;width:26px;height:26px;" />`;
      });
      console.log(`아이콘 ${idx}개를 이미지 태그로 치환(인라인 SVG는 마켓에서 소스로 노출된다)`);
    }
    const left = out.match(/https:\/\/local\.img\/[^"']+/g);
    if (left) { console.error('🔴 URL 미치환:', [...new Set(left)].map((u) => decodeURIComponent(u).split('/').pop()).join(', ')); process.exit(1); }
    return out;
  }
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
    const aiFile = AI_BY_SLOT[slot.slotType];
    if (aiFile && existsSync(aiFile)) {
      if (!used.includes(aiFile)) used.push(aiFile);
      return { url: PH(aiFile), order, processingMode: 'bg_removed' as const };
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

// 🔴 주문/배송·반품/CS·개인정보 고지 3종. 렌더 라우트가 항상 붙이는 것이라
//    스크립트 경로에서도 반드시 넣는다(빠뜨리면 채널 반영본에 고지가 없다).
body = appendPrivacyFooter(body, theme.layoutMode);

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>보태니컬 비누 4개입 선물세트</title>
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;background:#f0f0f0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
.page{max-width:780px;margin:0 auto;background:#fff;overflow:hidden}</style></head>
<body><div class="page">${await inline(body)}</div></body></html>`;

const outName = URL_MAP ? 'soap_channel.html' : (process.argv.includes('--legacy') ? 'soap_v1_현행렌더러.html' : 'soap_v2_개선렌더러.html');
writeFileSync(path.join(OUT, outName), html);
console.log(`\n저장: ${path.join(OUT, outName)} · ${(html.length / 1024 / 1024).toFixed(2)}MB · 실물 ${used.length}장 · 폰트 ${SCALE}배`);
if (pending.length) {
  console.log(`\n🔴 승인 후 만들 AI 이미지 ${pending.length}건:`);
  for (const p of pending) console.log(`  [섹션 ${p.sec}] ${p.slot.slotType} :: ${(p.slot.promptHint ?? '').slice(0, 90)}`);
}
