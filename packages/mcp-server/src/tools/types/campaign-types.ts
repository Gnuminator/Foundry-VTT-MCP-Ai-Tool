// Types for the campaign dashboard tool (campaign-management.ts).

import type { CampaignPartType, CampaignStructure } from '@gnuminator/shared';

export type CampaignTemplateName =
  | 'five-part-adventure'
  | 'dungeon-crawl'
  | 'investigation'
  | 'sandbox'
  | 'custom';

/** The validated request of create-campaign-dashboard (what the zod schema yields). */
export interface CampaignDashboardRequest {
  campaignTitle: string;
  campaignDescription: string;
  template: CampaignTemplateName;
  customParts?:
    | Array<{
        title: string;
        description: string;
        type: CampaignPartType;
        levelStart: number;
        levelEnd: number;
        subParts?: Array<{ title: string; description: string }> | undefined;
      }>
    | undefined;
  defaultQuestGiver?: string | undefined;
  defaultLocation?: string | undefined;
}

/** The bridge reply of createJournalEntry; only the fields the tool reads. */
export interface CreateJournalEntryReply {
  error?: string | undefined;
  id: string;
  name: string;
}

/** What handleCreateCampaignDashboard returns. */
export interface CampaignDashboardResult {
  success: true;
  campaignId: string;
  dashboardJournalId: string;
  dashboardName: string;
  campaignStructure: CampaignStructure;
  message: string;
}

/** One entry of a built-in campaign template. */
export interface CampaignTemplatePart {
  title: string;
  description: string;
  levels: [number, number];
  subParts?: Array<{ title: string; description: string }> | undefined;
}

/** The part of a campaign part or sub-part the status tracker reads. */
export interface StatusTrackerSource {
  id: string;
  status: string;
}

/** A tool definition as listed to MCP clients. */
export interface CampaignToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}
