import { z } from 'zod';

/**
 * Environment variable validator for Redis configuration
 */
export interface RedisEnvValidator {
  /**
   * Validate and return Redis URL from environment variables
   */
  getRedisUrl(): string;

  /**
   * Validate and return Upstash Redis URL and token from environment variables
   */
  getUpstashConfig(): { url: string; token: string };
}

/**
 * Default environment validator implementation
 */
export class DefaultRedisEnvValidator implements RedisEnvValidator {
  /**
   * Validate and return Redis URL from environment variables
   * @returns Redis URL
   * @throws Error if REDIS_URL is not defined
   */
  getRedisUrl(): string {
    const redisUrlSchema = z.string().url().min(1);
    const redisUrl = process.env.REDIS_URL;

    try {
      return redisUrlSchema.parse(redisUrl);
    } catch (error) {
      throw new Error(
        'REDIS_URL environment variable is missing or invalid. Please provide a valid Redis URL.',
      );
    }
  }

  /**
   * Validate and return Upstash Redis URL and token from environment variables
   * @returns Object containing Upstash Redis URL and token
   * @throws Error if UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not defined
   */
  getUpstashConfig(): { url: string; token: string } {
    const upstashSchema = z.object({
      url: z.string().url().min(1),
      token: z.string().min(1),
    });

    try {
      return upstashSchema.parse({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    } catch (error) {
      throw new Error(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables are required for Upstash Redis.',
      );
    }
  }
}

/**
 * Create a new Redis environment validator
 * @returns Redis environment validator instance
 */
export function createRedisEnvValidator(): RedisEnvValidator {
  return new DefaultRedisEnvValidator();
}
