/**
 * Token-bucket rate limiter for Bedrock InvokeModel calls.
 *
 * Bedrock's per-account RPM limits vary by model. Defaults below match
 * conservative on-demand quotas for `us-west-2`:
 *   Haiku 4.5 inference profile: 1000 RPM (~16.6 RPS)
 *   Sonnet 4.5 inference profile:  200 RPM (~3.3 RPS)
 * A successful client-side rate limiter is cheaper than retrying after a
 * ThrottlingException — every retry burns ~500ms of wall-clock and a
 * full request-id round-trip.
 *
 * The limiter runs in-process (no Redis). Per-pod limits add up on a
 * cluster, so set BEDROCK_RPM_HAIKU and BEDROCK_RPM_SONNET to the
 * per-pod budget if multiple workers share an account quota.
 */

const _DEFAULT_RPM = {
   haiku: Number(process.env.BEDROCK_RPM_HAIKU || 600),    // safety margin under 1000
   sonnet: Number(process.env.BEDROCK_RPM_SONNET || 120)   // safety margin under 200
};

class TokenBucket {
   constructor({ ratePerSecond, burst }) {
      this.ratePerSecond = ratePerSecond;
      this.burst = burst;
      this.tokens = burst;
      this.lastRefill = Date.now();
      this.queue = [];
   }
   _refill() {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
      this.lastRefill = now;
   }
   async acquire() {
      this._refill();
      if (this.tokens >= 1) {
         this.tokens -= 1;
         return;
      }
      const waitMs = Math.max(50, ((1 - this.tokens) / this.ratePerSecond) * 1000);
      await new Promise(r => setTimeout(r, waitMs));
      return this.acquire();
   }
}

const _buckets = {
   haiku: new TokenBucket({ ratePerSecond: _DEFAULT_RPM.haiku / 60, burst: Math.max(5, Math.floor(_DEFAULT_RPM.haiku / 60)) }),
   sonnet: new TokenBucket({ ratePerSecond: _DEFAULT_RPM.sonnet / 60, burst: Math.max(2, Math.floor(_DEFAULT_RPM.sonnet / 60)) })
};

const _bucketForModel = modelId => {
   if (!modelId) return null;
   const id = String(modelId).toLowerCase();
   if (id.includes('haiku')) return _buckets.haiku;
   if (id.includes('sonnet')) return _buckets.sonnet;
   return null;
};

const acquireSlot = async modelId => {
   const bucket = _bucketForModel(modelId);
   if (!bucket) return;
   await bucket.acquire();
};

const _resetForTest = () => {
   _buckets.haiku = new TokenBucket({ ratePerSecond: _DEFAULT_RPM.haiku / 60, burst: Math.max(5, Math.floor(_DEFAULT_RPM.haiku / 60)) });
   _buckets.sonnet = new TokenBucket({ ratePerSecond: _DEFAULT_RPM.sonnet / 60, burst: Math.max(2, Math.floor(_DEFAULT_RPM.sonnet / 60)) });
};

module.exports = { acquireSlot, _resetForTest, TokenBucket };
