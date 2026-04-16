import { evaluatePriceDelta, PRICE_DELTA_POLICY } from '../controllers/receiptProcessingService.js';

describe('evaluatePriceDelta', () => {
  const now = new Date();
  const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
  const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

  it('should return no delta if lastPrice is missing', () => {
    const result = evaluatePriceDelta({ lastPrice: null, newPrice: 10.0, lastObservedAt: fifteenDaysAgo, now });
    expect(result.exceedsThreshold).toBe(false);
    expect(result.pctDelta).toBe(0);
  });

  it('should not exceed threshold for a fresh price with a small change', () => {
    const result = evaluatePriceDelta({ lastPrice: 10.0, newPrice: 10.5, lastObservedAt: fifteenDaysAgo, now });
    expect(result.isStale).toBe(false);
    expect(result.exceedsThreshold).toBe(false);
    expect(result.pctDelta).toBeCloseTo(0.05);
  });

  it('should exceed threshold for a fresh price with a large percentage change', () => {
    const result = evaluatePriceDelta({ lastPrice: 10.0, newPrice: 14.0, lastObservedAt: fifteenDaysAgo, now });
    expect(result.isStale).toBe(false);
    expect(result.exceedsThreshold).toBe(true);
    expect(result.pctDelta).toBeCloseTo(0.4);
  });

  it('should exceed threshold for a fresh price with a large absolute change', () => {
    const result = evaluatePriceDelta({ lastPrice: 2.0, newPrice: 3.50, lastObservedAt: fifteenDaysAgo, now });
    expect(result.isStale).toBe(false);
    expect(result.exceedsThreshold).toBe(true);
    expect(result.absDelta).toBeCloseTo(1.50);
  });

  it('should not exceed threshold for a stale price, even with a large change', () => {
    const result = evaluatePriceDelta({ lastPrice: 10.0, newPrice: 20.0, lastObservedAt: thirtyOneDaysAgo, now });
    expect(result.isStale).toBe(true);
    expect(result.exceedsThreshold).toBe(false);
  });

  it('should handle missing lastObservedAt by considering it stale', () => {
    const result = evaluatePriceDelta({ lastPrice: 10.0, newPrice: 20.0, lastObservedAt: null, now });
    expect(result.isStale).toBe(true);
    expect(result.exceedsThreshold).toBe(false);
    expect(result.daysSinceUpdate).toBe(Number.POSITIVE_INFINITY);
  });

  it('should handle a price decrease that exceeds the threshold', () => {
    const result = evaluatePriceDelta({ lastPrice: 10.0, newPrice: 5.0, lastObservedAt: fifteenDaysAgo, now });
    expect(result.isStale).toBe(false);
    expect(result.exceedsThreshold).toBe(true);
    expect(result.pctDelta).toBeCloseTo(0.5);
  });

  it('should exceed threshold when price change is exactly at the absolute threshold', () => {
    const result = evaluatePriceDelta({ lastPrice: 5.0, newPrice: 6.0, lastObservedAt: fifteenDaysAgo, now });
    expect(result.isStale).toBe(false);
    // The condition is `absDelta >= PRICE_DELTA_POLICY.absThreshold`
    expect(result.exceedsThreshold).toBe(true);
  });

  it('should not exceed threshold when price change is just below the absolute threshold', () => {
    const result = evaluatePriceDelta({ lastPrice: 5.0, newPrice: 5.99, lastObservedAt: fifteenDaysAgo, now });
    expect(result.isStale).toBe(false);
    expect(result.exceedsThreshold).toBe(false);
  });
});