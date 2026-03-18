export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=1800'); // cache 30 menit
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const results = {};

    // ── 1. KURS USD/IDR (Frankfurter) ──────────────────────────────
    let usdIdr = 16200;
    try {
      const fx = await fetch('https://api.frankfurter.app/latest?from=USD&to=IDR');
      const fxd = await fx.json();
      usdIdr = fxd.rates?.IDR || 16200;
    } catch(e) {}
    results.exchange_rate = { usd_idr: usdIdr };

    // ── 2. KOMODITAS GLOBAL via Yahoo Finance ───────────────────────
    // Simbol Yahoo Finance untuk komoditas relevan Indonesia
    const globalCommodities = {
      // Ternak global (untuk referensi harga sapi/babi internasional)
      live_cattle:      'GF=F',   // Live Cattle (cents/pound)
      lean_hogs:        'HE=F',   // Lean Hogs (cents/pound)
      // Perkebunan
      cpo_palm:         'FCPO.BMD', // CPO Bursa Malaysia (MYR/ton) -- fallback ke harga manual kalau gagal
      natural_rubber:   'TOCOM=F', // Karet TOCOM (JPY/kg)
      coffee_arabica:   'KC=F',   // Kopi Arabika ICE (cents/pound)
      coffee_robusta:   'RC=F',   // Kopi Robusta ICE (USD/ton)
      cocoa:            'CC=F',   // Kakao ICE (USD/ton)
      // Tanaman pangan
      corn:             'ZC=F',   // Jagung CBOT (cents/bushel)
      soybeans:         'ZS=F',   // Kedelai CBOT (cents/bushel)
      // Aquaculture
      shrimp:           null,     // Tidak ada Yahoo ticker, pakai estimasi
    };

    const yahooFetch = async (symbol) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      const d = await r.json();
      const meta = d.chart?.result?.[0]?.meta;
      if (!meta) throw new Error('No meta');
      const timestamps = d.chart?.result?.[0]?.timestamp || [];
      const closes = d.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      // Ambil 7 titik data valid terakhir untuk tren
      const valid = closes.filter(v => v !== null && v !== undefined);
      const trend = valid.slice(-7).map(v => Math.round(v * 100) / 100);
      const prev = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
      const curr = meta.regularMarketPrice;
      const changePct = prev ? parseFloat(((curr - prev) / prev * 100).toFixed(2)) : 0;
      return { priceRaw: curr, prev, changePct, trend, currency: meta.currency, symbol };
    };

    // Konversi ke IDR/unit yang relevan untuk Indonesia
    const convertToIdr = (key, raw, curr) => {
      switch(key) {
        case 'live_cattle':
          // cents/pound → IDR/kg
          return Math.round((raw / 100) * usdIdr / 0.453592);
        case 'lean_hogs':
          // cents/pound → IDR/kg
          return Math.round((raw / 100) * usdIdr / 0.453592);
        case 'coffee_arabica':
          // cents/pound → IDR/kg
          return Math.round((raw / 100) * usdIdr / 0.453592);
        case 'coffee_robusta':
          // USD/ton → IDR/kg
          return Math.round((raw / 1000) * usdIdr);
        case 'cocoa':
          // USD/ton → IDR/kg
          return Math.round((raw / 1000) * usdIdr);
        case 'corn':
          // cents/bushel → IDR/kg (1 bushel jagung = 25.4 kg)
          return Math.round((raw / 100) * usdIdr / 25.4);
        case 'soybeans':
          // cents/bushel → IDR/kg (1 bushel kedelai = 27.2 kg)
          return Math.round((raw / 100) * usdIdr / 27.2);
        case 'natural_rubber':
          // JPY/kg → IDR/kg (estimasi JPY/IDR ≈ 107)
          return Math.round(raw * 107);
        case 'cpo_palm':
          // MYR/ton → IDR/kg (estimasi MYR/IDR ≈ 3450)
          return Math.round((raw * 3450) / 1000);
        default:
          return Math.round(raw * usdIdr);
      }
    };

    for (const [key, symbol] of Object.entries(globalCommodities)) {
      if (!symbol) continue;
      try {
        const data = await yahooFetch(symbol);
        const priceIdr = convertToIdr(key, data.priceRaw, data.currency);
        const trendIdr = data.trend.map(v => convertToIdr(key, v, data.currency));
        results[key] = {
          price_idr: priceIdr,
          price_raw: data.priceRaw,
          currency: data.currency,
          change_pct: data.changePct,
          trend7: trendIdr,
          updated: new Date().toISOString()
        };
      } catch(e) {
        results[key] = { error: e.message, fallback: true };
      }
    }

    // ── 3. HARGA LOKAL INDONESIA via Panel Harga Kementan ──────────
    // Scrape hargapangan.id (portal resmi pangan strategis)
    const localPrices = {};
    try {
      const r = await fetch('https://hargapangan.id/tabel-harga/pasar-tradisional/daerah', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TernakOS/1.0; +https://ternakos.com)',
          'Accept': 'text/html,application/xhtml+xml'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (r.ok) {
        const html = await r.text();
        const extractPrice = (pattern) => {
          const m = html.match(pattern);
          return m ? parseInt(m[1].replace(/[.,\s]/g,'')) : null;
        };
        localPrices.cabai_merah_keriting = extractPrice(/Cabai Merah Keriting[^]*?[\s>]([\d.,]{4,9})/i);
        localPrices.cabai_rawit_merah    = extractPrice(/Cabai Rawit Merah[^]*?[\s>]([\d.,]{4,9})/i);
        localPrices.bawang_merah         = extractPrice(/Bawang Merah[^]*?[\s>]([\d.,]{4,9})/i);
        localPrices.bawang_putih         = extractPrice(/Bawang Putih[^]*?[\s>]([\d.,]{4,9})/i);
        localPrices.daging_sapi          = extractPrice(/Daging Sapi[^]*?[\s>]([\d.,]{5,12})/i);
        localPrices.daging_ayam          = extractPrice(/Daging Ayam[^]*?[\s>]([\d.,]{4,9})/i);
        localPrices.telur_ayam           = extractPrice(/Telur Ayam[^]*?[\s>]([\d.,]{4,9})/i);
        localPrices.beras_medium         = extractPrice(/Beras Medium[^]*?[\s>]([\d.,]{4,9})/i);
        localPrices.jagung               = extractPrice(/Jagung[^]*?[\s>]([\d.,]{3,8})/i);
        localPrices.source = 'hargapangan.id';
        localPrices.updated = new Date().toISOString();
      }
    } catch(e) {
      localPrices.error = 'hargapangan.id tidak dapat diakses';
    }

    // Fallback: coba Panel Harga Kementan langsung
    if (!localPrices.daging_sapi) {
      try {
        const r2 = await fetch('https://panelharga.kementan.go.id/', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (r2.ok) {
          const html2 = await r2.text();
          const ep = (pat) => { const m = html2.match(pat); return m ? parseInt(m[1].replace(/[.,]/g,'')) : null; };
          localPrices.cabai_merah_keriting = localPrices.cabai_merah_keriting || ep(/Cabai Merah[^]*?Rp\s*([\d.,]+)/i);
          localPrices.bawang_merah         = localPrices.bawang_merah || ep(/Bawang Merah[^]*?Rp\s*([\d.,]+)/i);
          localPrices.daging_ayam          = localPrices.daging_ayam || ep(/Ayam[^]*?Rp\s*([\d.,]+)/i);
          localPrices.telur_ayam           = localPrices.telur_ayam || ep(/Telur[^]*?Rp\s*([\d.,]+)/i);
          localPrices.source = 'panelharga.kementan.go.id';
          localPrices.updated = new Date().toISOString();
        }
      } catch(e2) {}
    }

    results.local = localPrices;

    // ── 4. HARGA UDANG via ShrimpTrade (estimasi dari berita) ───────
    // Tidak ada API gratis — gunakan estimasi berbasis CPO price correlation
    // Udang Vaname size 70: rata-rata Rp 58.000-72.000/kg
    // Tren: naik saat udang Ekuador/India terganggu, turun saat panen massal

    // ── 5. HARGA SAPI LOKAL (estimasi berbasis daging sapi) ─────────
    // Harga sapi hidup ≈ harga daging sapi × 5.5-6 (karkas ratio 50-55%)
    if (localPrices.daging_sapi && localPrices.daging_sapi > 50000) {
      results.sapi_hidup_estimasi = {
        price_idr: Math.round(localPrices.daging_sapi * 5.8 * 400), // per ekor ~400kg
        basis: 'estimasi dari harga daging × bobot × karkas ratio',
        updated: new Date().toISOString()
      };
    }

    results.timestamp = new Date().toISOString();
    results.next_update = new Date(Date.now() + 1800000).toISOString(); // 30 menit
    res.status(200).json(results);

  } catch(error) {
    res.status(500).json({ error: error.message });
  }
}
