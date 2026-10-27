/** Bridge replies read by movement.ts. Unread fields stay `unknown`. */

export interface MovementReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}
