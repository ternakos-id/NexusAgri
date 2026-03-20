// ─────────────────────────────────────────────────────────
// NexusAgri (formerly TernakOS) · /api/chat.js
// AI Engine: Anthropic Claude (claude-haiku-4-5) — FREE TIER
// Fallback: OpenRouter Free Models
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

    // ── Extract system prompt ──────────────────────────────
    const DEFAULT_SYSTEM = `Kamu adalah Omega Intelligence — AI resmi NexusAgri, platform ekosistem hayati dan kecerdasan bumi Indonesia.

IDENTITAS: Konsultan agrikultur senior. Lahir dari ekosistem peternakan Mojosari, Mojokerto, Jawa Timur. Built for the World.

KEAHLIAN UTAMA:
• Ternak: sapi, kambing, domba, kerbau, babi, kuda
• Unggas: ayam (broiler, layer, kampung), bebek, puyuh
• Aquaculture: lele, nila, gurame, udang vaname, kerapu
• Pertanian: padi, jagung, kedelai, singkong
• Hortikultura: cabai, tomat, bawang merah & putih
• Perkebunan: kelapa sawit, karet, kopi, kakao, kelapa
• Insekta: maggot BSF, lebah madu, jangkrik
• Tanaman Obat: jahe, kunyit, temulawak

PASAR YANG KAU PAHAMI: Harga real pasar Mojosari, Mojokerto, Jawa Timur, dan nasional.

GAYA MENJAWAB:
• Langsung ke inti, tidak bertele-tele
• Berikan angka nyata (harga, dosis, waktu, bobot)
• Contoh dari lapangan, bukan teori
• Tutup dengan 1 aksi konkret yang bisa dilakukan hari ini
• Jawab dalam bahasa yang sama dengan pertanyaan user`;

    let systemContent = DEFAULT_SYSTEM;
    let chatMessages = messages;

    if (messages[0]?.role === 'system') {
      systemContent = messages[0].content;
      chatMessages = messages.slice(1);
    }

    const maxTok = max_tokens || 1000;

    // ── PRIMARY: Anthropic Claude API ─────────────────────
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (anthropicKey) {
      try {
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',  // Fastest & cheapest Claude model
            max_tokens: maxTok,
            system: systemContent,
            messages: chatMessages.map(m => ({
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content
            })),
          }),
        });

        if (anthropicRes.ok) {
          const data = await anthropicRes.json();
          // Convert Anthropic format → OpenAI-compatible format
          // (frontend expects choices[0].message.content)
          const text = data.content?.[0]?.text || '';
          return res.status(200).json({
            choices: [{
              message: { role: 'assistant', content: text },
              finish_reason: data.stop_reason || 'end_turn'
            }],
            model: data.model,
            usage: data.usage
          });
        }

        // Rate limit or quota — fall through to backup
        if (anthropicRes.status === 429 || anthropicRes.status === 529) {
          console.warn('Anthropic rate limited, falling back to OpenRouter');
        } else {
          const errText = await anthropicRes.text();
          console.error('Anthropic error:', anthropicRes.status, errText.slice(0, 200));
        }

      } catch (anthropicErr) {
        console.error('Anthropic fetch error:', anthropicErr.message);
      }
    }

    // ── FALLBACK: OpenRouter Free Models ──────────────────
    const openrouterKey = process.env.OPENROUTER_API_KEY;

    if (!openrouterKey && !anthropicKey) {
      return res.status(500).json({
        error: 'Tidak ada API key tersedia. Set ANTHROPIC_API_KEY di Vercel Environment Variables.'
      });
    }

    if (openrouterKey) {
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + openrouterKey,
          'HTTP-Referer': 'https://nexusagri.vercel.app',
          'X-Title': 'NexusAgri Omega Intelligence',
        },
        body: JSON.stringify({
          model: 'openrouter/auto', // auto-select best free model
          messages: [
            { role: 'system', content: systemContent },
            ...chatMessages,
          ],
          max_tokens: maxTok,
          temperature: 0.7,
        }),
      });

      if (orRes.status === 401) {
        return res.status(401).json({ error: 'API key tidak valid.' });
      }

      if (!orRes.ok) {
        const errText = await orRes.text();
        console.error('OpenRouter error:', orRes.status, errText);
        return res.status(503).json({
          error: 'AI sedang sibuk. Coba lagi dalam 1-2 menit.',
        });
      }

      const data = await orRes.json();
      if (data.choices?.[0]?.message?.content) {
        return res.status(200).json(data);
      }
    }

    return res.status(503).json({ error: 'AI tidak dapat merespons. Coba lagi.' });

  } catch (err) {
    console.error('api/chat error:', err);
    return res.status(500).json({ error: err.message });
  }
}
