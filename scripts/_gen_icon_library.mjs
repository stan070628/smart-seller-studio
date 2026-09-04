// icon-library.ts 생성기 — lucide-static SVG를 인라인 임베드한다.
// 실행: node scripts/_gen_icon_library.mjs  (재생성 시에만; 결과 파일은 커밋한다)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 우리 키 → lucide 아이콘 파일명. 키는 상세페이지 도메인 어휘로 짓는다.
const KEY_MAP = {
  // 계절·기간
  season_sun: 'sun', season_winter: 'snowflake', season_leaf: 'leaf',
  duration_clock: 'clock', duration_calendar: 'calendar-days', duration_timer: 'timer',
  // 성분·재질
  ingredient_droplet: 'droplet', ingredient_sprout: 'sprout', ingredient_flower: 'flower-2',
  ingredient_feather: 'feather', texture_layers: 'layers', natural_leafy: 'leafy-green',
  // 세척·관리
  wash_droplets: 'droplets', wash_waves: 'waves', care_refresh: 'rotate-cw',
  care_hand: 'hand', care_thermometer: 'thermometer',
  // 보관·포장·배송
  storage_box: 'box', storage_archive: 'archive', pack_package: 'package',
  pack_sealed: 'package-check', gift_box: 'gift', delivery_truck: 'truck',
  // 용량·구성·수치
  size_ruler: 'ruler', weight_scale: 'scale', count_grid: 'layout-grid',
  plus_bonus: 'circle-plus',
  // 사용감·효익
  feel_sparkle: 'sparkles', feel_heart: 'heart', feel_smile: 'smile',
  safe_shield: 'shield-check', mild_baby: 'baby', scent_wind: 'wind',
  bubble_cloud: 'cloud', moisture_droplet: 'glass-water',
  // 의류
  cloth_shirt: 'shirt', fit_move: 'move-vertical', stretch_expand: 'expand',
  // 범용
  check_badge: 'badge-check', star_point: 'star', home_house: 'house',
};

const dir = resolve('node_modules/lucide-static/icons');
const entries = [];
const missing = [];
for (const [key, lucideName] of Object.entries(KEY_MAP)) {
  try {
    const svg = readFileSync(resolve(dir, `${lucideName}.svg`), 'utf8');
    // <svg ...> 래퍼를 벗기고 내부 path만 남긴다. 렌더 시 우리가 다시 감싼다.
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
    entries.push(`  ${JSON.stringify(key)}: ${JSON.stringify(inner)},`);
  } catch {
    missing.push(`${key} -> ${lucideName}`);
  }
}
if (missing.length) {
  console.error('누락된 lucide 아이콘 (이름을 고쳐라):\n' + missing.join('\n'));
  process.exit(1);
}
const out = `// 자동 생성 파일 — 수정하지 말 것. 재생성: node scripts/_gen_icon_library.mjs
// 출처: lucide-static (ISC). stroke 기반 선형 아이콘의 내부 마크업만 임베드한다.

const ICON_PATHS: Record<string, string> = {
${entries.join('\n')}
};

export const ICON_KEYS = Object.keys(ICON_PATHS);

/** 유효한 키면 인라인 SVG 문자열, 아니면 null. color는 stroke 색. */
export function getIcon(key: string, size = 26, color = 'currentColor'): string | null {
  const inner = ICON_PATHS[key];
  if (!inner) return null;
  return \`<svg xmlns="http://www.w3.org/2000/svg" width="\${size}" height="\${size}" viewBox="0 0 24 24" fill="none" stroke="\${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 8px;">\${inner}</svg>\`;
}
`;
writeFileSync(resolve('src/lib/detail-page/icon-library.ts'), out);
console.log(`icon-library.ts 생성: ${entries.length}개 아이콘`);
