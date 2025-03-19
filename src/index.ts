// Main middleware exports
export { createCacheMiddleware, invalidateCache } from './cache-middleware.js';
export type { CacheConfig, TRPCContext } from './cache-middleware.js';

// Utility exports
export {
  ConsoleLogger,
  NoopLogger,
  createConditionalLogger,
  RedisConnectionFactory,
  createRedisEnvValidator,
} from './utils/index.js';
export type { Logger, LogEntry, RedisEnvValidator } from './utils/index.js';
