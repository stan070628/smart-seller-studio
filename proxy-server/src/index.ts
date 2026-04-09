import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT ?? 3001;
const PROXY_SECRET = process.env.PROXY_SECRET;

if (!PROXY_SECRET) {
  console.error('PROXY_SECRET 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

app.use(express.raw({ type: '*/*', limit: '10mb' }));

app.all('/proxy', async (req: Request, res: Response) => {
  if (req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const targetUrl = req.headers['x-target-url'] as string | undefined;
  if (!targetUrl) {
    res.status(400).json({ error: 'Missing x-target-url header' });
    return;
  }

  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (
      key === 'x-proxy-secret' ||
      key === 'x-target-url' ||
      key === 'host' ||
      key === 'connection' ||
      key === 'transfer-encoding'
    ) continue;
    if (typeof value === 'string') forwardHeaders[key] = value;
    else if (Array.isArray(value)) forwardHeaders[key] = value.join(', ');
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && Buffer.isBuffer(req.body) && req.body.length > 0;

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers: forwardHeaders,
    body: hasBody ? req.body : undefined,
  });

  const responseBody = await upstream.arrayBuffer();

  upstream.headers.forEach((value, key) => {
    if (key === 'transfer-encoding' || key === 'connection' || key === 'content-encoding') return;
    res.setHeader(key, value);
  });

  res.status(upstream.status).send(Buffer.from(responseBody));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
