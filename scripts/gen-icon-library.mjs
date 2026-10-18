// icon-paths.ts 생성기 — lucide-static SVG를 인라인 임베드한다.
// 실행: node scripts/gen-icon-library.mjs  (재생성 시에만; 결과 파일은 커밋한다)
// 생성 대상은 데이터 모듈(icon-paths.ts)뿐이다. getIcon 등 로직은 손으로 쓴
// src/lib/detail-page/icon-library.ts에 있으며 이 스크립트가 건드리지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

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
  // moisture_droplet은 glass-water(물컵)였다 — 키 이름만 보는 레이아웃 모델이 「흡수」「보습」에
  // 골라 물컵이 그려졌다(2026-10-18 렌더 비교). 이름대로 물방울로 고친다.
  bubble_cloud: 'cloud', moisture_droplet: 'droplet',
  // 의류
  cloth_shirt: 'shirt', fit_move: 'move-vertical', stretch_expand: 'expand',
  // 범용
  check_badge: 'badge-check', star_point: 'star', home_house: 'house',
  // 2026-10-18 보강 — 렌더 비교에서 「세탁」에 맞는 키가 없어 물결이 붙었다. 자주 나오는 속성을 채운다.
  wash_machine: 'washing-machine', reuse_recycle: 'recycle', care_gentle: 'hand-heart',
  power_zap: 'zap', charge_battery: 'battery-charging', quiet_mute: 'volume-x',
  waterproof_umbrella: 'umbrella', warm_flame: 'flame', cool_thermo: 'thermometer-snowflake',
  microwave_ok: 'microwave', fridge_storage: 'refrigerator', kitchen_utensils: 'utensils',
  magnet_attach: 'magnet', lock_secure: 'lock', compact_minimize: 'minimize-2', cut_scissors: 'scissors',
  pet_paw: 'paw-print', car_vehicle: 'car', sleep_bed: 'bed', living_sofa: 'sofa',
};

const dir = resolve(repoRoot, 'node_modules/lucide-static/icons');
const entries = [];
const missing = [];
const malformed = [];
for (const [key, lucideName] of Object.entries(KEY_MAP)) {
  let svg;
  try {
    svg = readFileSync(resolve(dir, `${lucideName}.svg`), 'utf8');
  } catch {
    missing.push(`${key} -> ${lucideName}`);
    continue;
  }
  // <svg ...> 래퍼를 벗기고 내부 path만 남긴다. 렌더 시 우리가 다시 감싼다.
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  // sanity check: 스트리핑이 실패하면 빈 문자열이거나 <svg가 그대로 남는다.
  if (!inner || inner.includes('<svg')) {
    malformed.push(`${key} -> ${lucideName}`);
    continue;
  }
  entries.push(`  ${JSON.stringify(key)}: ${JSON.stringify(inner)},`);
}
if (missing.length) {
  console.error('누락된 lucide 아이콘 (이름을 고쳐라):\n' + missing.join('\n'));
  process.exit(1);
}
if (malformed.length) {
  console.error('스트리핑 실패 (원본 SVG를 확인하라):\n' + malformed.join('\n'));
  process.exit(1);
}
const out = `// 자동 생성 파일 — 수정하지 말 것. 재생성: node scripts/gen-icon-library.mjs
// 출처: lucide-static (ISC). stroke 기반 선형 아이콘의 내부 마크업만 임베드한다.
// 로직(getIcon 등)은 손으로 쓴 ./icon-library.ts가 이 파일을 import한다.

export const ICON_PATHS: Record<string, string> = {
${entries.join('\n')}
};
`;
writeFileSync(resolve(repoRoot, 'src/lib/detail-page/icon-paths.ts'), out);
console.log(`icon-paths.ts 생성: ${entries.length}개 아이콘`);
