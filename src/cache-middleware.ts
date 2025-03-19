import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import {
  ConsoleLogger,
  RedisConnectionFactory,
  createConditionalLogger,
  getElapsedMs,
  sanitizeForCache,
  type LogEntry,
} from './utils/index.js';

/**
 * Generic type for the tRPC context
 */
export interface TRPCContext {
  session:
    | {
        user?: {
          id?: string;
        };
      }
    | null
    | undefined;
  [key: string]: unknown;
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /**
   * Time to live in seconds, undefined means permanent
   * @default 60
   */
  ttl?: number;

  /**
   * Whether to use Upstash Redis instead of normal Redis
   * @default true
   */
  useUpstash?: boolean;

  /**
   * Whether to include user ID in cache key
   * @default true
   */
  userSpecific?: boolean;

  /**
   * If true, ignore user context for caching (global cache)
   * @default false
   */
  globalCache?: boolean;

  /**
   * Optional custom cache key function
   */
  getCacheKey?: (path: string, rawInput: unknown) => string;

  /**
   * Whether to log debug information
   * @default false
   */
  debug?: boolean;

  /**
   * Custom Redis URL for standard Redis (overrides env)
   */
  redisUrl?: string;

  /**
   * Custom Upstash Redis configuration (overrides env)
   */
  upstashConfig?: {
    url: string;
    token: string;
  };
}

/**
 * Default cache configuration
 */
const defaultCacheConfig: CacheConfig = {
  ttl: 60, // 60 seconds default
  useUpstash: true,
  userSpecific: true,
  globalCache: false,
  debug: false,
};

// Create the logger
const loggerService = new ConsoleLogger('CacheMiddleware');

/**
 * Create a cache key based on the procedure path, input, and context
 */
const createCacheKey = (
  path: string,
  input: unknown,
  ctx: TRPCContext,
  config: CacheConfig,
): string => {
  // Use custom cache key function if provided
  if (config.getCacheKey) {
    const customKey = config.getCacheKey(path, input);
    return customKey;
  }

  // Create default cache key based on configuration
  const inputString = input ? JSON.stringify(input) : '';

  // For global cache, don't include user info
  if (config.globalCache) {
    return `trpc:global:${path}:${inputString}`;
  }

  // For user-specific cache
  const userId = ctx.session?.user?.id ?? 'anonymous';

  if (config.userSpecific) {
    // Create a minimal context hash for user-specific caching
    return `trpc:user:${path}:${userId}:${inputString}`;
  }

  // Default case just uses the path and input
  return `trpc:${path}:${inputString}`;
};

// Validation schema for cache config
const cacheConfigSchema = z.object({
  ttl: z.number().positive().optional(),
  useUpstash: z.boolean().optional(),
  userSpecific: z.boolean().optional(),
  globalCache: z.boolean().optional(),
  getCacheKey: z.function().optional(),
  debug: z.boolean().optional(),
  redisUrl: z.string().optional(),
  upstashConfig: z
    .object({
      url: z.string(),
      token: z.string(),
    })
    .optional(),
});

/**
 * Create a cache middleware for a TRPC procedure
 * @param config - The cache configuration
 * @returns A middleware function that can be used to cache the result of a TRPC procedure
 *
 * @example
 * const globalCacheMiddleware = createCacheMiddleware({
 *   ttl: undefined, // Permanent cache
 *   useUpstash: false,
 *   globalCache: true, // Use global cache that's shared among all users
 *   userSpecific: false, // Don't include user ID in cache key
 * });
 *
 * const appRouter = createTRPCRouter({
 *   search: protectedProcedure
 *     .input(searchAppSchema)
 *     .use(globalCacheMiddleware)
 *     .query(async ({ input }) => {
 *      // Your query logic here
 *     }),
 * });
 */
export function createCacheMiddleware<
  TContext extends TRPCContext = TRPCContext,
>(config?: CacheConfig) {
  const validatedConfig = {
    ...defaultCacheConfig,
    ...cacheConfigSchema.parse(config ?? {}),
  } as CacheConfig;

  // Create a logger that respects the debug flag
  const logger = createConditionalLogger(loggerService, {
    debug: validatedConfig.debug,
  });

  return async ({
    ctx,
    path,
    next,
    input,
  }: {
    ctx: TContext;
    path: string;
    next: () => Promise<unknown>;
    input?: unknown;
  }) => {
    const startTime = performance.now();
    const cacheKey = createCacheKey(path, input, ctx, validatedConfig);
    const userId = ctx.session?.user?.id ?? 'anonymous';
    const ttl = validatedConfig.ttl; // Can be undefined for permanent cache

    try {
      if (validatedConfig.useUpstash) {
        const cacheStartTime = performance.now();
        const upstashRedis = validatedConfig.upstashConfig
          ? RedisConnectionFactory.getUpstashRedis(
              validatedConfig.upstashConfig,
            )
          : RedisConnectionFactory.getUpstashRedis();
        const cachedData = await upstashRedis.get(cacheKey);
        const cacheElapsedMs = getElapsedMs(cacheStartTime);

        if (cachedData) {
          logger.info({
            message: 'Cache hit',
            metadata: {
              userId,
              path,
              cacheKey,
              type: 'upstash',
              globalCache: validatedConfig.globalCache,
              userSpecific: validatedConfig.userSpecific,
              timing: {
                cacheRetrievalMs: cacheElapsedMs,
                totalMs: getElapsedMs(startTime),
              },
            },
          });
          return cachedData;
        }

        logger.info({
          message: 'Cache miss',
          metadata: {
            userId,
            path,
            cacheKey,
            type: 'upstash',
            globalCache: validatedConfig.globalCache,
            userSpecific: validatedConfig.userSpecific,
            timing: {
              cacheCheckMs: cacheElapsedMs,
            },
          },
        });

        const execStartTime = performance.now();
        const result = await next();
        const execElapsedMs = getElapsedMs(execStartTime);

        const sanitizedResult = sanitizeForCache(result);

        const cacheSetStartTime = performance.now();

        // Handle permanent caching (no TTL)
        if (ttl === undefined) {
          await upstashRedis.set(cacheKey, sanitizedResult);
        } else {
          await upstashRedis.set(cacheKey, sanitizedResult, {
            ex: ttl,
          } as const);
        }

        const cacheSetElapsedMs = getElapsedMs(cacheSetStartTime);

        logger.info({
          message: 'Cache set',
          metadata: {
            userId,
            path,
            cacheKey,
            ttl: ttl !== undefined ? ttl : 'permanent',
            type: 'upstash',
            globalCache: validatedConfig.globalCache,
            userSpecific: validatedConfig.userSpecific,
            timing: {
              executionMs: execElapsedMs,
              cacheSetMs: cacheSetElapsedMs,
              totalMs: getElapsedMs(startTime),
            },
          },
        });

        return result;
      } else {
        const cacheStartTime = performance.now();
        const redisClient = await RedisConnectionFactory.getStandardRedis(
          validatedConfig.redisUrl,
        );
        const cachedData = await redisClient.get(cacheKey);
        const cacheElapsedMs = getElapsedMs(cacheStartTime);

        if (cachedData) {
          logger.info({
            message: 'Cache hit',
            metadata: {
              userId,
              path,
              cacheKey,
              type: 'redis',
              globalCache: validatedConfig.globalCache,
              userSpecific: validatedConfig.userSpecific,
              timing: {
                cacheRetrievalMs: cacheElapsedMs,
                totalMs: getElapsedMs(startTime),
              },
            },
          });
          return JSON.parse(cachedData);
        }

        logger.info({
          message: 'Cache miss',
          metadata: {
            userId,
            path,
            cacheKey,
            type: 'redis',
            globalCache: validatedConfig.globalCache,
            userSpecific: validatedConfig.userSpecific,
            timing: {
              cacheCheckMs: cacheElapsedMs,
            },
          },
        });

        const execStartTime = performance.now();
        const result = await next();
        const execElapsedMs = getElapsedMs(execStartTime);

        const sanitizedResult = sanitizeForCache(result);

        const cacheSetStartTime = performance.now();

        // Handle permanent caching (no TTL)
        if (ttl === undefined) {
          await redisClient.set(cacheKey, JSON.stringify(sanitizedResult));
        } else {
          await redisClient.setEx(
            cacheKey,
            ttl,
            JSON.stringify(sanitizedResult),
          );
        }

        const cacheSetElapsedMs = getElapsedMs(cacheSetStartTime);

        logger.info({
          message: 'Cache set',
          metadata: {
            userId,
            path,
            cacheKey,
            ttl: ttl !== undefined ? ttl : 'permanent',
            type: 'redis',
            globalCache: validatedConfig.globalCache,
            userSpecific: validatedConfig.userSpecific,
            timing: {
              executionMs: execElapsedMs,
              cacheSetMs: cacheSetElapsedMs,
              totalMs: getElapsedMs(startTime),
            },
          },
        });

        return result;
      }
    } catch (error) {
      const errorElapsedMs = getElapsedMs(startTime);
      logger.error({
        message: 'Redis cache error',
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          userId,
          path,
          cacheKey,
          type: validatedConfig.useUpstash ? 'upstash' : 'redis',
          timing: {
            errorMs: errorElapsedMs,
          },
        },
      });

      // If cache fails, fallback to normal execution
      return next();
    }
  };
}

/**
 * Invalidate a cache entry for a specific procedure
 */
export async function invalidateCache(
  path: string,
  input?: unknown,
  options?: {
    useUpstash?: boolean;
    globalCache?: boolean;
    userSpecific?: boolean;
    userId?: string;
    redisUrl?: string;
    upstashConfig?: {
      url: string;
      token: string;
    };
  },
): Promise<void> {
  const defaultOptions = {
    useUpstash: true,
    globalCache: false,
    userSpecific: true,
  };

  const config = { ...defaultOptions, ...options };

  // Create a mock context with user ID if provided
  const mockCtx = {
    session: config.userId ? { user: { id: config.userId } } : undefined,
  } as TRPCContext;

  const cacheKey = createCacheKey(path, input, mockCtx, config);
  const logger = createConditionalLogger(loggerService);

  try {
    if (config.useUpstash) {
      const upstashRedis = config.upstashConfig
        ? RedisConnectionFactory.getUpstashRedis(config.upstashConfig)
        : RedisConnectionFactory.getUpstashRedis();
      await upstashRedis.del(cacheKey);
      logger.info({
        message: 'Cache invalidated',
        metadata: {
          path,
          cacheKey,
          type: 'upstash',
          globalCache: config.globalCache,
          userSpecific: config.userSpecific,
        },
      });
    } else {
      const redisClient = await RedisConnectionFactory.getStandardRedis(
        config.redisUrl,
      );
      await redisClient.del(cacheKey);
      logger.info({
        message: 'Cache invalidated',
        metadata: {
          path,
          cacheKey,
          type: 'redis',
          globalCache: config.globalCache,
          userSpecific: config.userSpecific,
        },
      });
    }
  } catch (error) {
    logger.error({
      message: 'Cache invalidation error',
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        path,
        cacheKey,
        type: config.useUpstash ? 'upstash' : 'redis',
      },
    });
    throw error;
  }
}
