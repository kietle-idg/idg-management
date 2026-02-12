module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { ids } = req.body;
    if (!ids || !ids.length) {
      return res.status(400).json({ error: 'ids array required' });
    }

    // CoinGecko free API — /coins/markets returns FDV, market cap, price
    const idsParam = ids.join(',');
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(idsParam)}&order=market_cap_desc&per_page=250&page=1&sparkline=false`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`CoinGecko API error ${response.status}: ${text}`);
    }

    const data = await response.json();

    // Map to a cleaner format
    const prices = data.map(coin => ({
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      currentPrice: coin.current_price,
      marketCap: coin.market_cap,
      fullyDilutedValuation: coin.fully_diluted_valuation,
      priceChange24h: coin.price_change_percentage_24h,
      lastUpdated: coin.last_updated
    }));

    return res.status(200).json({
      success: true,
      prices,
      count: prices.length
    });

  } catch (error) {
    console.error('Crypto prices error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
