'use strict';
const crypto = require('crypto');

const PROXY =
  process.env.STOCK_PROXY ||
  'https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock';

// symbol -> Set of hashed IPs that liked it (raw IPs are never stored)
const likesDb = new Map();

function anonymise(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex');
}

async function getStock(symbol) {
  const res = await fetch(`${PROXY}/${encodeURIComponent(symbol)}/quote`);
  const data = await res.json();
  if (!data || data === 'Unknown symbol' || data === 'Invalid symbol' || data.latestPrice === undefined) {
    return null;
  }
  return { stock: data.symbol || symbol.toUpperCase(), price: Number(data.latestPrice) };
}

function likesFor(symbol) {
  return likesDb.has(symbol) ? likesDb.get(symbol).size : 0;
}

function addLike(symbol, hash) {
  if (!likesDb.has(symbol)) likesDb.set(symbol, new Set());
  likesDb.get(symbol).add(hash); // Set => one like per IP
}

module.exports = function (app) {
  app.set('trust proxy', true);

  app.route('/api/stock-prices').get(async (req, res) => {
    try {
      const { stock, like } = req.query;
      if (!stock) return res.json({ error: 'stock query is required' });

      const symbols = (Array.isArray(stock) ? stock : [stock])
        .slice(0, 2)
        .map(s => String(s).toUpperCase());
      const wantsLike = like === true || like === 'true';
      const hash = anonymise(req.ip);

      const results = [];
      for (const sym of symbols) {
        const info = await getStock(sym);
        if (!info) return res.json({ error: 'invalid symbol', stock: sym });
        if (wantsLike) addLike(sym, hash);
        results.push({ ...info, likes: likesFor(sym) });
      }

      if (results.length === 1) return res.json({ stockData: results[0] });

      const [a, b] = results;
      res.json({
        stockData: [
          { stock: a.stock, price: a.price, rel_likes: a.likes - b.likes },
          { stock: b.stock, price: b.price, rel_likes: b.likes - a.likes }
        ]
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'unable to fetch stock data' });
    }
  });
};
