import type { RedisClientType } from 'redis';
import { Redis as UpstashRedis } from '@upstash/redis';
import { createClient } from 'redis';
import { ConsoleLogger, type Logger } from './logger.js';
import { createRedisEnvValidator } from './env-validator.js';
import { safeStringify } from './serialization.js';
/**
 * Check if a Redis client is an Upstash Redis client
 */
export function isUpstashRedis(client: unknown): client is UpstashRedis {
  return (
    client !== null &&
    typeof client === 'object' &&
    client instanceof UpstashRedis
  );
}

/**
 * Options for the setCached function
 */
export interface SetCachedOptions {
  redis: RedisClientType | UpstashRedis;
  key: string;
  value: unknown;
  ttl?: number;
  debug?: boolean;
}

/**
 * Get cached value from Redis
 */
export async function getCached({
  redis,
  key,
  debug = false,
}: {
  redis: RedisClientType | UpstashRedis;
  key: string;
  debug?: boolean;
}): Promise<unknown> {
  const logger = new ConsoleLogger('RedisCacheUtils');

  try {
    if (isUpstashRedis(redis)) {
      const value = await redis.get(key);

      if (debug) {
        logger.info(`Cache get for key: ${key}`, {
          key,
          hit: value !== null,
        });
      }

      return value;
    } else {
      const value = await redis.get(key);

      if (debug) {
        logger.info(`Cache get for key: ${key}`, {
          key,
          hit: value !== null,
        });
      }

      if (value) {
        try {
          return JSON.parse(value);
        } catch (err) {
          return value;
        }
      }

      return null;
    }
  } catch (error) {
    logger.error(`Error getting cache for key: ${key}`, {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
    return null;
  }
}

/**
 * Delete cached value from Redis
 */
export async function deleteCached({
  redis,
  key,
  debug = false,
}: {
  redis: RedisClientType | UpstashRedis;
  key: string;
  debug?: boolean;
}): Promise<void> {
  const logger = new ConsoleLogger('RedisCacheUtils');

  try {
    if (isUpstashRedis(redis)) {
      await redis.del(key);
    } else {
      await redis.del(key);
    }

    if (debug) {
      logger.info(`Cache deleted for key: ${key}`, { key });
    }
  } catch (error) {
    logger.error(`Error deleting cache for key: ${key}`, {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
    throw error;
  }
}

/**
 * Set a value in the Redis cache
 */
export async function setCached({
  redis,
  key,
  value,
  ttl,
  debug = false,
}: SetCachedOptions): Promise<void> {
  const logger = new ConsoleLogger('RedisCacheUtils');

  try {
    if (isUpstashRedis(redis)) {
      // For Upstash, pass the value directly - Upstash handles serialization
      if (ttl) {
        await redis.set(key, value, { ex: ttl });
      } else {
        await redis.set(key, value);
      }
    } else {
      // For standard Redis, serialize to string
      const valueStr =
        typeof value === 'string'
          ? value
          : safeStringify(value) ||
            JSON.stringify({
              __serialization_error: true,
              message: 'Failed to serialize value',
            });

      if (ttl) {
        await redis.setEx(key, ttl, valueStr);
      } else {
        await redis.set(key, valueStr);
      }
    }

    if (debug) {
      logger.info(`Cache set for key: ${key}`, {
        key,
        ttl: ttl || 'unlimited',
      });
    }
  } catch (error) {
    logger.error(`Error setting cache for key: ${key}`, {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
    throw error;
  }
}

/**
 * Redis client connection factory
 * This provides lazy initialization of Redis clients
 */
export class RedisConnectionFactory {
  private static standardRedisClient: RedisClientType | null = null;
  private static upstashRedisClient: UpstashRedis | null = null;
  private static connectPromise: Promise<RedisClientType> | null = null;
  private static logger: Logger = new ConsoleLogger('RedisConnectionFactory');

  /**
   * Set custom logger
   */
  static setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * Get the standard Redis client, creating it if needed
   */
  static async getStandardRedis(redisUrl?: string): Promise<RedisClientType> {
    if (!this.standardRedisClient) {
      const url = redisUrl || createRedisEnvValidator().getRedisUrl();

      this.standardRedisClient = createClient({
        url,
      });

      // Only connect if not already connecting
      if (!this.connectPromise) {
        this.connectPromise = this.standardRedisClient
          .connect()
          .catch((err) => {
            this.logger.error('Redis connection error', { error: String(err) });
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

  /**
   * Get the Upstash Redis client, creating it if needed
   */
  static getUpstashRedis(config?: {
    url: string;
    token: string;
  }): UpstashRedis {
    if (!this.upstashRedisClient) {
      try {
        if (config) {
          this.upstashRedisClient = new UpstashRedis({
            url: config.url,
            token: config.token,
          });
        } else {
          try {
            const upstashConfig = createRedisEnvValidator().getUpstashConfig();
            this.upstashRedisClient = new UpstashRedis({
              url: upstashConfig.url,
              token: upstashConfig.token,
            });
          } catch (error) {
            this.logger.error('Failed to create Upstash Redis client', {
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
      } catch (error) {
        this.logger.error('Failed to create Upstash Redis client', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    return this.upstashRedisClient;
  }

  /**
   * Close connections - useful for cleanup
   */
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
