// ─────────────────────────────────────────────────────────
// NexusAgri · /api/chat.js
// Model: gratis via OpenRouter, fallback chain
// Ganti ke 'openai/gpt-4o' saat siap production berbayar
// ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, max_tokens } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });

    const SYSTEM = `Kamu adalah Omega Intelligence — AI resmi NexusAgri, platform ekosistem hayati Indonesia. Lahir di Mojosari, Mojokerto, Jawa Timur.

IDENTITAS: Konsultan agrikultur senior. Akrab dengan pasar hewan Jawa Timur: Mojosari, Krian, Porong. Jawab mendalam, berikan angka nyata harga pasar Indonesia, contoh dari lapangan, tutup dengan aksi konkret.

KEAHLIAN: Ternak (sapi, kambing, domba, kuda, kerbau), Unggas (ayam, bebek, puyuh), Aquaculture (lele, nila, udang, gurame, kerapu), Pertanian (padi, jagung, kedelai), Hortikultura (cabai, tomat, bawang), Perkebunan (sawit, kopi, kakao, karet), Insekta (maggot BSF, lebah, jangkrik), Herbal (jahe, kunyit, temulawak).

PLATFORM: NexusAgri punya fitur QR Tag hewan, Health Screening AI, Market Intelligence, Marketplace, ROI Calculator, AI Chat. Tier: STARTER (gratis), PETANI (Rp149rb), PETERNAK PRO (Rp299rb), OMEGA ELITE (Rp599rb).`;

    // Pisahkan system message dari frontend jika ada
    let systemContent = SYSTEM;
    let chatMessages = messages;
    if (messages[0]?.role === 'system') {
      systemContent = messages[0].content;
      chatMessages = messages.slice(1);
    }

    const payload = {
      messages: [{ role: 'system', content: systemContent }, ...chatMessages],
      max_tokens: max_tokens || 1500,
      temperature: 0.7,
    };

    // ── Model chain: coba satu-satu sampai berhasil ──
    // Untuk production: taruh 'openai/gpt-4o' di baris pertama
    const MODELS = [
      'deepseek/deepseek-chat-v3-0324:free',
      'google/gemma-3-27b-it:free',
      'meta-llama/llama-4-scout:free',
      'microsoft/mai-ds-r1:free',
      'deepseek/deepseek-r1:free',
    ];

    let lastErr = null;
    for (const model of MODELS) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'https://nexusagri.vercel.app',
            'X-Title': 'NexusAgri Omega Intelligence',
          },
          body: JSON.stringify({ model, ...payload }),
        });

        // Key invalid → stop immediately
        if (r.status === 401) {
          return res.status(401).json({ error: 'API key tidak valid. Cek OPENROUTER_API_KEY di Vercel.' });
        }

        // Rate limit atau model down → coba berikutnya
        if (!r.ok) {
          lastErr = `${model}: HTTP ${r.status}`;
          console.error(lastErr);
          continue;
        }

        const data = await r.json();
        if (data.choices?.[0]?.message?.content) {
          data._model = model;
          return res.status(200).json(data);
        }

        lastErr = `${model}: empty response`;
        continue;

      } catch (e) {
        lastErr = `${model}: ${e.message}`;
        continue;
      }
    }

    // Semua model gagal
    return res.status(503).json({
      error: 'AI sedang sibuk. Coba lagi dalam 1-2 menit.',
      detail: lastErr,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
