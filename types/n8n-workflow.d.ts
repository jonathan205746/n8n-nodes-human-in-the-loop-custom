declare module 'n8n-workflow' {
  export const NodeConnectionTypes: {
    Main: string;
  };

  export const WAIT_INDEFINITELY: Date;

  export interface INodeExecutionData {
    json: Record<string, unknown>;
    pairedItem?: { item: number };
  }

  export interface INodeTypeDescription {
    [key: string]: unknown;
  }

  export interface IWebhookResponseData {
    noWebhookResponse?: boolean;
    webhookResponse?: string;
    workflowData?: INodeExecutionData[][];
  }

  export interface IExecuteFunctions {
    getInputData(): INodeExecutionData[];
    getNodeParameter(name: string, itemIndex: number, fallbackValue?: unknown): any;
    getCredentials(name: string): Promise<Record<string, unknown>>;
    getNode(): Record<string, unknown>;
    continueOnFail(): boolean;
    putExecutionToWait(waitTill: Date): Promise<void>;
    getTimezone(): string;
  }

  export interface IWebhookFunctions {
    getRequestObject(): {
      method: string;
      query: Record<string, unknown>;
      headers: Record<string, string>;
    };
    getResponseObject(): {
      status(code: number): { send(body: string): void };
      send(body: string): void;
      setHeader(name: string, value: string): void;
    };
    getBodyData(): Record<string, unknown>;
    getNodeParameter(name: string, itemIndex: number, fallbackValue?: unknown): any;
    getCredentials(name: string): Promise<Record<string, unknown>>;
  }

  export interface INodeType {
    description: INodeTypeDescription;
    execute?(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
    webhook?(this: IWebhookFunctions): Promise<IWebhookResponseData>;
  }

  export class NodeOperationError extends Error {
    constructor(node: unknown, message: string, options?: { description?: string; itemIndex?: number });
  }

  export interface ICredentialType {
    name: string;
    displayName: string;
    documentationUrl?: string;
    icon?: string;
    properties: unknown[];
    test?: unknown;
  }

  export interface INodeProperties {
    [key: string]: unknown;
  }
}
