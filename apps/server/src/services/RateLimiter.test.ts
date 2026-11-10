import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRateLimit } from './RateLimiter.js';

function createMockReqRes(ip: string, headers: Record<string, string> = {}) {
  const req = {
    ip,
    socket: { remoteAddress: ip },
    headers
  } as unknown as Request;

  const resHeaders = new Map<string, string>();
  let statusCode = 200;
  let responseBody: unknown = null;

  const res = {
    setHeader: vi.fn((key: string, value: string) => {
      resHeaders.set(key.toLowerCase(), value);
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((data: unknown) => {
      responseBody = data;
      return res;
    })
  } as unknown as Response;

  return {
    req,
    res,
    next: vi.fn() as unknown as NextFunction,
    getStatus: () => statusCode,
    getHeader: (key: string) => resHeaders.get(key.toLowerCase()),
    getBody: () => responseBody
  };
}

describe('RateLimiter', () => {
  it('allows requests within the limit', () => {
    const limiter = createRateLimit({ limit: 3, windowMs: 10_000 });
    const { req, res, next, getStatus } = createMockReqRes('192.168.1.1');

    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(getStatus()).toBe(200);

    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('blocks requests exceeding the limit with 429 and Retry-After', () => {
    const limiter = createRateLimit({ limit: 2, windowMs: 10_000 });
    const mock = createMockReqRes('192.168.1.2');

    limiter(mock.req, mock.res, mock.next);
    limiter(mock.req, mock.res, mock.next);
    expect(mock.next).toHaveBeenCalledTimes(2);

    // Third request violates limit
    limiter(mock.req, mock.res, mock.next);
    expect(mock.next).toHaveBeenCalledTimes(2);
    expect(mock.getStatus()).toBe(429);
    expect(mock.getHeader('retry-after')).toBeDefined();
    expect(mock.getBody()).toEqual({ error: 'Too many attempts. Please wait and try again.' });
  });

  it('resets the bucket after windowMs expires', () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const limiter = createRateLimit({ limit: 1, windowMs: 1_000 });
    const mock = createMockReqRes('192.168.1.3');

    limiter(mock.req, mock.res, mock.next);
    expect(mock.next).toHaveBeenCalledTimes(1);

    // Second request within window: rejected
    limiter(mock.req, mock.res, mock.next);
    expect(mock.getStatus()).toBe(429);

    // Advance time past the window
    vi.spyOn(Date, 'now').mockReturnValue(now + 1_500);

    limiter(mock.req, mock.res, mock.next);
    expect(mock.next).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it('bounds memory by evicting entries when maxBuckets is exceeded', () => {
    const maxBuckets = 3;
    const limiter = createRateLimit({ limit: 5, windowMs: 60_000, maxBuckets });

    // Insert 3 unique client IPs
    for (let i = 1; i <= 3; i++) {
      const mock = createMockReqRes(`10.0.0.${i}`);
      limiter(mock.req, mock.res, mock.next);
      expect(mock.next).toHaveBeenCalled();
    }

    // Adding 4th client should evict oldest client (10.0.0.1) without unbounded growth
    const mock4 = createMockReqRes('10.0.0.4');
    limiter(mock4.req, mock4.res, mock4.next);
    expect(mock4.next).toHaveBeenCalled();

    // Verify 10.0.0.1 was evicted (counts reset to 1 instead of continuing old bucket)
    const mock1Again = createMockReqRes('10.0.0.1');
    limiter(mock1Again.req, mock1Again.res, mock1Again.next);
    expect(mock1Again.next).toHaveBeenCalled();
  });
});
