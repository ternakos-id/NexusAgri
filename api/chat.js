export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY = process.env.OPENROUTER_API_KEY;
  if (!KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY belum diset di Vercel.' });
  }

  // ── FREE MODELS YANG AKTIF MARET 2026 ──
  // Diambil dari /api/v1/models OpenRouter
  const FREE_MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-flash-1.5-8b:free', 
    'meta-llama/llama-3.1-8b-instruct:free',
    'qwen/qwen-2.5-7b-instruct:free',
    'deepseek/deepseek-r1-distill-llama-70b:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    'minimax/minimax-m2.7:free',
  ];

  try {
    const { messages, max_tokens } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const SYSTEM = `Kamu adalah Omega Intelligence — AI konsultan NexusAgri. Spesialis ternak, pertanian, aquaculture Indonesia. Jawab singkat padat dengan angka nyata. Tutup dengan 1 aksi konkret hari ini.`;

    let sysContent = SYSTEM;
    let chatMsgs = messages;
    if (messages[0]?.role === 'system') {
      sysContent = messages[0].content;
      chatMsgs = messages.slice(1);
    }

    const formattedMsgs = [
      { role: 'system', content: sysContent },
      ...chatMsgs.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
    ];

    const errors = [];

    for (const model of FREE_MODELS) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${KEY}`,
            'HTTP-Referer': 'https://nexusagri.vercel.app',
            'X-Title': 'NexusAgri',
          },
          body: JSON.stringify({
            model,
            messages: formattedMsgs,
            max_tokens: max_tokens || 800,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(20000),
        });

        const text = await r.text();

        // Model tidak ada → skip ke berikutnya
        if (r.status === 404) {
          errors.push(`${model}: not found`);
          continue;
        }

        // Rate limit → skip ke berikutnya
        if (r.status === 429) {
          errors.push(`${model}: rate limited`);
          continue;
        }

        // Butuh kredit → skip ke berikutnya
        if (r.status === 402) {
          errors.push(`${model}: requires credits`);
          continue;
        }

        if (!r.ok) {
          errors.push(`${model}: HTTP ${r.status}`);
          continue;
        }

        let data;
        try { data = JSON.parse(text); } catch(e) {
          errors.push(`${model}: invalid JSON`);
          continue;
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          errors.push(`${model}: empty`);
          continue;
        }

        // SUCCESS
        return res.status(200).json({
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
          model: data.model || model,
          usage: data.usage || {}
        });

      } catch (e) {
        errors.push(`${model}: ${e.message}`);
        continue;
      }
    }

    // Semua gagal
    return res.status(503).json({
      error: 'AI sedang overload. Coba lagi dalam beberapa menit.',
      errors
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
