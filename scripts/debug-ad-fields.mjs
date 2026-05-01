import crypto from 'node:crypto';

const apiKey = process.env.NAVER_AD_API_KEY;
const secretKey = process.env.NAVER_AD_SECRET_KEY;
const customerId = process.env.NAVER_AD_CUSTOMER_ID;

const sig = (ts, m, p, s) => crypto.createHmac('sha256', s).update(`${ts}.${m}.${p}`).digest('base64');

const ts = Date.now().toString();
const path = '/keywordstool';
const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent('수납함')}&showDetail=1`;

const r = await fetch(url, {
  headers: {
    'X-Timestamp': ts,
    'X-API-KEY': apiKey,
    'X-Customer': customerId,
    'X-Signature': sig(ts, 'GET', path, secretKey),
  },
});

const j = await r.json();
const sample = (j.keywordList || []).slice(0, 3);
for (const k of sample) {
  console.log('---');
  console.log(JSON.stringify(k, null, 2));
}
