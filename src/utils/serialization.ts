import { performance } from 'node:perf_hooks';

/**
 * Create a new WeakSet for tracking objects during serialization
 * @returns A new WeakSet for tracking objects
 */
function createSeenObjectsSet(): WeakSet<object> {
  return new WeakSet();
}

/**
 * Check if an object is serializable for caching
 * @param obj Object to check
 * @returns True if the object is serializable
 */
export function isSerializable(obj: unknown): boolean {
  if (obj === null || obj === undefined) return true;
  if (
    typeof obj === 'number' ||
    typeof obj === 'string' ||
    typeof obj === 'boolean'
  )
    return true;
  if (obj instanceof Date) return true;
  if (Array.isArray(obj)) return obj.every(isSerializable);
  if (typeof obj === 'object') {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== null && proto !== Object.prototype) return false;
    return Object.values(obj as Record<string, unknown>).every(isSerializable);
  }
  return false;
}

/**
 * Safe JSON stringify with circular reference handling
 * @param value Value to stringify
 * @returns String representation or null if failed
 */
export function safeStringify(value: unknown): string | null {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) {
          return '[Circular Reference]';
        }
        seen.add(val);
      }
      return val;
    });
  } catch (err) {
    return null;
  }
}

/**
 * Sanitize an object for caching by removing non-serializable properties
 * @param obj Object to sanitize
 * @returns Sanitized object suitable for caching
 */
export function sanitizeForCache(obj: unknown): unknown {
  if (!isSerializable(obj)) {
    if (Array.isArray(obj)) {
      return obj.map((item) => sanitizeForCache(item));
    }
    if (obj && typeof obj === 'object') {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (isSerializable(value)) {
          clean[key] = value;
        } else {
          clean[key] = sanitizeForCache(value);
        }
      }
      return clean;
    }
    return null;
  }
  return obj;
}

/**
 * Performance utility to measure elapsed time
 * @param startTime Performance.now() start time
 * @returns Elapsed time in milliseconds
 */
export function getElapsedMs(startTime: number): number {
  return Math.round(performance.now() - startTime);
}
