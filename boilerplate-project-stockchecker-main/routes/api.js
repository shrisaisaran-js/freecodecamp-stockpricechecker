'use strict';
const crypto = require('crypto');
const https = require('https');

const PROXY =
  process.env.STOCK_PROXY ||
  'https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock';

// stock symbol -> Set of anonymized (hashed) IPs that liked it.
// (In-memory; swap for a database if you want likes to survive restarts.)
const likesDb = {};

// Anonymize IP: salted SHA-256 hash. The raw IP is never stored.
function anonymizeIp(ip) {
  const salt = process.env.IP_SALT || 'stockchecker-salt';
  return crypto.createHash('sha256').update(salt + ip).digest('hex');
}

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = fwd ? fwd.split(',')[0].trim() : req.ip || req.connection.remoteAddress;
  return ip || '0.0.0.0';
}

function getJson(url) {
  const lib = url.startsWith('http://') ? require('http') : https;
  return new Promise((resolve, reject) => {
    lib
      .get(url, (resp) => {
        let body = '';
        resp.on('data', (c) => (body += c));
        resp.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { resolve({}); }
        });
      })
      .on('error', reject);
  });
}

async function getPrice(symbol) {
  const data = await getJson(`${PROXY}/${encodeURIComponent(symbol)}/quote`);
  const price = Number(data && data.latestPrice);
  return Number.isFinite(price) && data.latestPrice !== null ? price : null;
}

function getLikes(symbol) {
  return likesDb[symbol] ? likesDb[symbol].size : 0;
}

function addLike(symbol, hashedIp) {
  if (!likesDb[symbol]) likesDb[symbol] = new Set();
  likesDb[symbol].add(hashedIp); // Set => only 1 like per IP
}

module.exports = function (app) {
  app.route('/api/stock-prices').get(async function (req, res) {
    try {
      let stocks = req.query.stock;
      if (!stocks) return res.json({ error: 'stock query parameter required' });
      if (!Array.isArray(stocks)) stocks = [stocks];
      stocks = stocks.slice(0, 2).map((s) => String(s).trim().toUpperCase());

      const like = req.query.like === 'true' || req.query.like === true;
      const hashedIp = anonymizeIp(getIp(req));

      if (like) stocks.forEach((s) => addLike(s, hashedIp));

      const results = await Promise.all(
        stocks.map(async (s) => ({
          stock: s,
          price: await getPrice(s),
          likes: getLikes(s),
        }))
      );

      if (results.length === 1) {
        const r = results[0];
        if (r.price === null) return res.json({ stockData: { likes: r.likes } });
        return res.json({ stockData: { stock: r.stock, price: r.price, likes: r.likes } });
      }

      const [a, b] = results;
      const stockData = [
        { stock: a.stock, price: a.price, rel_likes: a.likes - b.likes },
        { stock: b.stock, price: b.price, rel_likes: b.likes - a.likes },
      ];
      res.json({ stockData });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });
};
