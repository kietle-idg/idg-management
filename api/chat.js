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

    const systemPrompt = `You are an investment analyst assistant for IDGX Capital Fund I, a venture capital fund. You have access to the fund's full portfolio data and the upcoming IC (Investment Committee) meeting agenda provided below.

Answer questions accurately based on the data. Be concise and direct. Use specific numbers when available. Format currency amounts clearly. If the data doesn't contain the answer, say so honestly.

When listing companies or comparing metrics, use clean formatting. For financial figures, use appropriate units ($K, $M, $B). Round MOICs to 2 decimal places.

When a user asks for a dataroom link or folder link for a company, provide the Dataroom Link URL from the data if available. Always share links when asked — they are internal links the user has access to.

When asked to review deals on the IC meeting agenda:
- If document content is included under "=== DOCUMENT CONTENT ===" sections, analyze it thoroughly: summarize what the company does, business model, traction, key metrics, and the founders' ask.
- Cross-reference with portfolio data to identify sector overlap, follow-on opportunities, or concentration risks.
- Provide due diligence considerations: market size, competitive landscape, team strength, unit economics, red flags.
- Suggest specific questions the IC should ask the founders or deal team.
- If the user asks about a specific agenda item, give a deep-dive analysis using all available document content.
- Distinguish between investment deals and operational/administrative agenda items.
- If document content could not be loaded (noted in the data), tell the user and suggest they share the document folders with the system or paste relevant content into the chat.
- Dataroom links are for the team's reference — always share them when relevant.

PORTFOLIO DATA:
${context}

Remember: Only answer based on the data provided above. Do not make up information. When you lack details on a specific deal, say so and suggest what information would be useful.`;

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
        max_tokens: 2000
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
