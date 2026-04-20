import type { JiraConfig } from './types.js';

export class JiraConfigurationError extends Error {}
export class JiraAuthenticationError extends Error {}
export class JiraIssueNotFoundError extends Error {}
export class JiraRequestError extends Error {}

export interface ResolvedJiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface GetIssueOptions {
  fields?: string[];
}

export function resolveJiraConfig(config: JiraConfig | undefined): ResolvedJiraConfig {
  const missing: string[] = [];
  const baseUrl = config?.base_url;
  const email = config?.email;
  const apiToken = config?.api_token;

  if (!baseUrl) missing.push('jira.base_url');
  if (!email) missing.push('jira.email');
  if (!apiToken) missing.push('jira.api_token');

  if (missing.length > 0) {
    throw new JiraConfigurationError(
      `Missing Jira configuration: ${missing.join(', ')}. Use 'openspec config set' to configure Jira.`
    );
  }

  const placeholders: string[] = [];
  const normalizedBaseUrl = baseUrl!.toLowerCase();
  const hasPlaceholderBaseUrl =
    normalizedBaseUrl.includes('tuempresa.atlassian.net') ||
    normalizedBaseUrl.includes('your-company.atlassian.net');
  if (hasPlaceholderBaseUrl) {
    placeholders.push('jira.base_url');
  }
  if (hasPlaceholderBaseUrl && (email === 'dev@tuempresa.com' || email === 'dev@example.com')) {
    placeholders.push('jira.email');
  }
  if (apiToken === 'TU_TOKEN' || apiToken === 'YOUR_ATLASSIAN_API_TOKEN') {
    placeholders.push('jira.api_token');
  }

  if (placeholders.length > 0 && !normalizedBaseUrl.startsWith('http://127.0.0.1')) {
    throw new JiraConfigurationError(
      `Jira configuration still contains placeholder values: ${placeholders.join(', ')}. ` +
      "For the local sandbox demo, run 'npm run demo:jira'. " +
      "For real Jira, set your actual Atlassian site, email, API token, and use a real issue key from the Jira ticket URL."
    );
  }

  return {
    baseUrl: baseUrl!.replace(/\/+$/, ''),
    email: email!,
    apiToken: apiToken!,
  };
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export class JiraClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: ResolvedJiraConfig) {
    this.baseUrl = config.baseUrl;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
  }

  getIssueUrl(issueKey: string): string {
    return `${this.baseUrl}/browse/${encodeURIComponent(issueKey)}`;
  }

  async getIssue(issueKey: string, options: GetIssueOptions = {}): Promise<Record<string, unknown>> {
    const query = new URLSearchParams();
    if (options.fields && options.fields.length > 0) {
      query.set('fields', options.fields.join(','));
    }
    const queryString = query.toString();
    const suffix = queryString ? `?${queryString}` : '';
    const response = await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}${suffix}`, {
      method: 'GET',
    });

    if (response.status === 404) {
      throw new JiraIssueNotFoundError(`Jira issue ${issueKey} was not found.`);
    }

    await this.ensureSuccessful(response, issueKey);
    return (await response.json()) as Record<string, unknown>;
  }

  async createWorklog(issueKey: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (response.status === 404) {
      throw new JiraIssueNotFoundError(`Jira issue ${issueKey} was not found.`);
    }

    await this.ensureSuccessful(response, issueKey);
    return (await response.json()) as Record<string, unknown>;
  }

  async addComment(issueKey: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (response.status === 404) {
      throw new JiraIssueNotFoundError(`Jira issue ${issueKey} was not found.`);
    }

    await this.ensureSuccessful(response, issueKey);
    return (await response.json()) as Record<string, unknown>;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
        ...init.headers,
      },
    });
  }

  private async ensureSuccessful(response: Response, issueKey: string): Promise<void> {
    if (response.ok) {
      return;
    }

    if (response.status === 401 || response.status === 403) {
      throw new JiraAuthenticationError('Jira authentication failed. Check jira.email and jira.api_token.');
    }

    const body = await readResponseBody(response);
    const suffix = body ? ` ${body}` : '';
    throw new JiraRequestError(
      `Jira request failed for ${issueKey}: ${response.status} ${response.statusText}.${suffix}`.trim()
    );
  }
}
