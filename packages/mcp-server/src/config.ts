import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  logFormat: z.enum(['json', 'simple']).default('simple'),
  enableFileLogging: z.boolean().default(false),
  logFilePath: z.string().optional(),
  foundry: z.object({
    host: z.string().default('localhost'),
    port: z.number().min(1024).max(65535).default(31415),
    namespace: z.string().default('/foundry-mcp'),
    reconnectAttempts: z.number().min(1).max(20).default(5),
    reconnectDelay: z.number().min(100).max(30000).default(1000),
    connectionTimeout: z.number().min(1000).max(60000).default(10000),
    protocol: z.enum(['ws', 'wss']).default('ws'), // Legacy
    remoteMode: z.boolean().default(false),
    rejectUnauthorized: z.boolean().default(true), // TLS certificate validation
  }),
  toolResponseMaxChars: z.number().min(256).max(500000).default(20000),
  server: z.object({
    name: z.string().default('foundry-mcp-server'),
    version: z.string().default('0.4.17'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

const rawConfig = {
  logLevel: process.env.LOG_LEVEL || 'warn',
  logFormat: process.env.LOG_FORMAT || 'simple',
  enableFileLogging: process.env.ENABLE_FILE_LOGGING === 'true',
  logFilePath: process.env.LOG_FILE_PATH,
  foundry: {
    host: process.env.FOUNDRY_HOST || 'localhost',
    port: parseInt(process.env.FOUNDRY_PORT || '31415', 10),
    namespace: process.env.FOUNDRY_NAMESPACE || '/foundry-mcp',
    reconnectAttempts: parseInt(process.env.FOUNDRY_RECONNECT_ATTEMPTS || '5', 10),
    reconnectDelay: parseInt(process.env.FOUNDRY_RECONNECT_DELAY || '1000', 10),
    connectionTimeout: parseInt(process.env.FOUNDRY_CONNECTION_TIMEOUT || '10000', 10),
    protocol: (process.env.FOUNDRY_PROTOCOL || 'ws') as 'ws' | 'wss',
    remoteMode: process.env.FOUNDRY_REMOTE_MODE === 'true',
    rejectUnauthorized: process.env.FOUNDRY_REJECT_UNAUTHORIZED !== 'false',
  },
  toolResponseMaxChars: parseInt(process.env.TOOL_RESPONSE_MAX_CHARS || '20000', 10),
  server: {
    name: process.env.SERVER_NAME || 'foundry-mcp-server',
    version: process.env.SERVER_VERSION || '1.0.0',
  },
};

export const config = ConfigSchema.parse(rawConfig);
