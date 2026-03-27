module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!TAVILY_API_KEY) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const { companyName, website, keywords, sector } = req.body || {};
  if (!companyName) return res.status(400).json({ error: 'companyName required' });

  try {
    const searchResults = await runSearches(TAVILY_API_KEY, companyName, website, keywords, sector);
    const structured = await analyzeWithAI(OPENAI_API_KEY, companyName, searchResults);

    return res.status(200).json({
      success: true,
      companyName,
      data: structured,
      searchStats: {
        newsResults: searchResults.news.length,
        socialResults: searchResults.social.length,
        siteResults: searchResults.site.length
      }
    });
  } catch (error) {
    console.error('Web research error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

async function tavilySearch(apiKey, query, options = {}) {
  const body = {
    query,
    api_key: apiKey,
    max_results: options.max_results || 5,
    search_depth: options.search_depth || 'basic',
    include_raw_content: false,
    ...(options.include_domains?.length && { include_domains: options.include_domains }),
    ...(options.time_range && { time_range: options.time_range })
  };

  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Tavily search failed: ${err}`);
  }

  const data = await resp.json();
  return (data.results || []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    content: (r.content || '').substring(0, 800),
    score: r.score || 0,
    publishedDate: r.published_date || r.publishedDate || null
  }));
}

async function tavilyExtract(apiKey, urls) {
  if (!urls.length) return [];

  const resp = await fetch('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      urls,
      extract_depth: 'basic',
      format: 'text'
    })
  });

  if (!resp.ok) return [];

  const data = await resp.json();
  return (data.results || []).map(r => ({
    title: r.title || new URL(r.url).hostname,
    url: r.url || '',
    content: (r.raw_content || r.content || '').substring(0, 1500)
  }));
}

function buildSearchNames(companyName) {
  const baseName = companyName.replace(/\s*\([^)]+\)/, '').trim();
  const parenMatch = companyName.match(/\(([^)]+)\)/);
  const isRenamed = parenMatch && /renamed|merged|now\s/i.test(parenMatch[0]);
  const isPivoted = /pivoted to/i.test(companyName);

  let newName = null;
  if (parenMatch) {
    newName = parenMatch[1].replace(/^renamed as\s*/i, '').replace(/^merged as\s*/i, '').replace(/^now\s*/i, '').trim();
  }
  if (isPivoted) {
    const m = companyName.match(/pivoted to\s+(\w+)/i);
    if (m) newName = m[1];
  }

  if ((isRenamed || isPivoted) && newName) {
    return [newName, baseName].filter(n => n.length > 1);
  }
  if (newName) {
    return [baseName, newName].filter(n => n.length > 1);
  }
  return [baseName].filter(n => n.length > 1);
}

async function runSearches(apiKey, companyName, website, keywords, sector) {
  const names = buildSearchNames(companyName);
  const extra = keywords ? ` ${keywords}` : '';
  const sectorHint = (sector && /blockchain|crypto|defi|web3|fintech/i.test(sector)) ? ' crypto blockchain' : '';

  const queryParts = names.map(n => `"${n}"`).join(' OR ');
  const primaryQuery = `${queryParts}${extra}${sectorHint} latest news updates`;

  const searches = [
    tavilySearch(apiKey, primaryQuery, {
      max_results: 5,
      search_depth: 'basic',
      time_range: 'month'
    }),

    tavilySearch(apiKey, `${queryParts}${sectorHint}`, {
      max_results: 3,
      search_depth: 'basic',
      include_domains: ['twitter.com', 'x.com'],
      time_range: 'month'
    }),

    website
      ? tavilyExtract(apiKey, [website]).catch(() => [])
      : Promise.resolve([])
  ];

  const [news, social, site] = await Promise.all(searches);
  return { news, social, site };
}

async function analyzeWithAI(apiKey, companyName, searchResults) {
  let context = `Company: "${companyName}"\n\n`;

  if (searchResults.news.length) {
    context += '=== RECENT NEWS & WEB RESULTS ===\n';
    for (const r of searchResults.news) {
      const dateStr = r.publishedDate ? ` [Published: ${r.publishedDate}]` : '';
      context += `\n[${r.title}]${dateStr} (${r.url})\n${r.content}\n`;
    }
  }

  if (searchResults.social.length) {
    context += '\n=== TWITTER / X MENTIONS ===\n';
    for (const r of searchResults.social) {
      const dateStr = r.publishedDate ? ` [Published: ${r.publishedDate}]` : '';
      context += `\n[${r.title}]${dateStr} (${r.url})\n${r.content}\n`;
    }
  }

  if (searchResults.site.length) {
    context += '\n=== COMPANY WEBSITE CONTENT ===\n';
    for (const r of searchResults.site) {
      context += `\n[${r.title}] (${r.url})\n${r.content}\n`;
    }
  }

  const totalResults = searchResults.news.length + searchResults.social.length + searchResults.site.length;
  if (totalResults === 0) {
    return {
      webUpdates: [],
      sentiment: null,
      trendingSummary: 'No recent web results found for this company.'
    };
  }

  const prompt = `You are a venture capital analyst researching a portfolio company's latest public activity.

Based on the web search results below, extract structured intelligence. Return a JSON object with:

- "webUpdates": Array of objects (up to 8, most important first). Each object:
  - "text": One clear sentence summarizing the update
  - "source": Source name (e.g. "TechCrunch", "Twitter", "Company Blog", domain name)
  - "url": The source URL
  - "date": The published date in YYYY-MM-DD format. Extract from [Published: ...] tags, article text, or URL patterns. ALWAYS try to provide a date — never return null if any date hint exists.
  - "category": One of "funding", "product", "partnership", "hiring", "media", "social", "other"

- "sentiment": Overall sentiment — "positive", "neutral", "negative", or "mixed"

- "trendingSummary": 1-2 sentence summary of the company's current public presence and trajectory

IMPORTANT:
- Only include genuinely relevant results about this specific company. Skip unrelated results.
- If a search result is clearly about a different company/entity with a similar name, exclude it.
- For Twitter results, capture the key message/announcement.
- Return ONLY valid JSON, no markdown.

${context}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`OpenAI error: ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content || '{}';
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    return { webUpdates: [], sentiment: null, trendingSummary: 'Could not parse web research results.' };
  }
}
