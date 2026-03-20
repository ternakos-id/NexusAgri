// ─────────────────────────────────────────────────────────
// TernakOS · /api/chat.js  [DEMO VERSION - Free Models]
// Setelah platform siap → ganti model ke openai/gpt-4o
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
      return res.status(500).json({ error: 'OPENROUTER_API_KEY not set in Vercel env' });
    }

    // ── System prompt Omega Intelligence ──
    const DEFAULT_SYSTEM = `Kamu adalah Omega Intelligence — AI resmi milik TernakOS, platform manajemen ekosistem hayati pertama di Indonesia. Lahir di Mojosari, Mojokerto, Jawa Timur.

IDENTITAS: Namamu Omega Intelligence. Bicara seperti konsultan agrikultur senior yang memahami teknologi. Akrab dengan konteks Jawa Timur: pasar hewan Mojosari, Krian, Porong.

KEAHLIAN: Ternak (sapi, kambing, domba, kuda, kerbau), Unggas (ayam, bebek, puyuh), Aquaculture (lele, nila, udang, gurame, kerapu), Pertanian (padi, jagung, kedelai), Hortikultura (cabai, tomat, bawang), Perkebunan (sawit, karet, kopi, kakao), Insekta (maggot BSF, lebah, jangkrik), Herbal (jahe, kunyit, temulawak).

CARA MENJAWAB: Mendalam dan terstruktur. Berikan angka nyata: harga pasar, estimasi biaya, ROI. Contoh dari Indonesia. Tutup dengan rekomendasi actionable.`;

    let systemContent = DEFAULT_SYSTEM;
    let chatMessages = messages;
    if (messages.length > 0 && messages[0].role === 'system') {
      systemContent = messages[0].content;
      chatMessages = messages.slice(1);
    }

    const payload = {
      messages: [
        { role: 'system', content: systemContent },
        ...chatMessages,
      ],
      max_tokens: max_tokens || 1500,
      temperature: 0.7,
    };

    // ── Model gratis — urutan dari paling stabil ──
    // Kalau sudah siap production, ganti baris pertama ke: 'openai/gpt-4o'
    const MODELS = [
      'meta-llama/llama-3.3-70b-instruct:free',
      'deepseek/deepseek-r1:free',
      'google/gemini-2.0-flash-thinking-exp:free',
      'nousresearch/hermes-3-llama-3.1-405b:free',
    ];

    let lastError = null;

    for (const model of MODELS) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'https://ternak-os.vercel.app',
            'X-Title': 'TernakOS Omega Intelligence',
          },
          body: JSON.stringify({ model, ...payload }),
        });

        // Key salah → stop, jangan coba model lain
        if (response.status === 401) {
          return res.status(401).json({ error: 'API key tidak valid. Cek OPENROUTER_API_KEY di Vercel.' });
        }

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${model}: HTTP ${response.status} — ${errText.slice(0, 200)}`;
          console.error('Model failed:', lastError);
          continue;
        }

        const data = await response.json();

        if (data.choices?.[0]?.message?.content) {
          data._model_used = model;
          return res.status(200).json(data);
        }

        lastError = `${model}: empty response`;
        continue;

      } catch (fetchErr) {
        lastError = `${model}: ${fetchErr.message}`;
        console.error('Fetch error:', lastError);
        continue;
      }
    }

    console.error('All models failed:', lastError);
    return res.status(503).json({
      error: 'AI sedang sibuk. Coba lagi dalam 1-2 menit.',
      detail: lastError,
    });

  } catch (err) {
    console.error('api/chat critical error:', err);
    return res.status(500).json({ error: err.message });
  }
}
