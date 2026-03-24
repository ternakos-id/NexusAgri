// /api/test.js — diagnosa AI error
// Deploy ini, buka /api/test di browser, lihat hasilnya

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const KEY = process.env.OPENROUTER_API_KEY;
  
  const result = {
    timestamp: new Date().toISOString(),
    key_exists: !!KEY,
    key_prefix: KEY ? KEY.slice(0, 15) + '...' : 'NOT SET',
    key_length: KEY ? KEY.length : 0,
  };

  if (!KEY) {
    return res.status(200).json({ ...result, status: 'ERROR: Key tidak ada di env' });
  }

  // Test call ke OpenRouter
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEY}`,
        'HTTP-Referer': 'https://nexusagri.vercel.app',
        'X-Title': 'NexusAgri Test',
      },
      body: JSON.stringify({
        model: 'mistralai/mistral-7b-instruct:free',
        messages: [{ role: 'user', content: 'Halo, jawab dengan kata "OK" saja.' }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const text = await r.text();
    
    result.openrouter_status = r.status;
    result.openrouter_ok = r.ok;
    result.openrouter_response = text.slice(0, 500);
    
    if (r.ok) {
      const data = JSON.parse(text);
      result.ai_reply = data.choices?.[0]?.message?.content || 'empty';
      result.status = 'SUCCESS — AI jalan!';
    } else {
      result.status = `ERROR HTTP ${r.status}: ${text.slice(0, 200)}`;
    }

  } catch (e) {
    result.status = 'ERROR: ' + e.message;
    result.error_type = e.constructor.name;
  }

  return res.status(200).json(result);
}
