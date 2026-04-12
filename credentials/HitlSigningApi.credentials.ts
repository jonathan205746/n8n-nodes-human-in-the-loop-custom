import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class HitlSigningApi implements ICredentialType {
  name = 'hitlSigningApi';

  displayName = 'HITL Signing Secret';

  documentationUrl = 'https://github.com/chrishdx/n8n-nodes-human-in-the-loop-custom';

  properties: INodeProperties[] = [
    {
      displayName: 'Signing Secret',
      name: 'signingSecret',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description: 'Shared HMAC secret used to sign and validate HITL response links.',
    },
  ];
}
