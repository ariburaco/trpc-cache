import {
  MiddlewareResult,
  TRPCError,
} from '@trpc/server/unstable-core-do-not-import';
import { NoopLogger } from '../utils/logger.js';

// Mock Redis client for testing
export class MockRedisClient {
  private storage = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) || null;
  }

  async set(
    key: string,
    value: string,
    options?: { ex: number },
  ): Promise<'OK'> {
    this.storage.set(key, value);
    return 'OK';
  }

  async setEx(key: string, ttl: number, value: string): Promise<'OK'> {
    return this.set(key, value);
  }

  async del(key: string): Promise<number> {
    const hadKey = this.storage.has(key);
    this.storage.delete(key);
    return hadKey ? 1 : 0;
  }

  // Helper method to see all stored keys (for testing)
  getAll(): Record<string, string> {
    return Object.fromEntries(this.storage.entries());
  }

  // Helper to clear all keys
  clear(): void {
    this.storage.clear();
  }
}

// Mock Upstash Redis client for testing
export class MockUpstashRedis {
  private storage = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.storage.get(key) || null;
  }

  async set(
    key: string,
    value: unknown,
    options?: { ex: number },
  ): Promise<'OK'> {
    this.storage.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const hadKey = this.storage.has(key);
    this.storage.delete(key);
    return hadKey ? 1 : 0;
  }

  // Helper method to see all stored keys (for testing)
  getAll(): Record<string, unknown> {
    return Object.fromEntries(this.storage.entries());
  }

  // Helper to clear all keys
  clear(): void {
    this.storage.clear();
  }
}

// Create mock tRPC context
export function createMockContext(userId?: string) {
  return {
    session: userId
      ? {
          user: {
            id: userId,
          },
        }
      : null,
  };
}

// Silence logs during tests
export const silentLogger = new NoopLogger();

// Mock next function that returns a value
export function createMockNext(returnValue: unknown) {
  let callCount = 0;

  const next = async (): Promise<MiddlewareResult<object>> => {
    callCount++;
    return {
      ok: true,
      marker: 'middlewareMarker' as const,
      data: returnValue,
      error: null,
    } as unknown as MiddlewareResult<object>;
  };

  return {
    next,
    getCallCount: () => callCount,
  };
}

// Mock failing next function
export function createMockFailingNext() {
  let callCount = 0;

  const next = async (): Promise<MiddlewareResult<object>> => {
    callCount++;
    return {
      ok: false,
      marker: 'middlewareMarker' as const,
      data: null,
      error: new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Test error',
      }),
    } as unknown as MiddlewareResult<object>;
  };

  return {
    next,
    getCallCount: () => callCount,
  };
}
