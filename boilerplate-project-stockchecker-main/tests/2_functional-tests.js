const chaiHttp = require('chai-http');
const chai = require('chai');
const assert = chai.assert;
const server = require('../server');

chai.use(chaiHttp);

suite('Functional Tests', function () {
  this.timeout(10000);
  let likesBefore;

  test('Viewing one stock: GET request to /api/stock-prices/', function (done) {
    chai.request(server).get('/api/stock-prices').query({ stock: 'GOOG' }).end((err, res) => {
      assert.equal(res.status, 200);
      assert.isObject(res.body.stockData);
      assert.equal(res.body.stockData.stock, 'GOOG');
      assert.isNumber(res.body.stockData.price);
      assert.isNumber(res.body.stockData.likes);
      likesBefore = res.body.stockData.likes;
      done();
    });
  });

  test('Viewing one stock and liking it: GET request to /api/stock-prices/', function (done) {
    chai.request(server).get('/api/stock-prices').query({ stock: 'GOOG', like: true }).end((err, res) => {
      assert.equal(res.status, 200);
      assert.equal(res.body.stockData.stock, 'GOOG');
      assert.isNumber(res.body.stockData.price);
      assert.equal(res.body.stockData.likes, Math.max(likesBefore, 1));
      done();
    });
  });

  test('Viewing the same stock and liking it again: GET request to /api/stock-prices/', function (done) {
    chai.request(server).get('/api/stock-prices').query({ stock: 'GOOG', like: true }).end((err, res) => {
      assert.equal(res.status, 200);
      assert.equal(res.body.stockData.likes, 1); // same IP, no extra like
      done();
    });
  });

  test('Viewing two stocks: GET request to /api/stock-prices/', function (done) {
    chai.request(server).get('/api/stock-prices?stock=AAPL&stock=MSFT').end((err, res) => {
      assert.equal(res.status, 200);
      assert.isArray(res.body.stockData);
      assert.lengthOf(res.body.stockData, 2);
      const [a, b] = res.body.stockData;
      assert.equal(a.stock, 'AAPL');
      assert.equal(b.stock, 'MSFT');
      assert.isNumber(a.price);
      assert.isNumber(b.price);
      assert.property(a, 'rel_likes');
      assert.property(b, 'rel_likes');
      assert.equal(a.rel_likes, -b.rel_likes);
      done();
    });
  });

  test('Viewing two stocks and liking them: GET request to /api/stock-prices/', function (done) {
    chai.request(server).get('/api/stock-prices?stock=AAPL&stock=MSFT&like=true').end((err, res) => {
      assert.equal(res.status, 200);
      assert.isArray(res.body.stockData);
      const [a, b] = res.body.stockData;
      assert.equal(a.stock, 'AAPL');
      assert.equal(b.stock, 'MSFT');
      assert.isNumber(a.price);
      assert.isNumber(b.price);
      assert.equal(a.rel_likes, 0);
      assert.equal(b.rel_likes, 0);
      done();
    });
  });
});
