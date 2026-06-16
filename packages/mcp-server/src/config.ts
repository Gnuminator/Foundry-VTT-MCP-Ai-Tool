import { z } from 'zod';
import dotenv from 'dotenv';
import { WEBRTC_LIMITS } from '@gnuminator/shared';
import { getDefaultComfyUIDir } from './utils/platform.js';

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
    connectionType: z.enum(['websocket', 'webrtc', 'auto']).default('auto'),
    protocol: z.enum(['ws', 'wss']).default('ws'), // Legacy, used only for WebSocket mode
    remoteMode: z.boolean().default(false),
    dataPath: z.string().optional(), // Custom path for generated maps (remote mode)
    rejectUnauthorized: z.boolean().default(true), // TLS certificate validation
    // WebRTC configuration
    webrtc: z
      .object({
        stunServers: z
          .array(z.string())
          .default(['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']),
        // Future: TURN servers support
        // turnServers: z.array(z.object({
        //   urls: z.string(),
        //   username: z.string().optional(),
        //   credential: z.string().optional()
        // })).optional()
      })
      .default({
        stunServers: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
      }),
  }),
  comfyui: z.object({
    // ComfyUI always runs locally on the same machine as the MCP server
    port: z.number().min(1024).max(65535).default(31411),
    installPath: z.string(), // No default here - set in rawConfig
    host: z.string().default('127.0.0.1'),
    pythonCommand: z.string().default('python/python.exe'), // Will be platform-specific
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
    connectionType: (process.env.FOUNDRY_CONNECTION_TYPE || 'auto') as
      | 'websocket'
      | 'webrtc'
      | 'auto',
    protocol: (process.env.FOUNDRY_PROTOCOL || 'ws') as 'ws' | 'wss',
    remoteMode: process.env.FOUNDRY_REMOTE_MODE === 'true',
    dataPath: process.env.FOUNDRY_DATA_PATH,
    rejectUnauthorized: process.env.FOUNDRY_REJECT_UNAUTHORIZED !== 'false',
    webrtc: {
      stunServers: process.env.FOUNDRY_STUN_SERVERS
        ? process.env.FOUNDRY_STUN_SERVERS.split(',')
        : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
    },
  },
  comfyui: {
    // ComfyUI always runs locally on the same machine as the MCP server (localhost:31411)
    port: parseInt(process.env.COMFYUI_PORT || '31411', 10),
    installPath: process.env.COMFYUI_INSTALL_PATH || getDefaultComfyUIDir(),
    host: process.env.COMFYUI_HOST || '127.0.0.1',
    pythonCommand: process.env.COMFYUI_PYTHON_COMMAND || 'python/python.exe',
  },
  toolResponseMaxChars: parseInt(process.env.TOOL_RESPONSE_MAX_CHARS || '20000', 10),
  server: {
    name: process.env.SERVER_NAME || 'foundry-mcp-server',
    version: process.env.SERVER_VERSION || '1.0.0',
  },
};

export const config = ConfigSchema.parse(rawConfig);

/**
 * WebRTC SCTP / chunking limits.
 *
 * The canonical definition now lives in `@gnuminator/shared` (`WEBRTC_LIMITS`)
 * so the MCP server's reassembly path (webrtc-peer.ts) and the Foundry module's
 * send path (webrtc-connection.ts) reference one source of truth instead of
 * keeping separate hand-synced copies. Re-exported here under the established
 * `WEBRTC_CONSTANTS` name that webrtc-peer.ts imports.
 */
export const WEBRTC_CONSTANTS = WEBRTC_LIMITS;
