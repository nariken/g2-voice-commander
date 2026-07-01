// Client for the key proxy (Cloudflare Worker). This app ships NO provider keys —
// the Worker holds the Gemini/Linear keys; we authenticate with a lightweight token.
const PROXY = import.meta.env.VITE_PROXY_URL ?? '';
const TOKEN = import.meta.env.VITE_APP_TOKEN ?? '';

export type Action = 'issue' | 'prd' | 'comment' | 'calendar' | 'implement';

export interface Command {
  action: Action;
  title: string;
  description: string;
  issueId: string;
  comment: string;
  eventStart: string;
  eventEnd: string;
  eventLocation: string;
}

export interface CreatedIssue {
  identifier: string;
  url: string;
  title: string;
}

export interface CreatedEvent {
  summary: string;
  start: string;
  url: string;
}

export interface CreatedGithubIssue {
  number: number;
  url: string;
  title: string;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  if (!PROXY) throw new Error('プロキシ未設定 (.env VITE_PROXY_URL)');
  const res = await fetch(`${PROXY}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

/** Send a recording → the proxy transcribes & classifies it into a command. */
export const audioToCommand = (wavBase64: string) => call<Command>('/command', { wavBase64 });

/** Create a Linear issue (team is configured in the proxy). */
export const createIssue = (title: string, description: string) =>
  call<CreatedIssue>('/issue', { title, description });

/** Add a comment to an existing issue by identifier (e.g. "KEN-622"). */
export const addComment = (identifier: string, body: string) =>
  call<CreatedIssue>('/comment', { identifier, body });

/** Open an @claude GitHub issue → Claude Code implements it → PR (repo is configured in the proxy). */
export const requestImplementation = (title: string, description: string) =>
  call<CreatedGithubIssue>('/implement', { title, description });

/** Create a Google Calendar event (calendar is configured in the proxy). */
export const createEvent = (
  summary: string,
  start: string,
  end: string,
  description: string,
  location: string,
) => call<CreatedEvent>('/calendar', { summary, start, end, description, location });
