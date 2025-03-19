/**
 * Simple logger interface
 */
export interface Logger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * LogEntry type for structured logging
 */
export interface LogEntry {
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Default logger implementation that logs to console
 */
export class ConsoleLogger implements Logger {
  private readonly namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    console.info(`[${this.namespace}] ${message}`, metadata ?? '');
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    console.warn(`[${this.namespace}] ${message}`, metadata ?? '');
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    console.error(`[${this.namespace}] ${message}`, metadata ?? '');
  }
}

/**
 * NoopLogger that doesn't log anything - useful for testing or when logging is disabled
 */
export class NoopLogger implements Logger {
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * Create a logger wrapper that respects the debug flag
 */
export function createConditionalLogger(
  logger: Logger,
  options: { debug?: boolean } = {},
): {
  info: (entry: LogEntry) => void;
  warn: (entry: LogEntry) => void;
  error: (entry: LogEntry) => void;
} {
  return {
    info: (entry: LogEntry): void => {
      if (options.debug) {
        logger.info(entry.message, entry.metadata);
      }
    },
    warn: (entry: LogEntry): void => {
      if (options.debug) {
        logger.warn(entry.message, entry.metadata);
      }
    },
    error: (entry: LogEntry): void => {
      // Always log errors, even if debug is false
      logger.error(entry.message, entry.metadata);
    },
  };
}
