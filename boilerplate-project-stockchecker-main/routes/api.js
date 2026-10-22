'use strict';

const https = require('https');
const crypto = require('crypto');

const PROXY = 'https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/';

// In-memory store: SYMBOL -> Set of anonymized (hashed) IPs that liked it
const likesDb = new Map();
// Last known good price per symbol, used if the proxy hiccups
const priceCache = new Map();

function anonymizeIp(ip) {
  return crypto
    .createHash('sha256')
    .update(String(ip || '') + (process.env.IP_SALT || 'stockchecker-salt'))
    .digest('hex');
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (resp) => {
      let body = '';
      resp.on('data', (c) => (body += c));
      resp.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Bad JSON from proxy')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Proxy timeout')));
    req.on('error', reject);
  });
}

// The proxy can return the price under different fields / as a string / as null.
function extractPrice(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data.latestPrice, data.iexRealtimePrice, data.delayedPrice,
    data.extendedPrice, data.close, data.previousClose, data.price
  ];
  for (const c of candidates) {
    const n = typeof c === 'string' ? parseFloat(c) : c;
    if (typeof n === 'number' && isFinite(n)) return n;
  }
  return null;
}

async function fetchPrice(symbol) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const data = await getJson(PROXY + encodeURIComponent(symbol) + '/quote');
      const price = extractPrice(data);
      if (price !== null) {
        priceCache.set(symbol, price);
        return price;
      }
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  if (priceCache.has(symbol)) return priceCache.get(symbol);
  throw lastErr || new Error('No price for ' + symbol);
}

async function getStock(symbol, like, ipHash) {
  symbol = String(symbol).toUpperCase();
  if (!likesDb.has(symbol)) likesDb.set(symbol, new Set());
  if (like) likesDb.get(symbol).add(ipHash); // Set => 1 like per IP
  const price = await fetchPrice(symbol); // throws if unavailable
  return { stock: symbol, price, likes: likesDb.get(symbol).size };
}

module.exports = function (app) {

  app.route('/api/stock-prices')
    .get(async function (req, res) {
      try {
        let { stock, like } = req.query;
        const doLike = like === 'true' || like === true;
        const ipHash = anonymizeIp(req.ip);

        if (!stock) return res.status(400).json({ error: 'stock is required' });

        if (Array.isArray(stock)) {
          const [a, b] = stock.slice(0, 2);
          // sequential, not parallel: gentler on the proxy
          const s1 = await getStock(a, doLike, ipHash);
          const s2 = await getStock(b, doLike, ipHash);
          const diff = s1.likes - s2.likes;
          return res.json({
            stockData: [
              { stock: s1.stock, price: s1.price, rel_likes: diff },
              { stock: s2.stock, price: s2.price, rel_likes: -diff }
            ]
          });
        }

        const s = await getStock(stock, doLike, ipHash);
        return res.json({ stockData: s });
      } catch (err) {
        return res.status(502).json({ error: 'Could not fetch stock data', detail: err.message });
      }
    });

};
