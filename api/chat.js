module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

    const { messages, context } = req.body;
    if (!messages || !messages.length) return res.status(400).json({ error: 'messages required' });

    const systemPrompt = `You are an investment analyst assistant for IDGX Capital Fund I, a venture capital fund. You have access to the fund's full portfolio data provided below.

Answer questions accurately based on the data. Be concise and direct. Use specific numbers when available. Format currency amounts clearly. If the data doesn't contain the answer, say so honestly.

When listing companies or comparing metrics, use clean formatting. For financial figures, use appropriate units ($K, $M, $B). Round MOICs to 2 decimal places.

PORTFOLIO DATA:
${context}

Remember: Only answer based on the data provided above. Do not make up information.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: 0.3,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI error: ${errData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const answer = data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

    return res.status(200).json({ success: true, answer });

  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
