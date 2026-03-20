// ─────────────────────────────────────────────────────────
// NexusAgri · /api/prices.js
// Live commodity prices: Yahoo Finance + Kementan + estimasi
// Coverage: 50+ komoditas hayati Indonesia
// Cache: 30 menit
// ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=1800'); // 30 menit cache
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const results = {};

    // ── 1. KURS USD/IDR ─────────────────────────────────
    let usdIdr = 16200;
    let myrIdr = 3450;  // MYR untuk CPO
    let jpyIdr = 108;   // JPY untuk karet TOCOM
    try {
      const fx = await fetch('https://api.frankfurter.app/latest?from=USD&to=IDR,MYR,JPY', {
        signal: AbortSignal.timeout(4000)
      });
      const fxd = await fx.json();
      if (fxd.rates) {
        usdIdr = fxd.rates.IDR || 16200;
        // MYR/IDR: IDR per MYR = (IDR/USD) / (MYR/USD)
        if (fxd.rates.MYR) myrIdr = Math.round(usdIdr / fxd.rates.MYR);
        // JPY/IDR
        if (fxd.rates.JPY) jpyIdr = Math.round(usdIdr / fxd.rates.JPY);
      }
    } catch(e) { /* gunakan fallback */ }

    results.exchange_rate = {
      usd_idr: Math.round(usdIdr),
      myr_idr: Math.round(myrIdr),
      jpy_idr: Math.round(jpyIdr),
      updated: new Date().toISOString()
    };

    // ── 2. KOMODITAS GLOBAL via Yahoo Finance ────────────
    const yahooSymbols = {
      // Ternak global (referensi)
      live_cattle:    'GF=F',    // Live Cattle (cents/pound) → IDR/kg
      lean_hogs:      'HE=F',    // Lean Hogs (cents/pound) → IDR/kg
      // Perkebunan
      cpo_palm:       'FCPO.BMD', // CPO Bursa Malaysia (MYR/ton) → IDR/kg TBS
      natural_rubber: 'TOCOM=F',  // Karet TOCOM (JPY/kg) → IDR/kg
      coffee_arabica: 'KC=F',    // Kopi Arabika ICE (cents/pound) → IDR/kg
      coffee_robusta: 'RC=F',    // Kopi Robusta ICE (USD/ton) → IDR/kg
      cocoa:          'CC=F',    // Kakao ICE (USD/ton) → IDR/kg
      // Tanaman pangan
      corn:           'ZC=F',    // Jagung CBOT (cents/bushel) → IDR/kg
      soybeans:       'ZS=F',    // Kedelai CBOT (cents/bushel) → IDR/kg
      wheat:          'ZW=F',    // Gandum CBOT (cents/bushel) → IDR/kg
      rice:           'ZR=F',    // Beras kasar CBOT → IDR/kg
      sugar:          'SB=F',    // Gula mentah ICE (cents/pound) → IDR/kg
    };

    const yahooFetch = async (symbol) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=7d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      const d = await r.json();
      const meta = d.chart?.result?.[0]?.meta;
      if (!meta) throw new Error('No meta');
      const closes = d.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
      const valid = closes.filter(v => v != null);
      const trend = valid.slice(-7).map(v => Math.round(v * 100) / 100);
      const prev = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
      const curr = meta.regularMarketPrice;
      const changePct = prev ? parseFloat(((curr - prev) / prev * 100).toFixed(2)) : 0;
      return { priceRaw: curr, prev, changePct, trend, currency: meta.currency, symbol };
    };

    const toIdr = (key, raw) => {
      switch(key) {
        case 'live_cattle':    return Math.round((raw / 100) * usdIdr / 0.453592);
        case 'lean_hogs':      return Math.round((raw / 100) * usdIdr / 0.453592);
        case 'coffee_arabica': return Math.round((raw / 100) * usdIdr / 0.453592);
        case 'coffee_robusta': return Math.round((raw / 1000) * usdIdr);
        case 'cocoa':          return Math.round((raw / 1000) * usdIdr);
        case 'corn':           return Math.round((raw / 100) * usdIdr / 25.4);
        case 'soybeans':       return Math.round((raw / 100) * usdIdr / 27.2);
        case 'wheat':          return Math.round((raw / 100) * usdIdr / 27.2);
        case 'rice':           return Math.round((raw / 100) * usdIdr / 22.7);
        case 'sugar':          return Math.round((raw / 100) * usdIdr / 0.453592);
        case 'natural_rubber': return Math.round(raw * jpyIdr);
        case 'cpo_palm':       return Math.round((raw * myrIdr) / 1000);
        default:               return Math.round(raw * usdIdr);
      }
    };

    for (const [key, symbol] of Object.entries(yahooSymbols)) {
      try {
        const data = await yahooFetch(symbol);
        const priceIdr = toIdr(key, data.priceRaw);
        const trendIdr = data.trend.map(v => toIdr(key, v));
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

    // ── 3. HARGA LOKAL via Panel Harga Kementan ──────────
    const local = {};
    const scrapers = [
      async () => {
        const r = await fetch('https://hargapangan.id/tabel-harga/pasar-tradisional/daerah', {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
          signal: AbortSignal.timeout(6000)
        });
        if (!r.ok) throw new Error('hargapangan.id failed');
        const html = await r.text();
        const ep = (pat) => { const m = html.match(pat); return m ? parseInt(m[1].replace(/[.,\s]/g,'')) : null; };
        local.cabai_merah_keriting = ep(/Cabai Merah Keriting[^]*?[\s>]([\d.,]{4,9})/i);
        local.cabai_rawit_merah    = ep(/Cabai Rawit Merah[^]*?[\s>]([\d.,]{4,9})/i);
        local.bawang_merah         = ep(/Bawang Merah[^]*?[\s>]([\d.,]{4,9})/i);
        local.bawang_putih         = ep(/Bawang Putih[^]*?[\s>]([\d.,]{4,9})/i);
        local.daging_sapi          = ep(/Daging Sapi[^]*?[\s>]([\d.,]{5,12})/i);
        local.daging_ayam          = ep(/Daging Ayam[^]*?[\s>]([\d.,]{4,9})/i);
        local.telur_ayam           = ep(/Telur Ayam[^]*?[\s>]([\d.,]{4,9})/i);
        local.beras_medium         = ep(/Beras Medium[^]*?[\s>]([\d.,]{4,9})/i);
        local.jagung               = ep(/Jagung[^]*?[\s>]([\d.,]{3,8})/i);
        local.minyak_goreng        = ep(/Minyak Goreng[^]*?[\s>]([\d.,]{4,9})/i);
        local.gula_pasir           = ep(/Gula Pasir[^]*?[\s>]([\d.,]{4,9})/i);
        local.kedelai              = ep(/Kedelai[^]*?[\s>]([\d.,]{4,9})/i);
        local.source = 'hargapangan.id';
        local.updated = new Date().toISOString();
      },
      async () => {
        const r = await fetch('https://panelharga.kementan.go.id/', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (!r.ok) throw new Error('panelharga failed');
        const html = await r.text();
        const ep = (pat) => { const m = html.match(pat); return m ? parseInt(m[1].replace(/[.,]/g,'')) : null; };
        if (!local.daging_ayam)          local.daging_ayam          = ep(/Ayam[^]*?Rp\s*([\d.,]+)/i);
        if (!local.telur_ayam)           local.telur_ayam           = ep(/Telur[^]*?Rp\s*([\d.,]+)/i);
        if (!local.cabai_merah_keriting) local.cabai_merah_keriting = ep(/Cabai Merah[^]*?Rp\s*([\d.,]+)/i);
        if (!local.bawang_merah)         local.bawang_merah         = ep(/Bawang Merah[^]*?Rp\s*([\d.,]+)/i);
        if (!local.source) { local.source = 'panelharga.kementan.go.id'; local.updated = new Date().toISOString(); }
      }
    ];

    for (const scraper of scrapers) {
      try { await scraper(); break; } catch(e) { /* try next */ }
    }
    results.local = local;

    // ── 4. ESTIMASI HARGA TURUNAN ────────────────────────
    // Harga sapi hidup dari daging sapi (karkas ratio ~50-55%)
    if (local.daging_sapi && local.daging_sapi > 50000) {
      results.sapi_hidup_estimasi = {
        price_idr: Math.round(local.daging_sapi * 5.8 * 420), // 420kg avg bobot
        basis: 'estimasi: harga daging × bobot × karkas ratio',
        updated: new Date().toISOString()
      };
    }

    // Harga ayam live dari daging ayam
    if (local.daging_ayam && local.daging_ayam > 20000) {
      results.ayam_hidup_estimasi = {
        price_idr: Math.round(local.daging_ayam / 1.4), // live bird ≈ daging / 1.4
        basis: 'estimasi dari harga daging ayam',
        updated: new Date().toISOString()
      };
    }

    // ── 5. HARGA KOMODITAS MANUAL / SEMI-REALTIME ───────
    // Untuk komoditas yang tidak ada di Yahoo atau Kementan
    // Menggunakan range harga riil Maret 2026 sebagai baseline statis
    // (Akan di-override oleh data live jika tersedia)
    const staticPrices = {
      // Ternak lokal (per ekor, rata-rata nasional)
      kambing_etawa:    { price_idr: 3500000, unit: 'ekor', source: 'PPSKI Maret 2026' },
      kambing_boer:     { price_idr: 4500000, unit: 'ekor', source: 'peternak Jatim' },
      kambing_kacang:   { price_idr: 1200000, unit: 'ekor', source: 'pasar Mojokerto' },
      domba_garut:      { price_idr: 3000000, unit: 'ekor', source: 'HPDKI 2026' },
      kerbau_lokal:     { price_idr: 18000000, unit: 'ekor', source: 'Kementan' },
      // Unggas
      ayam_kampung:     { price_idr: 75000, unit: 'ekor', source: 'pasar tradisional' },
      ayam_broiler_doc: { price_idr: 8000, unit: 'DOC', source: 'PT Charoen Pokphand' },
      bebek_mojosari:   { price_idr: 68000, unit: 'ekor', source: 'peternak Jatim' },
      puyuh_layer:      { price_idr: 5500, unit: 'ekor', source: 'BPS 2026' },
      // Aquaculture
      lele_sangkuriang: { price_idr: 18500, unit: 'kg', source: 'KKP 2026' },
      nila_gift:        { price_idr: 23000, unit: 'kg', source: 'KKP 2026' },
      udang_vaname:     { price_idr: 62000, unit: 'kg size70', source: 'ShrimpTrade' },
      gurame_soang:     { price_idr: 38000, unit: 'kg', source: 'pasar Jatim' },
      kerapu_macan:     { price_idr: 145000, unit: 'kg', source: 'KKP ekspor' },
      bandeng:          { price_idr: 22000, unit: 'kg', source: 'KKP 2026' },
      lobster_air_tawar:{ price_idr: 185000, unit: 'kg', source: 'asosiasi LAT' },
      // Hortikultura
      cabai_merah_besar:{ price_idr: 42000, unit: 'kg', source: 'Panel Harga Kementan' },
      tomat_servo:      { price_idr: 8500, unit: 'kg', source: 'Panel Harga' },
      bawang_brebes:    { price_idr: 28000, unit: 'kg', source: 'Dinas Brebes' },
      // Tanaman pangan
      padi_ciherang:    { price_idr: 5800, unit: 'kg GKP', source: 'BPS/Bulog 2026' },
      padi_rojolele:    { price_idr: 9000, unit: 'kg', source: 'Gapoktan Klaten' },
      kedelai_anjasmoro:{ price_idr: 10500, unit: 'kg', source: 'BPS 2026' },
      singkong_adira:   { price_idr: 1800, unit: 'kg', source: 'BPTP Lampung' },
      // Perkebunan
      sawit_tbs:        { price_idr: 2600, unit: 'kg TBS', source: 'KPBN/Ditjenbun' },
      kopi_arabika_gayo:{ price_idr: 95000, unit: 'kg GCB', source: 'AEKI 2026' },
      kopi_robusta:     { price_idr: 55000, unit: 'kg', source: 'AEKI 2026' },
      kakao_fermentasi: { price_idr: 115000, unit: 'kg', source: 'Askindo 2026' },
      kelapa_bulat:     { price_idr: 4500, unit: 'butir', source: 'Ditjenbun' },
      // Tanaman obat
      jahe_merah:       { price_idr: 25000, unit: 'kg', source: 'Panel Harga Kementan' },
      jahe_emprit:      { price_idr: 18000, unit: 'kg', source: 'pasar rempah Jatim' },
      kunyit:           { price_idr: 10000, unit: 'kg', source: 'pasar tradisional' },
      temulawak:        { price_idr: 12000, unit: 'kg', source: 'pasar tradisional' },
      // Insekta
      maggot_bsf_fresh: { price_idr: 8500, unit: 'kg', source: 'HIMAKSI 2026' },
      maggot_bsf_kering:{ price_idr: 18000, unit: 'kg', source: 'HIMAKSI 2026' },
      madu_trigona:     { price_idr: 180000, unit: 'kg', source: 'peternak Jatim' },
      madu_apis:        { price_idr: 90000, unit: 'kg', source: 'Perlebahan Indonesia' },
      jangkrik:         { price_idr: 48000, unit: 'kg', source: 'pasar pakan burung' },
      // Pakan ternak
      dedak_padi:       { price_idr: 3500, unit: 'kg', source: 'pabrik penggilingan' },
      jagung_pakan:     { price_idr: 6000, unit: 'kg', source: 'BPS/BPPP' },
      bungkil_kedelai:  { price_idr: 9000, unit: 'kg', source: 'importir pakan' },
      tepung_ikan:      { price_idr: 14000, unit: 'kg', source: 'distributor pakan' },
    };

    // Override static dengan data live jika ada
    if (results.corn?.price_idr)     staticPrices.jagung_pakan.price_idr = results.corn.price_idr;
    if (results.soybeans?.price_idr) staticPrices.bungkil_kedelai.price_idr = results.soybeans.price_idr;
    if (results.cpo_palm?.price_idr) staticPrices.sawit_tbs.price_idr = Math.round(results.cpo_palm.price_idr * 0.22 / 1000 * 1000000);
    if (results.natural_rubber?.price_idr) {
      const karet = results.natural_rubber.price_idr;
      staticPrices.karet_gt1 = { price_idr: karet, unit: 'kg KK', source: 'TOCOM via Yahoo' };
    }
    if (results.coffee_arabica?.price_idr) {
      staticPrices.kopi_arabika_gayo.price_idr = Math.round(results.coffee_arabica.price_idr * 0.85);
    }
    if (results.coffee_robusta?.price_idr) {
      staticPrices.kopi_robusta.price_idr = Math.round(results.coffee_robusta.price_idr * 0.88);
    }
    if (results.cocoa?.price_idr) {
      staticPrices.kakao_fermentasi.price_idr = Math.round(results.cocoa.price_idr * 0.88);
    }
    if (local.jagung && local.jagung > 1000) {
      staticPrices.jagung_pakan.price_idr = local.jagung;
    }
    if (local.kedelai && local.kedelai > 5000) {
      staticPrices.kedelai_anjasmoro.price_idr = local.kedelai;
    }
    if (local.cabai_merah_keriting) {
      staticPrices.cabai_merah_besar.price_idr = local.cabai_merah_keriting;
    }
    if (local.bawang_merah) {
      staticPrices.bawang_brebes.price_idr = local.bawang_merah;
    }
    if (local.daging_sapi && local.daging_sapi > 50000) {
      // Estimasi kambing dari rasio harga daging
      staticPrices.kambing_etawa.price_idr = Math.round(local.daging_sapi * 5.8 * 30); // ~30kg
    }

    results.static = staticPrices;

    // ── 6. SUMMARY — harga per kategori untuk frontend ──
    results.summary = {
      ternak: {
        sapi:    results.sapi_hidup_estimasi?.price_idr || 18000000,
        kambing: staticPrices.kambing_etawa.price_idr,
        domba:   staticPrices.domba_garut.price_idr,
        kerbau:  staticPrices.kerbau_lokal.price_idr,
      },
      unggas: {
        ayam:    results.ayam_hidup_estimasi?.price_idr || 42000,
        bebek:   staticPrices.bebek_mojosari.price_idr,
        puyuh:   staticPrices.puyuh_layer.price_idr,
      },
      aquaculture: {
        lele:    staticPrices.lele_sangkuriang.price_idr,
        nila:    staticPrices.nila_gift.price_idr,
        udang:   staticPrices.udang_vaname.price_idr,
        gurame:  staticPrices.gurame_soang.price_idr,
        kerapu:  staticPrices.kerapu_macan.price_idr,
      },
      tanaman: {
        padi:    staticPrices.padi_ciherang.price_idr,
        jagung:  staticPrices.jagung_pakan.price_idr,
        kedelai: staticPrices.kedelai_anjasmoro.price_idr,
        cabai:   local.cabai_merah_keriting || staticPrices.cabai_merah_besar.price_idr,
        bawang:  local.bawang_merah || staticPrices.bawang_brebes.price_idr,
      },
      perkebunan: {
        sawit:    staticPrices.sawit_tbs.price_idr,
        kopi:     staticPrices.kopi_arabika_gayo.price_idr,
        kakao:    staticPrices.kakao_fermentasi.price_idr,
        karet:    staticPrices.karet_gt1?.price_idr || results.natural_rubber?.price_idr || 19500,
        kelapa:   staticPrices.kelapa_bulat.price_idr,
      },
      insekta: {
        maggot:  staticPrices.maggot_bsf_fresh.price_idr,
        madu:    staticPrices.madu_apis.price_idr,
        jangkrik: staticPrices.jangkrik.price_idr,
      },
      pakan: {
        dedak:   staticPrices.dedak_padi.price_idr,
        jagung:  staticPrices.jagung_pakan.price_idr,
        bkedelai:staticPrices.bungkil_kedelai.price_idr,
        tikan:   staticPrices.tepung_ikan.price_idr,
      }
    };

    results.timestamp = new Date().toISOString();
    results.next_update = new Date(Date.now() + 1800000).toISOString();
    results.coverage = '50+ komoditas hayati Indonesia';

    res.status(200).json(results);

  } catch(error) {
    res.status(500).json({ error: error.message });
  }
}
