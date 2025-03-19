import type { RedisClientType } from 'redis';
import { Redis as UpstashRedis } from '@upstash/redis';
import { createClient } from 'redis';
import { ConsoleLogger, type Logger } from './logger.js';
import { createRedisEnvValidator } from './env-validator.js';

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
      if (config) {
        this.upstashRedisClient = new UpstashRedis({
          url: config.url,
          token: config.token,
        });
      } else {
        try {
          this.upstashRedisClient = UpstashRedis.fromEnv();
        } catch (error) {
          // If fromEnv() fails, try using our validator
          const upstashConfig = createRedisEnvValidator().getUpstashConfig();
          this.upstashRedisClient = new UpstashRedis({
            url: upstashConfig.url,
            token: upstashConfig.token,
          });
        }
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
