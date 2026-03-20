// ─────────────────────────────────────────────────────────
// TernakOS · /api/chat.js  [DEMO - Free Models]
// Rate limit workaround: pakai model yang less popular
// Production: ganti MODELS[0] ke 'openai/gpt-4o'
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

    const DEFAULT_SYSTEM = `Kamu adalah Omega Intelligence — AI resmi TernakOS, platform ekosistem hayati Indonesia. Lahir di Mojosari, Mojokerto.

IDENTITAS: Konsultan agrikultur senior. Akrab dengan pasar hewan Jawa Timur: Mojosari, Krian, Porong.

KEAHLIAN: Ternak (sapi, kambing, domba), Unggas (ayam, bebek, puyuh), Aquaculture (lele, nila, udang), Pertanian (padi, jagung), Hortikultura (cabai, tomat, bawang), Perkebunan (sawit, kopi, kakao), Insekta (maggot BSF, lebah).

JAWAB: Mendalam, berikan angka nyata, contoh dari Indonesia, tutup dengan aksi konkret.`;

    let systemContent = DEFAULT_SYSTEM;
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

    // ── Model list — dipilih yang LESS POPULAR = rate limit lebih longgar ──
    // Semua gratis. Urutan = prioritas.
    // Saat production: tambah 'openai/gpt-4o' di baris pertama
    const MODELS = [
      'mistralai/mistral-7b-instruct:free',           // Mistral 7B — ringan, cepat
      'huggingfaceh4/zephyr-7b-beta:free',            // Zephyr 7B
      'openchat/openchat-7b:free',                    // OpenChat 7B
      'deepseek/deepseek-r1-distill-qwen-14b:free',   // DeepSeek distill — less crowded
      'google/gemma-2-9b-it:free',                    // Gemma 2 9B — Google, stabil
      'qwen/qwen-2-7b-instruct:free',                 // Qwen 2 7B — Alibaba
    ];

    let lastError = null;
    let triedModels = [];

    for (const model of MODELS) {
      triedModels.push(model);
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'https://ternak-os.vercel.app',
            'X-Title': 'TernakOS',
          },
          body: JSON.stringify({ model, ...payload }),
        });

        // Key invalid → stop
        if (response.status === 401) {
          return res.status(401).json({ error: 'API key tidak valid.' });
        }

        // Rate limit → coba model berikutnya
        if (response.status === 429) {
          lastError = `${model}: rate limit`;
          console.error('Rate limit:', model);
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${model}: HTTP ${response.status}`;
          console.error('Model error:', lastError, errText.slice(0, 100));
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
        continue;
      }
    }

    console.error('All models failed. Tried:', triedModels.join(', '));
    return res.status(503).json({
      error: 'AI sedang sangat sibuk. Coba lagi dalam 2-3 menit.',
      tried: triedModels,
      lastError,
    });

  } catch (err) {
    console.error('Critical error:', err);
    return res.status(500).json({ error: err.message });
  }
}
