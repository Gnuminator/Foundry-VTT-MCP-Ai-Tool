import winston from 'winston';

/** File log rotation: at most FILE_LOG_MAX_FILES files of FILE_LOG_MAX_BYTES each (25 MB in all). */
export const FILE_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const FILE_LOG_MAX_FILES = 5;

export interface LoggerConfig {
  level: string;
  format?: 'json' | 'simple';
  enableConsole?: boolean;
  enableFile?: boolean;
  filePath?: string;
}

export class Logger {
  private logger: winston.Logger;

  constructor(config: LoggerConfig) {
    const formats = [];

    // Add timestamp to all logs
    formats.push(winston.format.timestamp());

    // Add error stack traces
    formats.push(winston.format.errors({ stack: true }));

    // Choose output format
    if (config.format === 'json') {
      formats.push(winston.format.json());
    } else {
      formats.push(winston.format.simple());
    }

    const transports: winston.transport[] = [];

    // Console transport
    if (config.enableConsole !== false) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
              return `${String(timestamp)} [${level}]: ${String(message)}${metaStr}`;
            })
          ),
        })
      );
    }

    // File transport
    if (config.enableFile && config.filePath) {
      transports.push(
        new winston.transports.File({
          filename: config.filePath,
          format: winston.format.json(),
          // Rotate: 5 files of 5 MB, newest unsuffixed (mcp-server.log, then mcp-server1.log ...).
          maxsize: FILE_LOG_MAX_BYTES,
          maxFiles: FILE_LOG_MAX_FILES,
          tailable: true,
        })
      );
    }

    this.logger = winston.createLogger({
      level: config.level,
      format: winston.format.combine(...formats),
      transports,
    });
  }

  info(message: string, meta?: unknown): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.logger.warn(message, meta);
  }

  error(message: string, error?: unknown): void {
    if (error instanceof Error) {
      this.logger.error(message, { error: error.message, stack: error.stack });
    } else if (error) {
      this.logger.error(message, { error });
    } else {
      this.logger.error(message);
    }
  }

  debug(message: string, meta?: unknown): void {
    this.logger.debug(message, meta);
  }

  child(defaultMeta: object): Logger {
    const childLogger = this.logger.child(defaultMeta);
    const childInstance = new Logger({
      level: 'info', // This will be overridden by the child logger
      enableConsole: false, // Child doesn't need its own transports
    });

    // Replace the logger instance
    childInstance.logger = childLogger;

    return childInstance;
  }
}
