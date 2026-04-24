import type { ParsedUrl } from './types';

const PATTERNS: { source: ParsedUrl['source']; regex: RegExp }[] = [
  {
    source: 'domeggook',
    regex: /domeggook\.com\/product\/detail\/(\d+)/,
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
