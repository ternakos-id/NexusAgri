// ─────────────────────────────────────────────────────────
// TernakOS · /api/chat.js
// Model: openrouter/free (auto-router, pilih sendiri yg aktif)
// Production nanti: ganti ke 'openai/gpt-4o'
// ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, max_tokens } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });
    }

    const DEFAULT_SYSTEM = `Kamu adalah Omega Intelligence — AI resmi TernakOS, platform ekosistem hayati Indonesia. Lahir di Mojosari, Mojokerto, Jawa Timur.

IDENTITAS: Konsultan agrikultur senior. Akrab dengan pasar hewan Jawa Timur: Mojosari, Krian, Porong.

KEAHLIAN: Ternak (sapi, kambing, domba), Unggas (ayam, bebek, puyuh), Aquaculture (lele, nila, udang), Pertanian (padi, jagung), Hortikultura (cabai, tomat, bawang), Perkebunan (sawit, kopi, kakao), Insekta (maggot BSF, lebah).

JAWAB: Mendalam, berikan angka nyata harga pasar Indonesia, contoh dari lapangan, tutup dengan aksi konkret.`;

    let systemContent = DEFAULT_SYSTEM;
    let chatMessages = messages;
    if (messages[0]?.role === 'system') {
      systemContent = messages[0].content;
      chatMessages = messages.slice(1);
    }

    // ── openrouter/free: auto-router resmi, pilih model aktif sendiri ──
    // Tidak perlu hardcode nama model → tidak akan kena 404 lagi
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://ternak-os.vercel.app',
        'X-Title': 'TernakOS Omega Intelligence',
      },
      body: JSON.stringify({
        model: 'openrouter/free',   // ← auto-router gratis resmi OpenRouter
        messages: [
          { role: 'system', content: systemContent },
          ...chatMessages,
        ],
        max_tokens: max_tokens || 1500,
        temperature: 0.7,
      }),
    });

    if (response.status === 401) {
      return res.status(401).json({ error: 'API key tidak valid. Cek OPENROUTER_API_KEY di Vercel.' });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenRouter error:', response.status, errText);
      return res.status(503).json({
        error: 'AI sedang sibuk. Coba lagi dalam 1-2 menit.',
        detail: errText.slice(0, 200),
      });
    }

    const data = await response.json();

    if (data.choices?.[0]?.message?.content) {
      return res.status(200).json(data);
    }

    return res.status(503).json({ error: 'AI tidak memberikan respons. Coba lagi.' });

  } catch (err) {
    console.error('api/chat error:', err);
    return res.status(500).json({ error: err.message });
  }
}
