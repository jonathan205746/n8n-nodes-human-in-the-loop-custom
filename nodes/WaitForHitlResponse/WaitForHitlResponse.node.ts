import {
  NodeConnectionTypes,
  NodeOperationError,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type IWebhookFunctions,
  type IWebhookResponseData,
} from 'n8n-workflow';
import { ReplayGuard, escapeHtml, formatIsoOrThrow, verifyToken } from '../../utils/hitl';

const replayGuard = new ReplayGuard();

function renderPage(title: string, message: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 24px; color: #1f2937; }
    .card { max-width: 680px; padding: 20px; border: 1px solid #d1d5db; border-radius: 10px; }
    h1 { margin-top: 0; font-size: 22px; }
    p { line-height: 1.45; }
    a { color: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function renderRespondForm(params: {
  requestId: string;
  nonce: string;
  exp: number;
  sig: string;
  actionUrl: string;
}): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Provide HITL Response</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 24px; color: #111827; }
    .card { max-width: 760px; padding: 20px; border: 1px solid #d1d5db; border-radius: 10px; }
    label { display: block; font-weight: 600; margin-bottom: 8px; }
    textarea { width: 100%; min-height: 180px; padding: 10px; border: 1px solid #9ca3af; border-radius: 8px; font: inherit; }
    button { margin-top: 12px; background: #0f766e; color: #fff; border: 0; border-radius: 8px; padding: 10px 14px; cursor: pointer; }
    .meta { margin-top: 12px; color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Provide HITL Response</h1>
    <form method="post" action="${escapeHtml(params.actionUrl)}">
      <input type="hidden" name="requestId" value="${escapeHtml(params.requestId)}" />
      <input type="hidden" name="decision" value="respond" />
      <input type="hidden" name="nonce" value="${escapeHtml(params.nonce)}" />
      <input type="hidden" name="exp" value="${escapeHtml(String(params.exp))}" />
      <input type="hidden" name="sig" value="${escapeHtml(params.sig)}" />
      <label for="answer">Response</label>
      <textarea id="answer" name="answer" required></textarea>
      <button type="submit">Submit</button>
    </form>
    <div class="meta">Request ID: ${escapeHtml(params.requestId)}</div>
  </div>
</body>
</html>`;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractTokenData(
  method: string,
  query: Record<string, unknown>,
  body: Record<string, unknown>,
): {
  requestId: string;
  decision: string;
  nonce: string;
  exp: string;
  sig: string;
  answerText: string;
} {
  const source = method === 'POST' ? { ...query, ...body } : query;

  return {
    requestId: stringField(source.requestId),
    decision: stringField(source.decision),
    nonce: stringField(source.nonce),
    exp: stringField(source.exp),
    sig: stringField(source.sig),
    answerText: stringField(source.answer || source.response || source.text),
  };
}

export class WaitForHitlResponse implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Wait For HITL Response',
    name: 'waitForHitlResponse',
    icon: 'fa:hourglass-half',
    group: ['organization'],
    version: 1,
    description: 'Wait for signed human response callbacks and resume workflow',
    defaults: {
      name: 'Wait For HITL Response',
      color: '#0f766e',
    },
    credentials: [
      {
        name: 'hitlSigningApi',
        required: true,
      },
    ],
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'GET',
        responseMode: 'onReceived',
        responseData: '',
        path: '={{ $nodeId }}',
        restartWebhook: true,
        isFullPath: true,
      },
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        responseData: '',
        path: '={{ $nodeId }}',
        restartWebhook: true,
        isFullPath: true,
      },
    ],
    properties: [
      {
        displayName: 'Request ID',
        name: 'requestId',
        type: 'string',
        required: true,
        default: '={{$json.requestId}}',
      },
      {
        displayName: 'Wait Until',
        name: 'waitUntil',
        type: 'dateTime',
        required: true,
        default: '={{$json.sla.waitUntil}}',
      },
      {
        displayName: 'Fallback Response',
        name: 'fallbackResponse',
        type: 'string',
        default: '={{$json.fallback.response || "human_unreachable: No human response was received in time."}}',
      },
      {
        displayName: 'Require Text For Respond',
        name: 'requireTextForRespond',
        type: 'boolean',
        default: true,
      },
    ],
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject();
    const response = this.getResponseObject();
    const method = String(request.method || 'GET').toUpperCase();

    if (method !== 'GET' && method !== 'POST') {
      response.status(405).send(renderPage('Method Not Allowed', 'Only GET and POST are supported.'));
      return { noWebhookResponse: true };
    }

    const query = (request.query || {}) as Record<string, unknown>;
    const body = (this.getBodyData() || {}) as Record<string, unknown>;
    const tokenData = extractTokenData(method, query, body);

    const credentials = await this.getCredentials('hitlSigningApi');
    const signingSecret = String(credentials.signingSecret ?? '').trim();

    if (!signingSecret) {
      response.status(500).send(renderPage('Configuration Error', 'Signing secret is not configured.'));
      return { noWebhookResponse: true };
    }

    const verification = verifyToken(
      {
        requestId: tokenData.requestId,
        decision: tokenData.decision,
        nonce: tokenData.nonce,
        exp: tokenData.exp,
        sig: tokenData.sig,
      },
      signingSecret,
    );

    if (!verification.valid || !verification.token) {
      if (verification.status === 'expired') {
        response.status(410).send(renderPage('Link Expired', 'This approval link has expired.'));
      } else if (verification.status === 'invalid_signature') {
        response.status(401).send(renderPage('Invalid Signature', 'The link signature is invalid.'));
      } else {
        response.status(400).send(renderPage('Invalid Request', 'Required link parameters are missing or invalid.'));
      }
      return { noWebhookResponse: true };
    }

    if (method === 'GET' && verification.token.decision === 'respond') {
      if (!replayGuard.canRender(verification.token.requestId, verification.token.exp)) {
        response.status(409).send(renderPage('Already Processed', 'This request was already answered.'));
        return { noWebhookResponse: true };
      }

      const basePath = String(request.query && request.query._path ? request.query._path : '');
      const actionUrl = basePath || '';

      response.send(
        renderRespondForm({
          requestId: verification.token.requestId,
          nonce: verification.token.nonce,
          exp: verification.token.exp,
          sig: tokenData.sig,
          actionUrl,
        }),
      );

      return { noWebhookResponse: true };
    }

    const requireTextForRespond = Boolean(this.getNodeParameter('requireTextForRespond', 0, true));

    if (verification.token.decision === 'respond' && requireTextForRespond && !tokenData.answerText) {
      response.status(400).send(renderPage('Response Missing', 'A text response is required.'));
      return { noWebhookResponse: true };
    }

    const consumeResult = replayGuard.consume(
      verification.token.requestId,
      verification.token.nonce,
      verification.token.exp,
    );

    if (!consumeResult.ok) {
      const message =
        consumeResult.reason === 'expired'
          ? 'This approval link has expired.'
          : 'This request was already answered by another user.';

      response.status(409).send(renderPage('Request Already Closed', message));
      return { noWebhookResponse: true };
    }

    const status = verification.token.decision === 'reject' ? 'rejected' : 'answered';

    return {
      webhookResponse: renderPage('Response Recorded', 'Your response was recorded. This page can be closed.'),
      workflowData: [
        [
          {
            json: {
              requestId: verification.token.requestId,
              status,
              decision: verification.token.decision,
              answerText: tokenData.answerText || null,
              respondedAt: new Date().toISOString(),
              fallbackUsed: false,
              raw: {
                method,
                query,
                body,
              },
            },
          },
        ],
      ],
    };
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const inputItems = this.getInputData();

    if (inputItems.length !== 1) {
      throw new NodeOperationError(
        this.getNode(),
        'Wait For HITL Response expects exactly one item. Split items before this node if needed.',
      );
    }

    const requestId = String(this.getNodeParameter('requestId', 0, '')).trim();
    if (!requestId) {
      throw new NodeOperationError(this.getNode(), 'requestId is required');
    }

    const waitUntilRaw = String(this.getNodeParameter('waitUntil', 0, ''));
    const waitUntil = formatIsoOrThrow(waitUntilRaw, 'waitUntil');

    const fallbackResponse = String(
      this.getNodeParameter('fallbackResponse', 0, 'human_unreachable: No human response was received in time.'),
    );

    const timeoutPayload: INodeExecutionData = {
      json: {
        requestId,
        status: 'timeout',
        decision: null,
        answerText: null,
        respondedAt: null,
        fallbackUsed: true,
        fallbackResponse,
        message: fallbackResponse,
      },
      pairedItem: { item: 0 },
    };

    await this.putExecutionToWait(waitUntil);

    return [[timeoutPayload]];
  }
}
