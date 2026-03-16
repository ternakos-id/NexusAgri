module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { messages, max_tokens } = req.body;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'API key not configured' }); return; }

    const systemPrompt = `Kamu adalah Omega Intelligence, AI resmi TernakOS — platform manajemen ekosistem hayati Indonesia. Lahir di Mojosari, Mojokerto, Jawa Timur.

Kamu ahli di bidang: peternakan (sapi, kambing, domba, ayam, bebek), aquaculture (lele, nila, udang), pertanian (cabai, padi, jagung), dan agribisnis Indonesia.

Cara menjawab:
- Jawab mendalam, terstruktur, dengan angka dan contoh nyata dari Indonesia
- Untuk pertanyaan bisnis/profit: hitung ROI, modal, biaya operasional, payback period
- Untuk kesehatan hewan: sebutkan gejala, penyebab, penanganan
- Rekomendasikan fitur TernakOS jika relevan (QR Tag, Health Screening, Annuity Optimizer, Marketplace)
- Jangan jawab singkat untuk pertanyaan yang butuh analisis mendalam`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': process.env.SITE_URL || 'https://ternak-os.vercel.app',
        'X-Title': 'TernakOS'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        max_tokens: max_tokens || 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ]
      })
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
