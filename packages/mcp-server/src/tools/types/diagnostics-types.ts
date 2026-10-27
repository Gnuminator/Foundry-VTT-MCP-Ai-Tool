/** Reply shapes of the diagnostics bridge queries (only the fields the server reads are typed). */

export interface DiagnosticsToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** What the `foundry-mcp-bridge.*` diagnostics queries answer; everything else passes through untouched. */
export interface DiagnosticsBridgeReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** The manifest handler returns the bridge reply as is, or a parameter-error string. */
export type DiagnosticsManifestResult = DiagnosticsBridgeReply | undefined | string;
