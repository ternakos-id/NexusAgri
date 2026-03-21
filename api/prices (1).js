// /api/prices.js — NexusAgri live commodity prices
// Returns commodity prices in IDR using Yahoo Finance + fallback
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch USD/IDR exchange rate
    const fxUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/USDIDR=X?interval=1d&range=1d';
    const fxRes = await fetch(fxUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    let usdIdr = 16500; // fallback rate
    if (fxRes.ok) {
      const fxData = await fxRes.json();
      const price = fxData?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) usdIdr = price;
    }

    // Commodity symbols → IDR conversion factors
    const commodities = {
      'GC=F':  { key: 'emas',   factor: usdIdr / 31.1035, unit: 'per gram' },
      'ZC=F':  { key: 'jagung', factor: usdIdr * 0.02268 / 100, unit: 'per kg' },
      'ZS=F':  { key: 'kedelai',factor: usdIdr * 0.02722 / 100, unit: 'per kg' },
      'ZW=F':  { key: 'gandum', factor: usdIdr * 0.02722 / 100, unit: 'per kg' },
      'CC=F':  { key: 'kakao',  factor: usdIdr * 0.02205 / 100, unit: 'per kg' },
      'KC=F':  { key: 'kopi',   factor: usdIdr * 0.00661 / 100, unit: 'per kg' },
    };

    const results = { usdIdr, timestamp: new Date().toISOString() };

    await Promise.all(Object.entries(commodities).map(async ([symbol, info]) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) return;
        const data = await r.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return;
        const price = meta.regularMarketPrice * info.factor;
        const prev = meta.chartPreviousClose * info.factor;
        const change = prev > 0 ? ((price - prev) / prev * 100) : 0;
        results[info.key] = { price: Math.round(price), change: parseFloat(change.toFixed(2)), unit: info.unit };
      } catch (_) {}
    }));

    return res.status(200).json(results);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
