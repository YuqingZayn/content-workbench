import { z } from "zod";
export const providers = [
  "mock",
  "discord",
  "x",
  "instagram",
  "facebook",
] as const;
export type Provider = (typeof providers)[number];
export const mockScenarios = [
  "success",
  "processing",
  "upload_failure",
  "submit_timeout",
  "rate_limit",
  "auth_expired",
  "rejected",
] as const;
export type MockScenario = (typeof mockScenarios)[number];
export const connectionSchema = z.object({
  targetId: z.uuid(),
  provider: z.enum(providers),
  remoteId: z.string().default(""),
  enabled: z.boolean().default(false),
  scenario: z.enum(mockScenarios).default("success"),
  graphVersion: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default("v24.0"),
  mediaEndpoint: z.string().default(""),
  clientId: z.string().default(""),
});
export type PublishConnection = z.infer<typeof connectionSchema> & {
  projectId: string;
  accountId: string;
  id: string;
  revision: number;
  status: "not_checked" | "connected" | "disconnected" | "error";
  checkedAt?: string;
  message?: string;
  verification: "simulated" | "unverified" | "verified";
  evidence?: { contentType: string; jobId: string; id: string; at: string }[];
  supportedTypes: string[];
  source: string;
  secretPresent?: boolean;
};
export type PublishSecrets = {
  token?: string;
  refreshToken?: string;
  webhook?: string;
  mediaToken?: string;
};
export type PublishResult = {
  state: "not_sent" | "accepted" | "processing" | "published" | "unknown";
  id?: string;
  url?: string;
  message?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  authError?: boolean;
};
export type Prepared = {
  ready?: boolean;
  mediaIds?: string[];
  containerId?: string;
  childIds?: string[];
  temporary?: { id: string; url: string; expiresAt: string }[];
  cleanupDone?: boolean;
};
export type Execution = {
  connectionId: string;
  connectionRevision: number;
  provider: Provider;
  remoteId?: string;
  contentType?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  attempt: number;
  nextAttemptAt?: string;
  submittedAt?: string;
  prepared?: Prepared;
  result?: PublishResult;
  error?: string;
  restored?: boolean;
  approvedAt?: string;
};
export type PublishEvent = {
  id: string;
  projectId: string;
  jobId: string;
  at: string;
  status: string;
  message: string;
  attempt: number;
};
export const irreversibleStates = [
  "submitting",
  "processing",
  "accepted",
  "published",
  "unknown",
  "completed",
  "partial",
  "cancelled",
];
