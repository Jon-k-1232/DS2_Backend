const { TokenBucket } = require('../../../src/ai_integrations/bedrock/rateLimiter');

describe('Bedrock rate limiter (TokenBucket)', () => {
   it('lets through bursts up to capacity without delay', async () => {
      const b = new TokenBucket({ ratePerSecond: 10, burst: 5 });
      const t = Date.now();
      for (let i = 0; i < 5; i++) await b.acquire();
      expect(Date.now() - t).to.be.lessThan(50);
   });

   it('throttles a 6th call when burst is 5', async function () {
      this.timeout(2000);
      const b = new TokenBucket({ ratePerSecond: 10, burst: 5 });
      for (let i = 0; i < 5; i++) await b.acquire();
      const t = Date.now();
      await b.acquire();
      // 6th call needs ~100ms (one token at 10/s).
      expect(Date.now() - t).to.be.greaterThan(50);
   });

   it('refills tokens over time', async function () {
      this.timeout(2000);
      const b = new TokenBucket({ ratePerSecond: 20, burst: 2 });
      await b.acquire();
      await b.acquire();
      await new Promise(r => setTimeout(r, 200));  // ~4 tokens refilled
      const t = Date.now();
      await b.acquire();
      await b.acquire();
      expect(Date.now() - t).to.be.lessThan(50);
   });

   it('serializes a queue of waiters fairly', async function () {
      this.timeout(2000);
      const b = new TokenBucket({ ratePerSecond: 50, burst: 1 });
      await b.acquire();  // empty the bucket
      const start = Date.now();
      const order = [];
      const promises = [
         b.acquire().then(() => order.push(1)),
         b.acquire().then(() => order.push(2)),
         b.acquire().then(() => order.push(3))
      ];
      await Promise.all(promises);
      expect(order).to.deep.equal([1, 2, 3]);
      // 3 acquires after empty at 50 RPS = ~60ms
      expect(Date.now() - start).to.be.greaterThan(40);
   });
});
