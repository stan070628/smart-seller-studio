import type { ParsedUrl } from './types';

const PATTERNS: { source: ParsedUrl['source']; regex: RegExp }[] = [
  {
    // /product/detail/XXXXX 형식
    source: 'domeggook',
    regex: /domeggook\.com\/product\/detail\/(\d+)/,
  },
  {
    // 단축 URL: domeggook.com/XXXXX 형식 (숫자 8자리 이상)
    source: 'domeggook',
    regex: /domeggook\.com\/(\d{6,})\b/,
  },
  {
    source: 'costco',
    regex: /costco\.co\.kr\/p\/([A-Za-z0-9-]+)/,
  },
];

export function parseSourceUrl(url: string): ParsedUrl | null {
  for (const { source, regex } of PATTERNS) {
    const match = url.match(regex);
    if (match?.[1]) {
      return { source, itemId: match[1] };
    }
  }
  return null;
}
