import type { RedisClientType } from "redis";
import { Redis as UpstashRedis } from "@upstash/redis";
import { createClient } from "redis";
import { z } from "zod";
import { Logger } from "@/lib/logger";
import { type Context } from "@/server/api/trpc";
import { env } from "@/env";

const loggerService = new Logger("CacheMiddleware");

// Define log entry type
interface LogEntry {
message: string;
metadata?: Record<string, unknown>;
}

// Create a type-safe logger
const logger = {
info: (entry: LogEntry, debug?: boolean) => {
if (debug) {
loggerService.info(entry.message, entry.metadata);
}
},
error: (entry: LogEntry, debug?: boolean) => {
if (debug) {
loggerService.error(entry.message, entry.metadata);
}
},
warn: (entry: LogEntry, debug?: boolean) => {
if (debug) {
loggerService.warn(entry.message, entry.metadata);
}
},
};

// Redis client connection factory
// This provides lazy initialization of Redis clients
class RedisConnectionFactory {
private static standardRedisClient: RedisClientType | null = null;
private static upstashRedisClient: UpstashRedis | null = null;
private static connectPromise: Promise<RedisClientType> | null = null;

// Get the standard Redis client, creating it if needed
static async getStandardRedis(): Promise<RedisClientType> {
if (!this.standardRedisClient) {
this.standardRedisClient = createClient({
url: env.REDIS_URL,
});

      // Only connect if not already connecting
      if (!this.connectPromise) {
        this.connectPromise = this.standardRedisClient
          .connect()
          .catch((err) => {
            logger.error({
              message: "Redis connection error",
              metadata: { error: String(err) },
            });
            this.standardRedisClient = null;
            this.connectPromise = null;
            throw err;
          });
      }

      // Wait for connection to complete
      await this.connectPromise;
    }

    return this.standardRedisClient;

}

// Get the Upstash Redis client
static getUpstashRedis(): UpstashRedis {
if (!this.upstashRedisClient) {
this.upstashRedisClient = UpstashRedis.fromEnv();
}
return this.upstashRedisClient;
}

// Close connections - useful for cleanup
static async closeConnections(): Promise<void> {
if (this.standardRedisClient) {
await this.standardRedisClient.quit();
this.standardRedisClient = null;
}
// Upstash Redis uses HTTP/REST so no need to close
this.upstashRedisClient = null;
this.connectPromise = null;
}
}

// Enhanced cache configuration type
interface CacheConfig {
ttl?: number; // Time to live in seconds, undefined means permanent
useUpstash?: boolean; // Whether to use Upstash Redis instead of normal Redis
userSpecific?: boolean; // Whether to include user ID in cache key
globalCache?: boolean; // If true, ignore user context for caching
getCacheKey?: (path: string, rawInput: unknown) => string; // Optional custom cache key function
debug?: boolean; // Whether to log debug information
}

const defaultCacheConfig: CacheConfig = {
ttl: 60, // 60 seconds default
useUpstash: true,
userSpecific: true,
globalCache: false,
debug: false,
};

// Add timing helper
const getElapsedMs = (startTime: number): number => {
return Math.round(performance.now() - startTime);
};

// Updated cache key creation to support global and user-specific modes
const createCacheKey = (
path: string,
input: unknown,
ctx: Context,
config: CacheConfig,
): string => {
// Use custom cache key function if provided
if (config.getCacheKey) {
const customKey = config.getCacheKey(path, input);
logger.info(
{
message: "Created custom cache key",
metadata: {
path,
customKey,
},
},
config.debug,
);
return customKey;
}

// Create default cache key based on configuration
const inputString = input ? JSON.stringify(input) : "";

// For global cache, don't include user info
if (config.globalCache) {
return `trpc:global:${path}:${inputString}`;
}

// For user-specific cache
const userId = ctx.session?.user?.id ?? "anonymous";

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
});

// Add these helper functions at the top of the file
function isSerializable(obj: unknown): boolean {
if (obj === null || obj === undefined) return true;
if (
typeof obj === "number" ||
typeof obj === "string" ||
typeof obj === "boolean"
)
return true;
if (obj instanceof Date) return true;
if (Array.isArray(obj)) return obj.every(isSerializable);
if (typeof obj === "object") {
const proto = Object.getPrototypeOf(obj);
if (proto !== null && proto !== Object.prototype) return false;
return Object.values(obj as Record<string, unknown>).every(isSerializable);
}
return false;
}

function sanitizeForCache(obj: unknown): unknown {
if (!isSerializable(obj)) {
if (Array.isArray(obj)) {
return obj.map(sanitizeForCache);
}
if (obj && typeof obj === "object") {
const clean: Record<string, unknown> = {};
for (const [key, value] of Object.entries(obj)) {
if (isSerializable(value)) {
clean[key] = value;
}
}
return clean;
}
return null;
}
return obj;
}

/\*\*

- Create a cache middleware for a TRPC procedure
- @param config - The cache configuration
- @returns A middleware function that can be used to cache the result of a TRPC procedure
-
- @example
- const globalCacheMiddleware = createCacheMiddleware({
- ttl: undefined, // Permanent cache
- useUpstash: false,
- globalCache: true, // Use global cache that's shared among all users
- userSpecific: false, // Don't include user ID in cache key
- getCacheKey: getAppSearchCacheKey, // Use our custom cache key function
- });
-
- Note: This middleware is designed to be used with the `use` method of a TRPC procedure AFTER the `input` has been validated.
-
- @example
- const appRouter = createTRPCRouter({
- search: protectedProcedure
-     .input(searchAppSchema)
-     .use(globalCacheMiddleware)
-     .query(async ({ input }) => {
-      // Your query logic here
-     }),
- });
  \*/
  export const createCacheMiddleware = (config?: CacheConfig) => {
  const validatedConfig = {
  ...defaultCacheConfig,
  ...cacheConfigSchema.parse(config ?? {}),
  } as CacheConfig;

return async ({
ctx,
path,
next,
input,
}: {
ctx: Context;
path: string;
next: () => Promise<unknown>;
input?: unknown;
}) => {
const startTime = performance.now();
const cacheKey = createCacheKey(path, input, ctx, validatedConfig);
const userId = ctx.session?.user?.id ?? "anonymous";
const ttl = validatedConfig.ttl; // Can be undefined for permanent cache

    try {
      if (validatedConfig.useUpstash) {
        const cacheStartTime = performance.now();
        const cachedData =
          await RedisConnectionFactory.getUpstashRedis().get(cacheKey);
        const cacheElapsedMs = getElapsedMs(cacheStartTime);

        if (cachedData) {
          logger.info(
            {
              message: "Cache hit",
              metadata: {
                userId,
                path,
                cacheKey,
                type: "upstash",
                globalCache: validatedConfig.globalCache,
                userSpecific: validatedConfig.userSpecific,
                timing: {
                  cacheRetrievalMs: cacheElapsedMs,
                  totalMs: getElapsedMs(startTime),
                },
                context: {},
              },
            },
            validatedConfig.debug,
          );
          return cachedData;
        }

        logger.info(
          {
            message: "Cache miss",
            metadata: {
              userId,
              path,
              cacheKey,
              type: "upstash",
              globalCache: validatedConfig.globalCache,
              userSpecific: validatedConfig.userSpecific,
              timing: {
                cacheCheckMs: cacheElapsedMs,
              },
            },
          },
          validatedConfig.debug,
        );

        const execStartTime = performance.now();
        const result = await next();
        const execElapsedMs = getElapsedMs(execStartTime);

        const sanitizedResult = sanitizeForCache(result);

        const cacheSetStartTime = performance.now();

        // Handle permanent caching (no TTL)
        if (ttl === undefined) {
          await RedisConnectionFactory.getUpstashRedis().set(
            cacheKey,
            sanitizedResult,
          );
        } else {
          await RedisConnectionFactory.getUpstashRedis().set(
            cacheKey,
            sanitizedResult,
            {
              ex: ttl,
            } as const,
          );
        }

        const cacheSetElapsedMs = getElapsedMs(cacheSetStartTime);

        logger.info(
          {
            message: "Cache set",
            metadata: {
              userId,
              path,
              cacheKey,
              ttl: ttl !== undefined ? ttl : "permanent",
              type: "upstash",
              globalCache: validatedConfig.globalCache,
              userSpecific: validatedConfig.userSpecific,
              timing: {
                executionMs: execElapsedMs,
                cacheSetMs: cacheSetElapsedMs,
                totalMs: getElapsedMs(startTime),
              },
            },
          },
          validatedConfig.debug,
        );

        return result;
      } else {
        const cacheStartTime = performance.now();
        const cachedData = await (
          await RedisConnectionFactory.getStandardRedis()
        ).get(cacheKey);
        const cacheElapsedMs = getElapsedMs(cacheStartTime);

        if (cachedData) {
          logger.info(
            {
              message: "Cache hit",
              metadata: {
                userId,
                path,
                cacheKey,
                type: "redis",
                globalCache: validatedConfig.globalCache,
                userSpecific: validatedConfig.userSpecific,
                timing: {
                  cacheRetrievalMs: cacheElapsedMs,
                  totalMs: getElapsedMs(startTime),
                },
              },
            },
            validatedConfig.debug,
          );
          return JSON.parse(cachedData);
        }

        logger.info(
          {
            message: "Cache miss",
            metadata: {
              userId,
              path,
              cacheKey,
              type: "redis",
              globalCache: validatedConfig.globalCache,
              userSpecific: validatedConfig.userSpecific,
              timing: {
                cacheCheckMs: cacheElapsedMs,
              },
            },
          },
          validatedConfig.debug,
        );

        const execStartTime = performance.now();
        const result = await next();
        const execElapsedMs = getElapsedMs(execStartTime);

        const sanitizedResult = sanitizeForCache(result);

        const cacheSetStartTime = performance.now();

        // Handle permanent caching (no TTL)
        if (ttl === undefined) {
          await (
            await RedisConnectionFactory.getStandardRedis()
          ).set(cacheKey, JSON.stringify(sanitizedResult));
        } else {
          await (
            await RedisConnectionFactory.getStandardRedis()
          ).setEx(cacheKey, ttl, JSON.stringify(sanitizedResult));
        }

        const cacheSetElapsedMs = getElapsedMs(cacheSetStartTime);

        logger.info(
          {
            message: "Cache set",
            metadata: {
              userId,
              path,
              cacheKey,
              ttl: ttl !== undefined ? ttl : "permanent",
              type: "redis",
              globalCache: validatedConfig.globalCache,
              userSpecific: validatedConfig.userSpecific,
              timing: {
                executionMs: execElapsedMs,
                cacheSetMs: cacheSetElapsedMs,
                totalMs: getElapsedMs(startTime),
              },
            },
          },
          validatedConfig.debug,
        );

        return result;
      }
    } catch (error) {
      const errorElapsedMs = getElapsedMs(startTime);
      logger.error(
        {
          message: "Redis cache error",
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            userId,
            path,
            cacheKey,
            type: validatedConfig.useUpstash ? "upstash" : "redis",
            timing: {
              errorMs: errorElapsedMs,
            },
          },
        },
        validatedConfig.debug,
      );

      return next();
    }

};
};

// Updated invalidateCache to match new cache key format
export const invalidateCache = async (
path: string,
input?: unknown,
options?: {
useUpstash?: boolean;
globalCache?: boolean;
userSpecific?: boolean;
userId?: string;
},
): Promise<void> => {
const defaultOptions = {
useUpstash: true,
globalCache: false,
userSpecific: true,
};

const config = { ...defaultOptions, ...options };

// Create a mock context with user ID if provided
const mockCtx = {
session: config.userId ? { user: { id: config.userId } } : undefined,
} as Context;

const cacheKey = createCacheKey(path, input, mockCtx, config);

try {
if (config.useUpstash) {
await RedisConnectionFactory.getUpstashRedis().del(cacheKey);
logger.info({
message: "Cache invalidated",
metadata: {
path,
cacheKey,
type: "upstash",
globalCache: config.globalCache,
userSpecific: config.userSpecific,
},
});
} else {
await (await RedisConnectionFactory.getStandardRedis()).del(cacheKey);
logger.info({
message: "Cache invalidated",
metadata: {
path,
cacheKey,
type: "redis",
globalCache: config.globalCache,
userSpecific: config.userSpecific,
},
});
}
} catch (error) {
logger.error({
message: "Cache invalidation error",
metadata: {
error: error instanceof Error ? error.message : String(error),
path,
cacheKey,
type: config.useUpstash ? "upstash" : "redis",
},
});
}
};
