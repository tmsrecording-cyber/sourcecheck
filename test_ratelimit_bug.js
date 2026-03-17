
class InMemoryRateLimitStore {
  constructor() {
    this.buckets = new Map();
  }
  async tryConsume(key, cost, maxPoints, windowMs) {
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || now - current.windowStartedAt >= windowMs) {
      this.buckets.set(key, { points: cost, windowStartedAt: now });
      return true;
    }
    if (current.points + cost > maxPoints) {
      return false;
    }
    this.buckets.set(key, {
      points: current.points + cost,
      windowStartedAt: current.windowStartedAt,
    });
    return true;
  }
}

async function test() {
  const store = new InMemoryRateLimitStore();
  const result = await store.tryConsume('k', 100, 10, 60000);
  console.log('Consume 100 points with maxPoints=10 on fresh bucket:', result);
  if (result === true) {
    console.log('BUG DETECTED: Allowed request exceeding maxPoints on fresh bucket.');
  } else {
    console.log('Correct behavior.');
  }
}
test();
