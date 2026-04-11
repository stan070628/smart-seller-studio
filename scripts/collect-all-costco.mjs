import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const lines = readFileSync(resolve('/Users/seungminlee/projects/smart_seller_studio/.env.local'), 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

// 새로 추가된 카테고리 코드만 수집 (기존에 없던 것들)
const NEW_CODES = {
  '식품': ['cos_10.10.2','cos_10.2.4','cos_10.6.3','cos_10.10.5','cos_10.5.1','cos_10.2.3','cos_10.2.2','cos_10.3.1','cos_10.1.2','cos_10.3.4','cos_10.5.4'],
  '생활용품': ['cos_2.7.5','cos_2.5.11','cos_2.7.2','cos_2.6.1'],
  '가구·침구': ['cos_2.1.4','cos_2.1.1','cos_2.10.1','cos_2.1.2','cos_2.2.2','cos_2.4.12','cos_2.4.1','cos_2.12.1'],
  '주방·식기': ['cos_2.5.3','cos_2.5.1','cos_2.5.13'],
  '건강·뷰티': ['cos_8.2.1','cos_8.1.1','cos_8.3.11','cos_8.1.5','cos_8.3.2','cos_8.3.6','cos_8.2.2'],
  '건강보조식품': ['cos_12.3.2','cos_12.2.1','cos_12.5.2'],
  '가전제품': ['cos_14.2.4','cos_14.2.2','cos_1.9.14','cos_1.9.15','cos_1.11.1.3'],
  '의류·패션': ['cos_6.11.2','cos_6.13.1','cos_6.11.3','cos_6.13.3','cos_6.14.3','cos_6.3.2'],
  '자동차용품': ['cos_9.7.4','cos_9.7.3','cos_9.1.3'],
  '반려동물': ['cos_10.9.2'],
  '완구·스포츠': ['cos_3.5.2','cos_4.2.7','cos_5.5.1'],
};

async function fetchPage(occCode, page) {
  const params = new URLSearchParams({ fields:'FULL', query:`:relevance:category:${occCode}`, pageSize:'48', currentPage:String(page), lang:'ko', curr:'KRW' });
  const res = await fetch(`https://www.costco.co.kr/rest/v2/korea/products/search?${params}`, {
    headers:{ Accept:'application/json','User-Agent':'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OCC ${res.status}`);
  return res.json();
}

async function upsert(pool, p, categoryName, occCode) {
  const imgs = p.images ?? [];
  const img = imgs.find(i=>i.imageType==='PRIMARY'&&i.format==='product')??imgs.find(i=>i.imageType==='PRIMARY')??imgs[0];
  const imageUrl = img?.url ? (img.url.startsWith('http')?img.url:`https://www.costco.co.kr${img.url}`) : null;
  const productUrl = p.url ? (p.url.startsWith('http')?p.url:`https://www.costco.co.kr${p.url}`) : `https://www.costco.co.kr/p/${p.code}`;
  const price = p.price?.value ?? 0;
  if (!p.code || !p.name || price <= 0) return false;
  const stock = p.stock?.stockLevelStatus === 'outOfStock' ? 'outOfStock' : p.stock?.stockLevelStatus === 'lowStock' ? 'lowStock' : 'inStock';
  await pool.query(
    `INSERT INTO public.costco_products (product_code,title,category_name,category_code,price,original_price,image_url,product_url,brand,average_rating,review_count,stock_status,first_price,lowest_price,is_active,collected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$5,$5,true,now())
     ON CONFLICT (product_code) DO UPDATE SET title=EXCLUDED.title,category_name=EXCLUDED.category_name,category_code=EXCLUDED.category_code,price=EXCLUDED.price,original_price=EXCLUDED.original_price,image_url=EXCLUDED.image_url,product_url=EXCLUDED.product_url,brand=EXCLUDED.brand,average_rating=EXCLUDED.average_rating,review_count=EXCLUDED.review_count,stock_status=EXCLUDED.stock_status,first_price=COALESCE(costco_products.first_price,EXCLUDED.price),lowest_price=LEAST(COALESCE(costco_products.lowest_price,EXCLUDED.price),EXCLUDED.price),is_active=true,collected_at=now(),updated_at=now()`,
    [p.code,p.name,categoryName,occCode,price,(p.listPrice?.value>price?p.listPrice.value:null),imageUrl,productUrl,p.manufacturer??null,p.averageRating??null,p.numberOfReviews??0,stock]
  );
  return true;
}

async function main() {
  const env = loadEnv();
  const pool = new pg.Pool({ connectionString: env.SOURCING_DATABASE_URL, ssl:{ rejectUnauthorized:false } });
  let grandTotal = 0;

  for (const [categoryName, codes] of Object.entries(NEW_CODES)) {
    for (const occCode of codes) {
      let catTotal = 0, page = 0;
      while (true) {
        try {
          const data = await fetchPage(occCode, page);
          const products = data.products ?? [];
          for (const p of products) {
            if (await upsert(pool, p, categoryName, occCode)) catTotal++;
          }
          const pag = data.pagination ?? {};
          if (!products.length || pag.currentPage >= pag.totalPages - 1) break;
          page++;
          await new Promise(r=>setTimeout(r,200));
        } catch(e) {
          console.error(`  오류 ${occCode}:`, e.message);
          break;
        }
      }
      console.log(`  [${occCode}] ${categoryName} → ${catTotal}개`);
      grandTotal += catTotal;
      await new Promise(r=>setTimeout(r,200));
    }
  }

  console.log(`\n총 ${grandTotal}개 저장 완료`);
  await pool.end();
}

main().catch(e=>{ console.error(e); process.exit(1); });
