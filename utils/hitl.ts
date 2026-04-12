import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export type HitlDecision = 'approve' | 'reject' | 'respond';

export interface SignedToken {
  requestId: string;
  decision: HitlDecision;
  nonce: string;
  exp: number;
}

export interface VerifyTokenResult {
  valid: boolean;
  status: 'ok' | 'expired' | 'invalid_signature' | 'invalid_payload';
  token?: SignedToken;
}

export interface GroupConfigEntry {
  name?: string;
  recipients?: string[];
  backupGroupKey?: string;
}

export interface ResolvedGroup {
  key: string;
  name: string;
  recipients: string[];
  backupGroupKey: string | null;
}

export interface TimeoutConfig {
  timeoutMode: 'chat' | 'standard' | 'custom';
  chatTimeoutHours: number;
  standardTimeoutHours: number;
  customTimeoutHours: number;
  weekendExtensionEnabled: boolean;
  weekendMinHours: number;
  timezone: string;
  now?: Date;
}

export interface TimeoutPlan {
  timeoutSeconds: number;
  waitUntilIso: string;
  reminderAtIso: string;
  escalationAtIso: string;
  expUnix: number;
  weekendExtended: boolean;
}

export interface ReplayConsumeResult {
  ok: boolean;
  reason?: 'expired' | 'already_completed' | 'replay';
}

function canonicalizeToken(token: SignedToken): string {
  return `${token.requestId}|${token.decision}|${token.nonce}|${token.exp}`;
}

function parseDecision(value: unknown): HitlDecision | null {
  if (value === 'approve' || value === 'reject' || value === 'respond') {
    return value;
  }
  return null;
}

function normalizeToken(input: {
  requestId?: unknown;
  decision?: unknown;
  nonce?: unknown;
  exp?: unknown;
}): SignedToken | null {
  const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
  const decision = parseDecision(input.decision);
  const nonce = typeof input.nonce === 'string' ? input.nonce.trim() : '';
  const expRaw = typeof input.exp === 'string' ? Number(input.exp) : input.exp;
  const exp = typeof expRaw === 'number' ? Math.floor(expRaw) : NaN;

  if (!requestId || !decision || !nonce || !Number.isFinite(exp) || exp <= 0) {
    return null;
  }

  return { requestId, decision, nonce, exp };
}

function safeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

function appendQuery(baseUrl: string, query: URLSearchParams): string {
  try {
    const url = new URL(baseUrl);
    for (const [key, value] of query.entries()) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    const join = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${join}${query.toString()}`;
  }
}

function getWeekdayLabel(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
  }
}

export function createRequestId(): string {
  return randomUUID();
}

export function signToken(token: SignedToken, secret: string): string {
  return createHmac('sha256', secret).update(canonicalizeToken(token)).digest('hex');
}

export function buildSignedUrl(
  baseUrl: string,
  token: SignedToken,
  secret: string,
  extraParams: Record<string, string> = {},
): string {
  const signature = signToken(token, secret);
  const params = new URLSearchParams({
    requestId: token.requestId,
    decision: token.decision,
    nonce: token.nonce,
    exp: String(token.exp),
    sig: signature,
    ...extraParams,
  });
  return appendQuery(baseUrl, params);
}

export function verifyToken(
  input: {
    requestId?: unknown;
    decision?: unknown;
    nonce?: unknown;
    exp?: unknown;
    sig?: unknown;
  },
  secret: string,
  nowMs = Date.now(),
): VerifyTokenResult {
  const token = normalizeToken(input);
  const signature = typeof input.sig === 'string' ? input.sig : '';

  if (!token || !signature) {
    return { valid: false, status: 'invalid_payload' };
  }

  if (token.exp <= Math.floor(nowMs / 1000)) {
    return { valid: false, status: 'expired', token };
  }

  const expected = signToken(token, secret);
  if (!safeCompare(expected, signature)) {
    return { valid: false, status: 'invalid_signature', token };
  }

  return { valid: true, status: 'ok', token };
}

export function parseOptionalJson(value: string, fieldName: string): Record<string, unknown> {
  if (!value || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${fieldName}: ${message}`);
  }
}

export function parseGroupConfig(jsonValue: string): Record<string, GroupConfigEntry> {
  if (!jsonValue || !jsonValue.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(jsonValue);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('groupConfigJson must be a JSON object');
    }
    return parsed as Record<string, GroupConfigEntry>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid groupConfigJson: ${message}`);
  }
}

export function resolveGroup(groupKey: string, groups: Record<string, GroupConfigEntry>): ResolvedGroup {
  const normalizedKey = groupKey.trim() || 'default';
  const selected = groups[normalizedKey] ?? groups.default ?? {};

  const recipients = Array.isArray(selected.recipients)
    ? selected.recipients.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  return {
    key: normalizedKey,
    name: typeof selected.name === 'string' && selected.name.trim().length > 0 ? selected.name : normalizedKey,
    recipients,
    backupGroupKey:
      typeof selected.backupGroupKey === 'string' && selected.backupGroupKey.trim().length > 0
        ? selected.backupGroupKey
        : null,
  };
}

export function computeTimeoutPlan(config: TimeoutConfig): TimeoutPlan {
  const now = config.now ?? new Date();

  const timeoutByMode = {
    chat: config.chatTimeoutHours,
    standard: config.standardTimeoutHours,
    custom: config.customTimeoutHours,
  };

  let timeoutHours = timeoutByMode[config.timeoutMode];
  if (!Number.isFinite(timeoutHours) || timeoutHours <= 0) {
    timeoutHours = 24;
  }

  const weekendMinHours = Number.isFinite(config.weekendMinHours) && config.weekendMinHours > 0 ? config.weekendMinHours : 72;

  const weekday = getWeekdayLabel(now, config.timezone);
  const weekendWindow = weekday === 'Fri' || weekday === 'Sat' || weekday === 'Sun';
  let weekendExtended = false;

  if (config.weekendExtensionEnabled && weekendWindow && timeoutHours < weekendMinHours) {
    timeoutHours = weekendMinHours;
    weekendExtended = true;
  }

  const timeoutSeconds = Math.max(1, Math.round(timeoutHours * 3600));
  const waitUntilMs = now.getTime() + timeoutSeconds * 1000;
  const reminderAtMs = now.getTime() + Math.round(timeoutSeconds * 0.5) * 1000;
  const escalationAtMs = now.getTime() + Math.round(timeoutSeconds * 0.85) * 1000;

  return {
    timeoutSeconds,
    waitUntilIso: new Date(waitUntilMs).toISOString(),
    reminderAtIso: new Date(reminderAtMs).toISOString(),
    escalationAtIso: new Date(escalationAtMs).toISOString(),
    expUnix: Math.floor(waitUntilMs / 1000),
    weekendExtended,
  };
}

export class ReplayGuard {
  private readonly usedNonces = new Map<string, number>();

  private readonly completedRequests = new Map<string, number>();

  private cleanup(nowUnix: number): void {
    for (const [key, exp] of this.usedNonces.entries()) {
      if (exp <= nowUnix) {
        this.usedNonces.delete(key);
      }
    }

    for (const [requestId, exp] of this.completedRequests.entries()) {
      if (exp <= nowUnix) {
        this.completedRequests.delete(requestId);
      }
    }
  }

  canRender(requestId: string, expUnix: number, nowUnix = Math.floor(Date.now() / 1000)): boolean {
    this.cleanup(nowUnix);
    if (expUnix <= nowUnix) {
      return false;
    }
    return !this.completedRequests.has(requestId);
  }

  consume(requestId: string, nonce: string, expUnix: number, nowUnix = Math.floor(Date.now() / 1000)): ReplayConsumeResult {
    this.cleanup(nowUnix);

    if (expUnix <= nowUnix) {
      return { ok: false, reason: 'expired' };
    }

    if (this.completedRequests.has(requestId)) {
      return { ok: false, reason: 'already_completed' };
    }

    const key = `${requestId}:${nonce}`;
    if (this.usedNonces.has(key)) {
      return { ok: false, reason: 'replay' };
    }

    this.usedNonces.set(key, expUnix);
    this.completedRequests.set(requestId, expUnix);

    return { ok: true };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatIsoOrThrow(value: string, fieldName: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date/time`);
  }
  return parsed;
}

export function createNonce(): string {
  return randomUUID();
}
