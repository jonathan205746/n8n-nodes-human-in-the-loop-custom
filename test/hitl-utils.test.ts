import { describe, expect, it } from 'vitest';
import {
  ReplayGuard,
  buildSignedUrl,
  computeTimeoutPlan,
  signToken,
  verifyToken,
} from '../utils/hitl';

describe('HITL signing', () => {
  it('verifies valid signatures', () => {
    const secret = 'test-secret';
    const token = {
      requestId: 'req_123',
      decision: 'approve' as const,
      nonce: 'nonce_1',
      exp: Math.floor(Date.now() / 1000) + 300,
    };

    const sig = signToken(token, secret);
    const result = verifyToken({ ...token, sig }, secret);

    expect(result.valid).toBe(true);
    expect(result.status).toBe('ok');
  });

  it('detects tampered signatures', () => {
    const secret = 'test-secret';
    const token = {
      requestId: 'req_123',
      decision: 'approve' as const,
      nonce: 'nonce_1',
      exp: Math.floor(Date.now() / 1000) + 300,
    };

    const result = verifyToken({ ...token, sig: 'bad-signature' }, secret);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('invalid_signature');
  });

  it('marks expired links as expired', () => {
    const secret = 'test-secret';
    const token = {
      requestId: 'req_123',
      decision: 'approve' as const,
      nonce: 'nonce_1',
      exp: Math.floor(Date.now() / 1000) - 5,
    };

    const sig = signToken(token, secret);
    const result = verifyToken({ ...token, sig }, secret);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('expired');
  });

  it('builds signed urls', () => {
    const secret = 'test-secret';
    const url = buildSignedUrl(
      'https://example.com/webhook',
      {
        requestId: 'req_123',
        decision: 'reject',
        nonce: 'nonce_1',
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      secret,
    );

    expect(url).toContain('requestId=req_123');
    expect(url).toContain('decision=reject');
    expect(url).toContain('sig=');
  });
});

describe('HITL timeout plan', () => {
  it('applies weekend extension for friday', () => {
    const friday = new Date('2026-04-10T10:00:00.000Z');
    const plan = computeTimeoutPlan({
      timeoutMode: 'standard',
      chatTimeoutHours: 1,
      standardTimeoutHours: 24,
      customTimeoutHours: 24,
      weekendExtensionEnabled: true,
      weekendMinHours: 72,
      timezone: 'Europe/Berlin',
      now: friday,
    });

    expect(plan.timeoutSeconds).toBe(72 * 3600);
    expect(plan.weekendExtended).toBe(true);
  });

  it('keeps chat timeout when weekend extension disabled', () => {
    const saturday = new Date('2026-04-11T10:00:00.000Z');
    const plan = computeTimeoutPlan({
      timeoutMode: 'chat',
      chatTimeoutHours: 1,
      standardTimeoutHours: 24,
      customTimeoutHours: 24,
      weekendExtensionEnabled: false,
      weekendMinHours: 72,
      timezone: 'Europe/Berlin',
      now: saturday,
    });

    expect(plan.timeoutSeconds).toBe(3600);
    expect(plan.weekendExtended).toBe(false);
  });
});

describe('Replay guard', () => {
  it('allows first response only', () => {
    const guard = new ReplayGuard();
    const exp = Math.floor(Date.now() / 1000) + 3600;

    const first = guard.consume('req_a', 'nonce_1', exp);
    const second = guard.consume('req_a', 'nonce_2', exp);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already_completed');
  });

  it('blocks nonce replay for same request', () => {
    const guard = new ReplayGuard();
    const exp = Math.floor(Date.now() / 1000) + 3600;

    const first = guard.consume('req_a', 'nonce_1', exp);
    const second = guard.consume('req_a', 'nonce_1', exp);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });
});
