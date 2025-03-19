import { vi } from 'vitest';

// Setup mock environment variables
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.UPSTASH_REDIS_REST_URL = 'https://test-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

// Mock redis and @upstash/redis modules
vi.mock('redis', async () => {
  const actual = await vi.importActual('redis');
  return {
    ...actual,
    createClient: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockImplementation((key: string) => {
        // Return mock data based on the key
        if (key.includes('cache-hit')) {
          return JSON.stringify({ data: 'cached-data' });
        }
        return null;
      }),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    })),
  };
});

vi.mock('@upstash/redis', async () => {
  return {
    Redis: vi.fn(() => ({
      get: vi.fn().mockImplementation((key: string) => {
        // Return mock data based on the key
        if (key.includes('cache-hit')) {
          return { data: 'cached-data' };
        }
        return null;
      }),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    })),
  };
});
