// ─────────────────────────────────────────────────────────
// TernakOS · /api/chat.js
// Provider: OpenRouter
// Model: google/gemini-2.0-flash-exp:free  (GRATIS, cepat, powerful)
// Fallback: meta-llama/llama-3.1-8b-instruct:free
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

    // ── System prompt Omega Intelligence ──
    const systemPrompt = `Kamu adalah Omega Intelligence — AI resmi milik TernakOS, platform manajemen ekosistem hayati pertama di Indonesia. Kamu lahir di Mojosari, Mojokerto, Jawa Timur dan dibangun untuk peternak, petani, pembudidaya, pedagang kulak, dan pelaku agrikultur Indonesia maupun global.

IDENTITAS:
- Namamu adalah Omega Intelligence, bukan Gemini atau AI umum
- Berbicara seperti konsultan agrikultur senior yang memahami teknologi
- Akrab dengan konteks peternakan Jawa Timur: pasar hewan Mojosari, Krian, Porong
- Jawaban mendalam, terstruktur, dengan contoh nyata dari lapangan Indonesia

EKOSISTEM YANG DIKUASAI:
Ternak (sapi, kambing, domba, kuda, kerbau), Unggas (ayam, bebek, puyuh), Aquaculture (lele, nila, udang, gurame), Pertanian (padi, jagung, kedelai), Hortikultura (cabai, tomat, bawang), Perkebunan (sawit, karet, kopi, kakao), Insekta (maggot BSF, lebah, jangkrik), Herbal (jahe, kunyit, temulawak).

CARA MENJAWAB:
- Jawab mendalam dan terstruktur, gunakan poin bernomor atau tabel jika perlu
- Berikan angka nyata: harga pasar, estimasi biaya, ROI
- Contoh dari Indonesia, khususnya Jawa Timur jika relevan
- Tutup dengan rekomendasi actionable yang bisa langsung diterapkan`;

    // Pisahkan system message kalau sudah ada dari frontend
    let finalSystem = systemPrompt;
    let chatMessages = messages;
    if (messages.length > 0 && messages[0].role === 'system') {
      finalSystem = messages[0].content;
      chatMessages = messages.slice(1);
    }

    // ── Model priority list (semua GRATIS di OpenRouter) ──
    const MODELS = [
      'google/gemini-2.0-flash-exp:free',
      'google/gemini-flash-1.5:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'microsoft/phi-3-mini-128k-instruct:free',
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
          body: JSON.stringify({
            model: model,
            max_tokens: max_tokens || 1500,
            temperature: 0.7,
            messages: [
              { role: 'system', content: finalSystem },
              ...chatMessages,
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${model}: ${response.status} ${errText}`;
          console.error('Model failed:', lastError);
          continue; // coba model berikutnya
        }

        const data = await response.json();

        // Validasi ada isinya
        if (data.choices && data.choices[0] && data.choices[0].message) {
          // Inject model yang dipakai ke response (untuk debugging)
          data._model_used = model;
          return res.status(200).json(data);
        } else {
          lastError = `${model}: empty response`;
          continue;
        }

      } catch (fetchErr) {
        lastError = `${model}: ${fetchErr.message}`;
        continue;
      }
    }

    // Semua model gagal
    return res.status(503).json({
      error: 'Semua model AI tidak tersedia saat ini',
      detail: lastError,
    });

  } catch (err) {
    console.error('api/chat critical error:', err);
    return res.status(500).json({ error: err.message });
  }
}
