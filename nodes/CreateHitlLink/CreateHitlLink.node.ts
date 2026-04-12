import {
  NodeConnectionTypes,
  NodeOperationError,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import {
  buildSignedUrl,
  computeTimeoutPlan,
  createNonce,
  createRequestId,
  parseGroupConfig,
  parseOptionalJson,
  resolveGroup,
  type HitlDecision,
} from '../../utils/hitl';

type ResponseMode = 'approval' | 'approvalWithText' | 'freeText';

function buildMessageMarkdown(params: {
  question: string;
  responseMode: ResponseMode;
  links: Record<HitlDecision, string>;
  requestId: string;
  waitUntilIso: string;
  fallbackResponse: string;
}): string {
  const lines: string[] = [];

  lines.push('## Human in the Loop Request');
  lines.push('');
  lines.push(`**Request ID:** ${params.requestId}`);
  lines.push(`**Deadline:** ${params.waitUntilIso}`);
  lines.push('');
  lines.push('### Question');
  lines.push(params.question);
  lines.push('');
  lines.push('### Actions');

  if (params.responseMode === 'approval' || params.responseMode === 'approvalWithText') {
    lines.push(`- Approve: ${params.links.approve}`);
    lines.push(`- Reject: ${params.links.reject}`);
  }

  if (params.responseMode === 'approvalWithText' || params.responseMode === 'freeText') {
    lines.push(`- Provide Details: ${params.links.respond}`);
  }

  lines.push('');
  lines.push('### Timeout Fallback');
  lines.push(params.fallbackResponse);

  return lines.join('\n');
}

export class CreateHitlLink implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Create HITL Link',
    name: 'createHitlLink',
    icon: 'fa:user-clock',
    group: ['transform'],
    version: 1,
    description: 'Create signed Human-in-the-Loop response links and SLA metadata',
    defaults: {
      name: 'Create HITL Link',
    },
    credentials: [
      {
        name: 'hitlSigningApi',
        required: true,
      },
    ],
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    properties: [
      {
        displayName: 'Question',
        name: 'question',
        type: 'string',
        required: true,
        default: '',
        typeOptions: {
          rows: 4,
        },
        description: 'Question that must be answered by a human.',
      },
      {
        displayName: 'Response Mode',
        name: 'responseMode',
        type: 'options',
        options: [
          {
            name: 'Approval',
            value: 'approval',
          },
          {
            name: 'Approval + Text',
            value: 'approvalWithText',
          },
          {
            name: 'Free Text',
            value: 'freeText',
          },
        ],
        default: 'approvalWithText',
        description: 'Expected response mode from human reviewers.',
      },
      {
        displayName: 'Resume URL',
        name: 'resumeUrl',
        type: 'string',
        required: true,
        default: '={{$execution.resumeUrl}}',
        description:
          'The waiting webhook URL that should receive the signed response. Use {{$execution.resumeUrl}} in workflow runs.',
      },
      {
        displayName: 'Request ID',
        name: 'requestId',
        type: 'string',
        default: '',
        description: 'Optional fixed request ID. Leave empty to auto-generate one.',
      },
      {
        displayName: 'Group Key',
        name: 'groupKey',
        type: 'string',
        default: 'default',
        description: 'Routing key for the target group inside Group Config JSON.',
      },
      {
        displayName: 'Group Config JSON',
        name: 'groupConfigJson',
        type: 'json',
        default:
          '{\n  "default": {\n    "name": "Support",\n    "recipients": ["support@example.com"],\n    "backupGroupKey": "fallback"\n  },\n  "fallback": {\n    "name": "Support Backup",\n    "recipients": ["backup@example.com"]\n  }\n}',
        typeOptions: {
          rows: 8,
        },
        description: 'Routing map for group-based delivery.',
      },
      {
        displayName: 'Timeout Mode',
        name: 'timeoutMode',
        type: 'options',
        options: [
          { name: 'Chat', value: 'chat' },
          { name: 'Standard', value: 'standard' },
          { name: 'Custom', value: 'custom' },
        ],
        default: 'standard',
      },
      {
        displayName: 'Chat Timeout (Hours)',
        name: 'chatTimeoutHours',
        type: 'number',
        default: 1,
      },
      {
        displayName: 'Standard Timeout (Hours)',
        name: 'standardTimeoutHours',
        type: 'number',
        default: 24,
      },
      {
        displayName: 'Custom Timeout (Hours)',
        name: 'customTimeoutHours',
        type: 'number',
        default: 24,
        displayOptions: {
          show: {
            timeoutMode: ['custom'],
          },
        },
      },
      {
        displayName: 'Weekend Extension Enabled',
        name: 'weekendExtensionEnabled',
        type: 'boolean',
        default: true,
        description: 'If enabled, timeout is extended to Weekend Minimum Hours on Fri/Sat/Sun.',
      },
      {
        displayName: 'Weekend Minimum Hours',
        name: 'weekendMinHours',
        type: 'number',
        default: 72,
        displayOptions: {
          show: {
            weekendExtensionEnabled: [true],
          },
        },
      },
      {
        displayName: 'Timezone',
        name: 'timezone',
        type: 'string',
        default: 'Europe/Berlin',
      },
      {
        displayName: 'Fallback Response',
        name: 'fallbackResponse',
        type: 'string',
        default: 'human_unreachable: No human response was received in time.',
        typeOptions: {
          rows: 3,
        },
      },
      {
        displayName: 'Context JSON',
        name: 'contextJson',
        type: 'json',
        default: '{}',
        typeOptions: {
          rows: 4,
        },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i += 1) {
      try {
        const credentials = await this.getCredentials('hitlSigningApi');
        const signingSecret = String(credentials.signingSecret ?? '').trim();
        if (!signingSecret) {
          throw new NodeOperationError(this.getNode(), 'Signing secret is missing in credentials');
        }

        const question = String(this.getNodeParameter('question', i, '')).trim();
        if (!question) {
          throw new NodeOperationError(this.getNode(), 'Question is required', { itemIndex: i });
        }

        const responseMode = this.getNodeParameter('responseMode', i, 'approvalWithText') as ResponseMode;
        const resumeUrl = String(this.getNodeParameter('resumeUrl', i, '')).trim();
        if (!resumeUrl) {
          throw new NodeOperationError(this.getNode(), 'Resume URL is required', { itemIndex: i });
        }

        const requestIdRaw = String(this.getNodeParameter('requestId', i, '')).trim();
        const requestId = requestIdRaw || createRequestId();

        const groupKey = String(this.getNodeParameter('groupKey', i, 'default')).trim() || 'default';
        const groupConfigJson = String(this.getNodeParameter('groupConfigJson', i, '{}'));
        const groups = parseGroupConfig(groupConfigJson);
        const group = resolveGroup(groupKey, groups);

        const timeoutMode = this.getNodeParameter('timeoutMode', i, 'standard') as
          | 'chat'
          | 'standard'
          | 'custom';

        const timeoutPlan = computeTimeoutPlan({
          timeoutMode,
          chatTimeoutHours: Number(this.getNodeParameter('chatTimeoutHours', i, 1)),
          standardTimeoutHours: Number(this.getNodeParameter('standardTimeoutHours', i, 24)),
          customTimeoutHours: Number(this.getNodeParameter('customTimeoutHours', i, 24)),
          weekendExtensionEnabled: Boolean(this.getNodeParameter('weekendExtensionEnabled', i, true)),
          weekendMinHours: Number(this.getNodeParameter('weekendMinHours', i, 72)),
          timezone: String(this.getNodeParameter('timezone', i, this.getTimezone() || 'UTC')),
        });

        const fallbackResponse = String(
          this.getNodeParameter('fallbackResponse', i, 'human_unreachable: No human response was received in time.'),
        );

        const contextJson = String(this.getNodeParameter('contextJson', i, '{}'));
        const context = parseOptionalJson(contextJson, 'contextJson');

        const buildDecisionUrl = (decision: HitlDecision): string =>
          buildSignedUrl(
            resumeUrl,
            {
              requestId,
              decision,
              nonce: createNonce(),
              exp: timeoutPlan.expUnix,
            },
            signingSecret,
          );

        const links: Record<HitlDecision, string> = {
          approve: buildDecisionUrl('approve'),
          reject: buildDecisionUrl('reject'),
          respond: buildDecisionUrl('respond'),
        };

        const subject = `[HITL] ${group.name} - Human decision required`;
        const markdown = buildMessageMarkdown({
          question,
          responseMode,
          links,
          requestId,
          waitUntilIso: timeoutPlan.waitUntilIso,
          fallbackResponse,
        });

        returnData.push({
          json: {
            requestId,
            status: 'pending',
            question,
            responseMode,
            links,
            routing: {
              groupKey: group.key,
              groupName: group.name,
              recipients: group.recipients,
              backupGroupKey: group.backupGroupKey,
            },
            sla: {
              timeoutSeconds: timeoutPlan.timeoutSeconds,
              waitUntil: timeoutPlan.waitUntilIso,
              reminderAt: timeoutPlan.reminderAtIso,
              escalationAt: timeoutPlan.escalationAtIso,
              weekendExtended: timeoutPlan.weekendExtended,
            },
            fallback: {
              response: fallbackResponse,
            },
            message: {
              subject,
              markdown,
              text: markdown,
            },
            context,
          },
          pairedItem: { item: i },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            },
            pairedItem: { item: i },
          });
          continue;
        }

        if (error instanceof NodeOperationError) {
          throw error;
        }

        throw new NodeOperationError(this.getNode(), error instanceof Error ? error.message : String(error), {
          itemIndex: i,
        });
      }
    }

    return [returnData];
  }
}
