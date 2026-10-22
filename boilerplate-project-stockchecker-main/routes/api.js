'use strict';
const crypto = require('crypto');

const PROXY =
  process.env.STOCK_PROXY ||
  'https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock';

// symbol -> Set of hashed IPs that liked it (raw IPs are never stored)
const likesDb = new Map();

// short-lived quote cache + in-flight de-duplication to avoid hammering the proxy
const cache = new Map();     // symbol -> { at, value }
const inflight = new Map();  // symbol -> Promise
const TTL = 15000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function anonymise(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex');
}

async function fetchQuote(symbol) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${PROXY}/${encodeURIComponent(symbol)}/quote`, {
        signal: AbortSignal.timeout(5000)
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('non-JSON response'); }
      if (typeof data === 'string' || !data || data.latestPrice === undefined || data.latestPrice === null) {
        return null; // genuinely unknown symbol
      }
      return { stock: data.symbol || symbol, price: Number(data.latestPrice) };
    } catch (err) {
      lastErr = err;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
}

function getStock(symbol) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
  if (inflight.has(symbol)) return inflight.get(symbol);
  const p = fetchQuote(symbol)
    .then(value => {
      if (value) cache.set(symbol, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(symbol));
  inflight.set(symbol, p);
  return p;
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

      const infos = await Promise.all(symbols.map(getStock));
      const bad = infos.findIndex(i => !i);
      if (bad !== -1) return res.json({ error: 'invalid symbol', stock: symbols[bad] });

      // apply likes for ALL symbols first, then read counts
      if (wantsLike) symbols.forEach(sym => addLike(sym, hash));
      const results = infos.map((info, i) => ({
        stock: info.stock,
        price: info.price,
        likes: likesFor(symbols[i])
      }));

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
