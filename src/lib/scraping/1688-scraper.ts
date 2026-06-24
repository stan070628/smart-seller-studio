import puppeteer from 'puppeteer-core';

export interface Scrape1688Result {
  productName: string;
  specs: Array<{ label: string; value: string }>;
}

function getChromiumPath(): string {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  return '/usr/bin/google-chrome-stable';
}

function sanitize(value: string, maxLen: number): string {
  return value.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

export async function scrape1688(url: string): Promise<Scrape1688Result> {
  const browser = await puppeteer.launch({
    executablePath: getChromiumPath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // 캡차/로그인 페이지 감지
    const currentUrl = page.url();
    if (
      currentUrl.includes('login.1688.com') ||
      currentUrl.includes('passport.1688.com') ||
      currentUrl.includes('member/signin')
    ) {
      throw new Error('1688 로그인 또는 캡차가 감지됐습니다. 브라우저에서 직접 로그인 후 다시 시도해주세요.');
    }

    // 스펙 요소 대기 (최대 15초, 없어도 계속 진행)
    await page.waitForSelector(
      '.detail-prop-group, [data-name], .mod-detail-attributes',
      { timeout: 15_000 }
    ).catch(() => null);

    // 1순위: window JSON state 파싱
    const jsonResult = await page.evaluate(() => {
      const candidates = [
        '__INIT_DATA__',
        '_OFFER_DETAIL_DATA_',
        'detailData',
        '__offerData__',
      ] as const;

      for (const key of candidates) {
        try {
          const raw = (window as unknown as Record<string, unknown>)[key];
          if (!raw || typeof raw !== 'object') continue;

          const data = raw as Record<string, unknown>;

          const detail =
            (data.offerDetail as Record<string, unknown> | undefined) ??
            (data.detail as Record<string, unknown> | undefined) ??
            data;

          const titleCandidates = [
            (detail as Record<string, unknown>).subject,
            (detail as Record<string, unknown>).title,
            (detail as Record<string, unknown>).offerTitle,
          ];
          const productName = titleCandidates.find(
            (v): v is string => typeof v === 'string' && v.length > 0
          ) ?? '';

          const attrCandidates = [
            (detail as Record<string, unknown>).attributes,
            (detail as Record<string, unknown>).props,
            (detail as Record<string, unknown>).skuProps,
          ];
          const attrs = attrCandidates.find(Array.isArray);

          if (!productName && !attrs) continue;

          const specs = Array.isArray(attrs)
            ? (attrs as Array<Record<string, unknown>>)
                .filter(a => a.attrName || a.name || a.label)
                .map(a => ({
                  label: String(a.attrName ?? a.name ?? a.label ?? ''),
                  value: String(a.attrValue ?? a.value ?? ''),
                }))
            : [];

          return { found: true, productName, specs };
        } catch {
          continue;
        }
      }
      return { found: false };
    }) as { found: boolean; productName?: string; specs?: Array<{ label: string; value: string }> };

    let rawProductName = '';
    let rawSpecs: Array<{ label: string; value: string }> = [];

    if (jsonResult.found) {
      rawProductName = jsonResult.productName ?? '';
      rawSpecs = jsonResult.specs ?? [];
    } else {
      // 2순위: DOM 셀렉터 fallback
      const domResult = await page.evaluate(() => {
        const titleSelectors = [
          'h1.title', '.offer-title', '[data-spm="offerTitle"] h1', 'h1',
        ];
        let productName = '';
        for (const sel of titleSelectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) { productName = el.textContent.trim(); break; }
        }

        const specs: Array<{ label: string; value: string }> = [];

        document.querySelectorAll('tr').forEach(tr => {
          const th = tr.querySelector('th');
          const td = tr.querySelector('td');
          if (th?.textContent && td?.textContent) {
            specs.push({ label: th.textContent.trim(), value: td.textContent.trim() });
          }
        });

        if (specs.length === 0) {
          document.querySelectorAll('[data-name]').forEach(el => {
            const label = el.getAttribute('data-name') ?? '';
            const value = el.getAttribute('data-value') ?? el.textContent?.trim() ?? '';
            if (label) specs.push({ label, value });
          });
        }

        if (specs.length === 0) {
          const dts = document.querySelectorAll('dt');
          dts.forEach(dt => {
            const dd = dt.nextElementSibling;
            if (dd?.tagName === 'DD' && dt.textContent) {
              specs.push({ label: dt.textContent.trim(), value: dd.textContent?.trim() ?? '' });
            }
          });
        }

        return { productName, specs };
      }) as { productName: string; specs: Array<{ label: string; value: string }> };

      rawProductName = domResult.productName;
      rawSpecs = domResult.specs;
    }

    // 후처리: sanitize, 중복 제거, 길이 제한
    const seen = new Set<string>();
    const specs = rawSpecs
      .map(s => ({
        label: sanitize(s.label, 40),
        value: sanitize(s.value, 200),
      }))
      .filter(s => {
        if (!s.label || !s.value) return false;
        if (seen.has(s.label)) return false;
        seen.add(s.label);
        return true;
      })
      .slice(0, 20);

    return {
      productName: sanitize(rawProductName, 200),
      specs,
    };
  } finally {
    await browser.close();
  }
}
