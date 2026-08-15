'use client';

/**
 * Detail Builder — 완성된 이미지를 섹션에 꽂아 상세페이지 HTML을 만드는 화면.
 *
 * 왜 별도 메뉴인가:
 * detail-maker-pro의 2단계는 업로드한 사진을 generate-scene-image로 "AI 변환"한다
 * (배경 생성 + 누끼 합성). 그런데 이미 완성된 AI 이미지를 넣으면 그 변환이
 * 결과물을 망가뜨린다 — 실측: 착용컷 배경을 교체하려다 자수가 탈색됐고,
 * 색상 변환본은 없던 스티치가 생겼다.
 *
 * 그래서 이 화면은 AI 변환 경로를 통째로 건너뛴다. 이미지는 업로드해서 URL만
 * 얻고(=/api/image/upload-ai), 픽셀은 손대지 않는다. 사용자가 섹션에 꽂은
 * 순서와 위치가 그대로 최종 HTML이 된다.
 */

import { useState, useRef, useEffect } from 'react';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';

interface Shot { url: string; name: string }
interface SectionDef {
  key: string;
  title: string;      // 상세페이지에 노출되는 제목
  desc: string;       // 기본 설명 문구(수정 가능)
  max: number;        // 이미지 슬롯 수
  hint: string;       // 어떤 컷을 넣어야 하는지 안내
}

interface Preset {
  label: string;
  namePlaceholder: string;
  sections: SectionDef[];
  specs: string;
  notice: string;
  /** 특정 섹션에 배지로 붙는 한 줄(의류의 착용 정보 등). 없으면 입력란을 숨긴다. */
  badge?: { label: string; section: string; value: string };
  /** 섹션 이미지 아래에 붙는 각주. */
  footnotes?: Record<string, string>;
}

/** 이미지가 없는 섹션은 렌더에서 자동 제외된다. */
const PRESETS: Record<string, Preset> = {
  apparel: {
    label: '의류',
    namePlaceholder: '예일 YALE 남녀공용 오버핏 후드티',
    sections: [
      { key: 'hero',    title: '',                    desc: '',                                                          max: 1, hint: '대표컷 — 제품이 프레임을 가득 채운 컷' },
      { key: 'model',   title: '넉넉하게 떨어지는 오버핏', desc: '어깨가 자연스럽게 내려앉는 유니섹스 루즈핏입니다.',                    max: 3, hint: '모델 착용 — 정면 / 측면 / 뒷면' },
      { key: 'color',   title: '3가지 색상',            desc: '색상마다 자수 배색이 다릅니다.',                                  max: 6, hint: '색상별 컷 — 그레이 / 네이비 / 아이보리' },
      { key: 'emblem',  title: '투톤 아치 아플리케 자수',  desc: '프린트가 아닙니다. 원단을 덧대고 테두리를 박아 넣은 자수라 세탁해도 갈라지지 않습니다.', max: 2, hint: '자수 클로즈업 — 실물 촬영본 권장' },
      { key: 'detail',  title: '디테일',               desc: '후드 스트링과 캥거루 포켓, 시보리 마감입니다.',                        max: 3, hint: '후드 / 포켓 / 시보리' },
      { key: 'back',    title: '깔끔한 뒷면',           desc: '등판에는 로고 없이 무지로 떨어집니다.',                             max: 2, hint: '제품 뒷면 / 착용 뒷모습' },
      { key: 'fabric',  title: '원단',                 desc: '',                                                          max: 2, hint: '원단 매크로 / 조직 클로즈업' },
      { key: 'proof',   title: '정품 표시사항',          desc: '국내 정식 수입품으로 한글 표시사항이 부착되어 있습니다.',                 max: 3, hint: '행택 / 케어라벨' },
    ],
    specs: '소재\t면 55% · 폴리에스터 45%\n핏\t유니섹스 루즈핏 (오버핏)\n색상\t멜란지그레이 · 네이비 · 아이보리\n사이즈\tS(90) · M(95) · L(100) · XL(105)',
    notice: '· 제품 사진은 촬영 환경과 모니터 설정에 따라 실제 색상과 다소 차이가 있을 수 있습니다.\n· 사이즈는 측정 방법에 따라 1~3cm 오차가 있을 수 있습니다.',
    badge: { label: '착용 정보 (모델 섹션에 배지로 표시)', section: 'model', value: '키 174cm · 74kg · L(100) 착용' },
    footnotes: { color: '※ 색상은 촬영 환경과 모니터에 따라 실제와 차이가 있을 수 있습니다.' },
  },

  /**
   * 키즈 의류 2매 세트(2PK). 의류 프리셋과 가르는 지점은 두 가지다.
   * ① 한 상품에 색이 다른 두 벌이 들어가므로 'bundle' 섹션에서 구성을 먼저 못 박는다
   *    — 쿠팡 번들 정책상 상세설명에 구성품 명시가 필요하고, 사지 않은 색이 왔다는
   *    클레임도 여기서 막힌다.
   * ② 사이즈를 cm가 아니라 호칭(130~160)과 연령으로 읽는다. 코스트코 가격표 표기를
   *    그대로 옮긴다 — 부모가 아이 나이로 고르기 때문이다.
   */
  kids2pk: {
    label: '키즈 의류 · 2매 세트',
    namePlaceholder: '마크곤잘레스 키즈 긴팔 티셔츠 2매 세트 130-160',
    sections: [
      { key: 'bundle',   title: '한 세트에 두 벌, 색이 다릅니다', desc: '같은 디자인을 색만 다르게 두 벌 담았습니다. 두 세트 중 하나를 고르시면 됩니다.', max: 2, hint: '🔴 구성컷 — 세트별 1+1 컷 (번들 정책상 필수)' },
      { key: 'option',   title: '세트 구성',                    desc: '',                                                                      max: 4, hint: '세트별 개별 제품컷 — 옵션1 2장 / 옵션2 2장' },
      { key: 'emblem',   title: '가슴에 놓인 갈매기 자수',        desc: '프린트가 아니라 자수입니다. 실로 박아 넣어 세탁해도 갈라지거나 벗겨지지 않습니다.', max: 4, hint: '앞가슴 자수 클로즈업 — 색상별' },
      { key: 'backlogo', title: '등에는 시그니처 레터링',         desc: '스트라이프에는 옐로우 레터링이 크게, 무지에는 목 아래 작게 들어갑니다.',              max: 3, hint: '뒷면 전체 / 등판 자수 클로즈업' },
      { key: 'detail',   title: '밑단 옐로우 라벨과 옆트임',       desc: '밑단 옆선이 트여 있어 아이가 움직일 때 당기지 않습니다. 브랜드 라벨이 함께 달립니다.',   max: 3, hint: '밑단 라벨 · 옆트임 — 색상별' },
      { key: 'fabric',   title: '탄탄한 20수 면 100%',           desc: '얇아서 비치는 원단이 아닙니다. 20수 면 100%라 조직이 촘촘하고 여러 번 빨아도 늘어짐이 적습니다.', max: 2, hint: '원단 매크로 — 조직이 보이는 배율' },
      { key: 'size',     title: '사이즈는 아이 나이로 고르세요',   desc: '130 · 9~10세 / 140 · 10~11세 / 150 · 12~13세 / 160 · 13~14세',           max: 2, hint: '사이즈 표 · 실측 컷 (없으면 비워둠)' },
      { key: 'proof',    title: '정품 표시사항',                  desc: '어린이제품 안전 특별법에 따른 한글 표시사항이 부착되어 있습니다.',                  max: 3, hint: '케어라벨 / 품질표시 택' },
    ],
    specs: '소재\t겉감 면(COTTON) 100% — 탄탄한 20수\n구성\t2매 1세트 (색상 2종)\n사이즈\t130(9~10세) · 140(10~11세) · 150(12~13세) · 160(13~14세)\n소매\t긴팔\n품번\t692875\n제조국\t중국\n제조년월\t2026.03',
    notice: '· 제품 사진은 촬영 환경과 모니터 설정에 따라 실제 색상과 다소 차이가 있을 수 있습니다.\n· 사이즈는 측정 방법에 따라 1~3cm 오차가 있을 수 있습니다.\n· 첫 세탁은 단독으로 해주시고, 표백제와 건조기 사용은 피해주세요.\n· 섬유의 조성 및 혼용률에서 심지·상표·보강재·자수·장식은 제외됩니다.',
    badge: { label: '사이즈 배지 (구성 섹션에 표시)', section: 'bundle', value: '130 ~ 160 · 9~14세' },
    footnotes: {
      option: '※ 한 세트에 위 두 벌이 모두 들어 있습니다. 낱장 판매가 아닙니다.',
      size: '※ 사이즈 호칭과 연령은 제조사 표기 기준입니다. 아이 체형에 따라 차이가 있을 수 있습니다.',
    },
  },

  /**
   * 화장품 + 사은품 번들. 쿠팡 번들 정책 4.3이 상세설명에 구성품 명시를 요구하므로
   * 'bundle' 섹션은 비우지 않는다.
   */
  handwash: {
    label: '화장품 · 사은품 번들',
    namePlaceholder: '오스트레일리안 보태니컬 핸드워시 750ml + 여행용 소분 파우치 50ml',
    sections: [
      { key: 'hero',       title: '',                                 desc: '',                                                                                                          max: 1, hint: '대표컷 — 본품과 사은품이 함께 보이는 컷' },
      { key: 'origin',     title: '호주에서 만들어 그대로 들여왔습니다',    desc: 'AUSTRALIAN MADE AND OWNED 인증을 받은 호주 생산 제품입니다. 레몬그라스 에센셜 오일과 호주 레몬머틀 오일의 산뜻한 향이 남습니다.', max: 2, hint: '생활 장면 — 제품이 놓인 컷 (욕실 등)' },
      { key: 'ingredient', title: '호주 자생 식물 카카두플럼',            desc: '호주에서 자라는 카카두플럼 열매 추출물과 알로에베라잎즙, 보습 성분 글리세린을 담았습니다. 용기는 재활용 플라스틱 50%로 만들었습니다.', max: 2, hint: '양각 문구 · 용기 질감 클로즈업' },
      { key: 'bundle',     title: '본품 750mL + 여행용 소분 파우치 50mL', desc: '750mL 대용량은 욕실에 두고 쓰는 크기입니다. 덜어서 들고 다닐 수 있도록 소분 파우치를 함께 드립니다.',                                max: 2, hint: '🔴 구성컷 — 본품과 파우치를 나란히 (번들 정책상 필수)' },
      { key: 'travel',     title: '덜어서 어디든',                       desc: '소분 파우치 50mL는 기내 액체 반입 기준(용기당 100mL 이하) 이내입니다. 여행·헬스장·사무실에 파우치만 들고 나가세요.',              max: 2, hint: '여행 장면 — 들고 나가는 맥락' },
      { key: 'usage',      title: '원터치로 여닫습니다',                  desc: '스파우트 캡이라 한 손으로 열리고, 세척 후 다시 쓸 수 있습니다.',                                                        max: 2, hint: '캡 개폐 구조 — 주입구가 보이는 컷' },
      { key: 'shipping',   title: '에어캡으로 완충 포장해 발송합니다',      desc: '펌프 용기가 배송 중 눌리지 않도록 에어캡으로 감싸 포장합니다.',                                                          max: 2, hint: '에어캡 포장 상태' },
    ],
    specs: '용량\t750mL (+ 소분 파우치 50mL)\n향\t레몬그라스 & 레몬머틀\n용기 타입\t펌프형 디스펜서\n용기 소재\t재활용 플라스틱 50% (HDPE)\n제조국\t호주\n제조원\t콜바 큐에스알 피티와이 엘티디\n책임판매업자\t(주)코스트코 코리아\n사용기한\t제조일로부터 36개월\n구성\t본품 1개 + 소분 파우치 1개',
    notice: '· 소분 파우치는 내용물이 들어 있지 않은 빈 용기입니다.\n· 연출에 사용된 소품은 구성품에 포함되지 않습니다.\n· 제품 사진은 촬영 환경과 모니터 설정에 따라 실제 색상과 다소 차이가 있을 수 있습니다.\n· 사용 시 또는 사용 후 이상 증상이나 부작용이 있는 경우 전문의 등과 상담하세요.\n· 상처가 있는 부위에는 사용을 자제하고, 눈에 들어갔을 때에는 즉시 씻어내세요.\n· 어린이의 손이 닿지 않는 곳에 보관하고 직사광선을 피해 보관하세요.',
    footnotes: {
      bundle: '※ 소분 파우치는 사은품이며 내용물이 들어 있지 않은 빈 용기입니다.',
      travel: '※ 연출에 사용된 소품은 구성품에 포함되지 않습니다.',
    },
  },
};

const PRESET_KEYS = Object.keys(PRESETS);

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 7, border: '1px solid #33334a',
  background: '#1a1a26', color: '#e8e8f0', fontSize: 13, outline: 'none',
};
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#a0a0b0', display: 'block', marginBottom: 6 };
const card: React.CSSProperties = { background: '#14141d', border: '1px solid #2a2a3a', borderRadius: 11, padding: 16 };

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file);
  });
  return { base64: url.replace(/^data:[^;]+;base64,/, ''), mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg' };
}

export default function DetailBuilderPage() {
  const [presetKey, setPresetKey] = useState<string>('handwash');
  const preset = PRESETS[presetKey];
  const SECTIONS = preset.sections;

  const [productName, setProductName] = useState('');
  const [specs, setSpecs] = useState(PRESETS.handwash.specs);
  const [wearInfo, setWearInfo] = useState(PRESETS.handwash.badge?.value ?? '');
  const [notice, setNotice] = useState(PRESETS.handwash.notice);
  const [titles, setTitles] = useState<Record<string, string>>(() => Object.fromEntries(PRESETS.handwash.sections.map(s => [s.key, s.title])));
  const [descs, setDescs] = useState<Record<string, string>>(() => Object.fromEntries(PRESETS.handwash.sections.map(s => [s.key, s.desc])));
  const [shots, setShots] = useState<Record<string, Shot[]>>(() => Object.fromEntries(PRESETS.handwash.sections.map(s => [s.key, [] as Shot[]])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** 직전 생성 결과. Pro 템플릿은 돌릴 때마다 레이아웃이 달라져 마음에 든 결과를 잃기 쉽다. */
  const [prevHtml, setPrevHtml] = useState<string | null>(null);
  /** 사진이 몇 장 중 몇 장 배치됐는지. 조용히 밀린 사진을 셀러가 알아채게 한다. */
  const [placement, setPlacement] = useState<{ placed: number; total: number; notes: string[]; hints: string[] } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  /**
   * 입력값을 localStorage에 담아둔다.
   * dev의 Fast Refresh나 실수로 새로고침하면 꽂아둔 이미지가 통째로 날아가는데,
   * 이미 업로드된 URL이라 다시 올릴 필요 없이 그대로 복원하면 된다.
   */
  const STORE_KEY = 'detail-builder-state-v1';
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Record<string, unknown>;
        const pk = typeof s.presetKey === 'string' && PRESETS[s.presetKey] ? s.presetKey : presetKey;
        const keys = new Set(PRESETS[pk].sections.map(x => x.key));
        const pick = (v: unknown) =>
          v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => keys.has(k)))
            : null;
        setPresetKey(pk);
        if (typeof s.productName === 'string') setProductName(s.productName);
        if (typeof s.specs === 'string') setSpecs(s.specs);
        if (typeof s.wearInfo === 'string') setWearInfo(s.wearInfo);
        if (typeof s.notice === 'string') setNotice(s.notice);
        const T = pick(s.titles), D = pick(s.descs), S = pick(s.shots);
        if (T) setTitles(p => ({ ...p, ...(T as Record<string, string>) }));
        if (D) setDescs(p => ({ ...p, ...(D as Record<string, string>) }));
        if (S) setShots(p => ({ ...p, ...(S as Record<string, Shot[]>) }));
      }
    } catch { /* 저장본이 깨졌으면 무시하고 기본값으로 간다 */ }
    setRestored(true);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!restored) return;   // 복원 전에 저장하면 기본값이 덮어쓴다
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        presetKey, productName, specs, wearInfo, notice, titles, descs, shots,
      }));
    } catch { /* 용량 초과 등은 무시 — 저장 실패가 작업을 막으면 안 된다 */ }
  }, [restored, presetKey, productName, specs, wearInfo, notice, titles, descs, shots]);

  /** 프리셋을 바꾸면 섹션 구성이 통째로 달라지므로 입력값을 그 프리셋 기본값으로 되돌린다. */
  function applyPreset(key: string) {
    const p = PRESETS[key];
    if (!p) return;
    setPresetKey(key);
    setSpecs(p.specs);
    setNotice(p.notice);
    setWearInfo(p.badge?.value ?? '');
    setTitles(Object.fromEntries(p.sections.map(s => [s.key, s.title])));
    setDescs(Object.fromEntries(p.sections.map(s => [s.key, s.desc])));
    setShots(Object.fromEntries(p.sections.map(s => [s.key, [] as Shot[]])));
    setHtml(null);
    setError(null);
  }
  async function addFiles(key: string, files: FileList | null) {
    if (!files?.length) return;
    const room = (SECTIONS.find(s => s.key === key)?.max ?? 1) - shots[key].length;
    if (room <= 0) { setError('이 섹션의 슬롯이 가득 찼습니다.'); return; }
    setBusy(key); setError(null);
    try {
      const picked = Array.from(files).slice(0, room);
      const added: Shot[] = [];
      for (const f of picked) {
        const { base64, mimeType } = await fileToBase64(f);
        // 픽셀은 건드리지 않는다 — 업로드해서 URL만 얻는다.
        const res = await fetch('/api/image/upload-ai', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mimeType }),
        });
        const j = (await res.json()) as { success: boolean; url?: string; error?: string };
        if (!j.success || !j.url) throw new Error(j.error ?? '업로드 실패');
        added.push({ url: j.url, name: f.name });
      }
      setShots(p => ({ ...p, [key]: [...p[key], ...added] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '업로드 중 오류');
    } finally { setBusy(null); }
  }

  function build() {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const P = [`<div style="max-width:780px;margin:0 auto;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#222;line-height:1.7">`];

    if (productName.trim()) {
      P.push(`<div style="text-align:center;padding:34px 20px 26px"><div style="font-size:25px;font-weight:800;color:#111">${esc(productName.trim())}</div></div>`);
    }

    for (const s of SECTIONS) {
      const imgs = shots[s.key];
      if (!imgs.length) continue;                       // 이미지 없는 섹션은 통째로 생략
      const t = (titles[s.key] ?? '').trim();
      const d = (descs[s.key] ?? '').trim();
      if (t || d) {
        P.push(`<div style="padding:42px 24px 15px">`);
        if (t) P.push(`<div style="font-size:21px;font-weight:800;color:#111">${esc(t)}</div>`);
        if (d) P.push(`<div style="font-size:15px;color:#666;margin-top:8px">${esc(d)}</div>`);
        if (preset.badge?.section === s.key && wearInfo.trim())
          P.push(`<div style="display:inline-block;margin-top:13px;padding:7px 15px;background:#f2f3f5;border-radius:20px;font-size:14px;font-weight:700;color:#333">${esc(wearInfo.trim())}</div>`);
        P.push(`</div>`);
      }
      imgs.forEach((im, i) => P.push(`<img src="${im.url}" alt="${esc(productName || '상품 이미지')}" style="width:100%;display:block${i ? ';margin-top:6px' : ''}">`));

      const foot = preset.footnotes?.[s.key];
      if (foot) {
        P.push(`<div style="padding:13px 24px 0;font-size:13px;color:#999;line-height:1.8">${esc(foot)}</div>`);
      }
    }

    const rows = specs.split('\n').map(l => l.split('\t')).filter(c => c[0]?.trim());
    if (rows.length) {
      P.push(`<div style="padding:42px 24px 10px"><div style="font-size:21px;font-weight:800;color:#111;margin-bottom:16px">상품 정보</div><table style="width:100%;border-collapse:collapse;font-size:15px">`);
      rows.forEach((c, i) => P.push(`<tr><td style="padding:12px 0;${i < rows.length - 1 ? 'border-bottom:1px solid #eee;' : ''}color:#888;width:34%">${esc((c[0] ?? '').trim())}</td><td style="padding:12px 0;${i < rows.length - 1 ? 'border-bottom:1px solid #eee' : ''}">${esc((c[1] ?? '').trim())}</td></tr>`));
      P.push(`</table></div>`);
    }

    if (notice.trim()) {
      P.push(`<div style="padding:26px 24px 46px;background:#fafafa;font-size:13px;color:#777;line-height:1.9">${esc(notice.trim()).replace(/\n/g, '<br>')}</div>`);
    }
    P.push(`</div>`);
    // 고지 3종은 모든 상세페이지의 법적 요건이다. Pro 경로는 서버(render)가
    // 붙여주지만 이 자체 조립 경로에는 없어서 여기서 붙인다.
    setHtml(appendPrivacyFooter(P.join('\n')));
  }

  /**
   * Pro 템플릿 경로: generate-pro-layout(Claude가 섹션 DSL 작성) → detail-page/render(section-renderer).
   * 우리 이미지는 attachedImages에 processingMode:'original'로 꽂는다 — 'original'은 가공 없이
   * 그대로 쓰는 모드라 AI 변환을 거치지 않는다는 이 화면의 전제가 유지된다.
   */
  async function buildWithProTemplate() {
    const filled = SECTIONS.filter(s => shots[s.key].length > 0);
    if (!filled.length) { setError('이미지를 먼저 첨부하세요.'); return; }
    const shotTotal = filled.reduce((a, s) => a + shots[s.key].length, 0);
    setBusy('pro'); setError(null);
    if (html) setPrevHtml(html);   // 새 결과가 마음에 안 들면 돌아올 자리
    setPlacement(null);
    try {
      const points = [
        ...specs.split('\n').map(l => l.split('\t').filter(Boolean).join(' ')).filter(Boolean),
        ...filled.map(s => `${titles[s.key] || s.title} ${descs[s.key] || ''}`.trim()),
      ].filter(Boolean);

      /**
       * 사용자가 섹션에 꽂아둔 분류를 그대로 넘긴다. 이것이 배치의 정답지다.
       * 예전에는 productImageCount로 개수만(그것도 4로 깎아서) 보냈고, 그래서 Claude는
       * 사진 21장짜리 상품을 4장짜리로 알고 슬롯을 적게 만들었다 — 사진 9장이 본문 밖으로
       * 밀린 실사고의 원인이다.
       */
      const groupManifest = filled.map(s => ({
        key: s.key,
        title: titles[s.key] || s.title || s.hint,
        desc: descs[s.key] || s.desc || '',
        count: shots[s.key].length,
      }));
      const layoutRes = await fetch('/api/ai/generate-pro-layout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productInfo: { name: productName || '상품', points, category: '' },
          analyzedSections: [], groupManifest,
        }),
      });
      const lj = (await layoutRes.json()) as { success: boolean; sections?: unknown[]; warnings?: string[]; error?: string };
      if (!lj.success || !lj.sections?.length) {
        throw new Error(`레이아웃 생성 실패 (HTTP ${layoutRes.status}) ${lj.error ?? JSON.stringify(lj).slice(0, 300)}`);
      }

      /**
       * generate-pro-layout이 돌려주는 원소는 ClaudeLayoutContent 그 자체다
       * ({ type:'claude_layout', beat, title, blocks, imageSlots, bgStyle }).
       * 반면 /api/detail-page/render 는 DetailSection을 받는다
       * ({ id, type, order, content, attachedImages }).
       * 그래서 Claude 객체를 통째로 content에 넣어야 한다. 최상위에 펼치면
       * zod는 통과해도 renderer가 읽을 content가 비어 본문이 통째로 사라진다.
       *
       * 이미지는 섹션이 선언한 imageSlots 개수만큼 배분한다.
       * blocks의 image 블록이 attachedIndex로 그 슬롯을 가리키므로 개수가
       * 어긋나면 이미지가 렌더되지 않는다.
       */
      const layoutSections = lj.sections as Record<string, unknown>[];
      /** render API의 스키마 상한. 넘겨 보내면 HTTP 400으로 통째로 실패한다. */
      const MAX_IMAGES_PER_SECTION = 6;

      /** 섹션별 이미지 큐 — 꺼내 쓴 만큼 줄어든다. 소진 여부가 곧 배치 여부다. */
      const queues = new Map(filled.map(s => [s.key, [...shots[s.key].map(x => x.url)]]));

      /**
       * 어느 Claude 섹션이 어느 묶음을 가져갈지는 Claude가 sourceGroup으로 지정한다.
       * 같은 묶음을 두 섹션이 지목하면 앞선 섹션이 갖는다 — 뒤쪽은 빈 채로 두고, 남은 사진은
       * 아래 미배정 처리에서 페이지 끝에 붙는다(사라지지 않는다).
       */
      const claimed = new Set<string>();
      const groupOf = (sec: Record<string, unknown>): string | null => {
        const g = sec.sourceGroup;
        if (typeof g !== 'string') return null;
        if (!queues.has(g) || claimed.has(g)) return null;
        claimed.add(g);
        return g;
      };

      const grid = (urls: string[]) => ({
        type: 'claude_layout',
        beat: 'detail',
        title: '',
        bgStyle: 'white',
        padding: 'normal',
        blocks: urls.map((_, o) => ({ type: 'image', attachedIndex: o })),
        imageSlots: urls.map(() => ({ slotType: 'product_nukki', promptHint: '', imageRef: 0 })),
      } as Record<string, unknown>);

      /**
       * 렌더러는 attachedImages를 직접 그리지 않고 blocks의 image 블록으로만 그린다.
       * normalizeImageBlocks는 image 블록이 0개일 때만 1개를 주입하므로, 사진 4장을 붙였는데
       * 블록이 1개면 3장이 소리 없이 사라진다. 붙인 장수만큼 블록을 채워 그 구멍을 막는다.
       *
       * option_grid 캐리어 섹션(카드마다 이미지를 그리는 구조)은 예외다 — 그쪽은 카드 수와
       * 첨부 수가 정확히 같아야 하고, 대형 image 블록을 넣으면 같은 사진이 두 번 나온다.
       */
      const countImageBlocks = (blocks: unknown): number => {
        if (!Array.isArray(blocks)) return 0;
        let n = 0;
        for (const b of blocks as Record<string, unknown>[]) {
          if (b?.type === 'image') n += 1;
          else if (b?.type === 'columns' && Array.isArray(b.cols)) {
            for (const col of b.cols as unknown[]) n += countImageBlocks(col);
          }
        }
        return n;
      };
      const isCarrier = (sec: Record<string, unknown>, n: number): boolean =>
        Array.isArray(sec.blocks) && (sec.blocks as Record<string, unknown>[]).some(
          b => b?.type === 'option_grid' && Array.isArray(b.items) && (b.items as unknown[]).length === n,
        );
      const fitBlocks = (sec: Record<string, unknown>, n: number): Record<string, unknown> => {
        if (n === 0 || isCarrier(sec, n)) return sec;
        const have = countImageBlocks(sec.blocks);
        if (have >= n) return sec;
        const add = Array.from({ length: n - have }, (_, i) => ({ type: 'image', attachedIndex: have + i }));
        return { ...sec, blocks: [...(Array.isArray(sec.blocks) ? sec.blocks : []), ...add] };
      };

      const sections: Array<Record<string, unknown>> = [];
      const push = (content: Record<string, unknown>, urls: string[]) => {
        sections.push({
          id: `sec-${sections.length + 1}`,
          type: 'claude_layout' as const,
          order: sections.length,
          content: fitBlocks(content, urls.length),
          attachedImages: urls.map((url, o) => ({ url, order: o, processingMode: 'original' as const })),
        });
      };

      /**
       * 배치는 Claude의 지시(sourceGroup)를 따르되, 사진이 사라지지 않는 것은 코드가 보장한다.
       * 한 묶음이 6장을 넘으면 바로 뒤에 그리드로 이어 붙인다 — 자수 4장이 본문과 떨어지지 않게.
       */
      layoutSections.forEach((sec) => {
        const key = groupOf(sec);
        const q = key ? queues.get(key) : undefined;
        push(sec, q ? q.splice(0, MAX_IMAGES_PER_SECTION) : []);
        while (q?.length) {
          const chunk = q.splice(0, MAX_IMAGES_PER_SECTION);
          push(grid(chunk), chunk);
        }
      });

      /**
       * 어느 섹션도 가져가지 않은 묶음은 버리지 않고 맨 뒤에 붙인다. 서버가 warnings로
       * 알려주지만, 알림과 무관하게 사진이 사라지지 않는 것은 여기서 보장한다.
       */
      const orphanGroups = filled.filter(s => (queues.get(s.key)?.length ?? 0) > 0);
      for (const s of orphanGroups) {
        const q = queues.get(s.key) ?? [];
        while (q.length) {
          const chunk = q.splice(0, MAX_IMAGES_PER_SECTION);
          push(grid(chunk), chunk);
        }
      }

      /**
       * render 스키마의 섹션 상한. 넘기면 HTTP 400으로 통째로 실패하므로, 자르는 대신
       * 알린다 — 조용히 버리면 오늘처럼 사진이 사라진 걸 아무도 모른다.
       */
      const MAX_SECTIONS = 20;
      const dropped = sections.length > MAX_SECTIONS ? sections.length - MAX_SECTIONS : 0;
      if (dropped > 0) sections.length = MAX_SECTIONS;

      const placedCount = sections.reduce(
        (a, s) => a + ((s.attachedImages as unknown[] | undefined)?.length ?? 0), 0,
      );
      // 배치 결함과 그 밖의 조언을 가른다 — 스펙 표 권유 같은 일반 경고까지 ⚠️로 띄우면
      // 정작 사진이 밀렸을 때의 경고가 묻힌다.
      const problems = [
        ...(orphanGroups.length > 0
          ? [`${orphanGroups.map(s => `${titles[s.key] || s.title}(${shots[s.key].length}장)`).join(', ')}은 본문에 자리를 못 잡아 페이지 끝에 붙었습니다.`]
          : []),
        ...(dropped > 0 ? [`섹션이 ${MAX_SECTIONS}개를 넘어 뒤쪽 ${dropped}개가 잘렸습니다.`] : []),
      ];
      setPlacement({
        placed: placedCount,
        total: shotTotal,
        notes: problems,
        hints: lj.warnings ?? [],
      });

      const renderRes = await fetch('/api/detail-page/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections,
          theme: {
            palette: 'cool_white', primaryColor: '#1B2A4A', accentColor: '#5B6EF5',
            fontStyle: 'sans', imageLayout: 'fullbleed', layoutMode: 'mobile',
          },
        }),
      });
      const rj = (await renderRes.json()) as { success?: boolean; html?: string; error?: string };
      if (!rj.html) throw new Error(`렌더링 실패 (HTTP ${renderRes.status}) ${rj.error ?? JSON.stringify(rj).slice(0, 300)}`);
      setHtml(rj.html);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pro 템플릿 생성 실패');
    } finally { setBusy(null); }
  }

  const total = Object.values(shots).reduce((a, b) => a + b.length, 0);

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d14', color: '#e8e8f0', padding: '30px 22px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <h1 style={{ fontSize: 21, fontWeight: 800, marginBottom: 5 }}>Detail Builder</h1>
        <p style={{ fontSize: 13, color: '#8a8a9a', marginBottom: 22 }}>
          완성된 이미지를 섹션에 꽂아 상세페이지를 만듭니다. <strong style={{ color: '#6ac68a' }}>AI 변환을 거치지 않아</strong> 이미지가 그대로 유지됩니다.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={label}>상품 유형 — 바꾸면 섹션 구성과 기본값이 전부 교체됩니다</label>
                <select value={presetKey} onChange={e => applyPreset(e.target.value)} style={inputStyle}>
                  {PRESET_KEYS.map(k => <option key={k} value={k}>{PRESETS[k].label}</option>)}
                </select></div>
              <div><label style={label}>상품명</label>
                <input value={productName} onChange={e => setProductName(e.target.value)} style={inputStyle} placeholder={preset.namePlaceholder} /></div>
              {preset.badge && (
                <div><label style={label}>{preset.badge.label}</label>
                  <input value={wearInfo} onChange={e => setWearInfo(e.target.value)} style={inputStyle} /></div>
              )}
              <div><label style={label}>상품 정보 표 — 한 줄에 하나, 항목과 값은 Tab으로 구분</label>
                <textarea value={specs} onChange={e => setSpecs(e.target.value)} rows={5} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace,monospace', fontSize: 12 }} /></div>
              <div><label style={label}>하단 고지</label>
                <textarea value={notice} onChange={e => setNotice(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', fontSize: 12 }} /></div>
            </div>

            {SECTIONS.map(s => (
              <div key={s.key} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#c8c8e0' }}>{s.hint}</div>
                  <div style={{ fontSize: 11, color: shots[s.key].length ? '#6ac68a' : '#5a5a6a' }}>{shots[s.key].length} / {s.max}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 9 }}>
                  <input value={titles[s.key]} onChange={e => setTitles(p => ({ ...p, [s.key]: e.target.value }))} style={{ ...inputStyle, fontSize: 12 }} placeholder="섹션 제목 (비우면 생략)" />
                  <input value={descs[s.key]} onChange={e => setDescs(p => ({ ...p, [s.key]: e.target.value }))} style={{ ...inputStyle, fontSize: 12 }} placeholder="설명 (비우면 생략)" />
                </div>
                <input ref={el => { inputs.current[s.key] = el; }} type="file" accept="image/*" multiple
                  onChange={e => { void addFiles(s.key, e.target.files); e.target.value = ''; }}
                  disabled={busy === s.key} style={{ ...inputStyle, padding: 7, fontSize: 11 }} />
                {busy === s.key && <div style={{ fontSize: 11, color: '#a0a0b0', marginTop: 6 }}>업로드 중…</div>}
                {shots[s.key].length > 0 && (
                  <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap' }}>
                    {shots[s.key].map((im, i) => (
                      <div key={i} style={{ position: 'relative' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={im.url} alt={im.name} style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 7, border: '1px solid #33334a' }} />
                        <button onClick={() => setShots(p => ({ ...p, [s.key]: p[s.key].filter((_, x) => x !== i) }))}
                          aria-label="제거"
                          style={{ position: 'absolute', top: -6, right: -6, width: 19, height: 19, borderRadius: '50%', border: 'none', background: '#e05c5c', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ position: 'sticky', top: 20, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={build} disabled={total === 0}
              style={{ padding: '13px 20px', borderRadius: 8, border: 'none', background: total ? '#5b6ef5' : '#33334a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: total ? 'pointer' : 'not-allowed' }}>
              상세페이지 HTML 생성 ({total}장)
            </button>
            <button onClick={() => void buildWithProTemplate()} disabled={total === 0 || busy === 'pro'}
              style={{ padding: '12px 20px', borderRadius: 8, border: '1px solid #374151', background: total && busy !== 'pro' ? '#1e1e2e' : '#22222c', color: '#a5b4fc', fontSize: 13, fontWeight: 700, cursor: total && busy !== 'pro' ? 'pointer' : 'not-allowed' }}>
              {busy === 'pro' ? 'Pro 템플릿 생성 중… (최대 3분)' : '🧩 Pro 템플릿으로 생성 (Claude 레이아웃)'}
            </button>
            {error && <div style={{ padding: '9px 11px', borderRadius: 7, background: '#2a1616', border: '1px solid #5c2626', color: '#f0a0a0', fontSize: 12 }}>{error}</div>}

            {/* 사진이 조용히 밀리는 것을 막는 계기판. 예전에는 9장이 본문 밖으로 나가도 아무 표시가 없었다. */}
            {placement && (
              <div style={{
                padding: '10px 12px', borderRadius: 7, fontSize: 12, lineHeight: 1.7,
                background: placement.notes.length ? '#2a2416' : '#16261a',
                border: `1px solid ${placement.notes.length ? '#5c4f26' : '#265c38'}`,
                color: placement.notes.length ? '#f0dda0' : '#a0f0b8',
              }}>
                <div style={{ fontWeight: 700 }}>
                  {placement.notes.length ? '⚠️' : '✅'} 사진 {placement.total}장 중 {placement.placed}장 배치
                </div>
                {placement.notes.map((n, i) => (
                  <div key={i} style={{ marginTop: 5, color: '#c8c0a0' }}>· {n}</div>
                ))}
                {placement.hints.map((n, i) => (
                  <div key={`h${i}`} style={{ marginTop: 5, color: '#8a8a9a' }}>· {n}</div>
                ))}
              </div>
            )}

            {prevHtml && prevHtml !== html && (
              <button onClick={() => { setHtml(prevHtml); setPrevHtml(null); setPlacement(null); }}
                style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #4a4a5e', background: '#1a1a26', color: '#b8b8c8', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                ↩ 직전 결과로 되돌리기
              </button>
            )}

            {html && (
              <>
                <button onClick={() => { void navigator.clipboard.writeText(html); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#2c5c38', color: '#dff0e4', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {copied ? 'HTML 복사됨' : 'HTML 복사'}
                </button>
                <div style={{ ...card, padding: 0, overflow: 'hidden', background: '#fff' }}>
                  <iframe title="미리보기" srcDoc={html} style={{ width: '100%', height: 620, border: 'none', background: '#fff' }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
