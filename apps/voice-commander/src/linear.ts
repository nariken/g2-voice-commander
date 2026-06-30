const ENDPOINT = 'https://api.linear.app/graphql';

export interface CreatedIssue {
  identifier: string;
  url: string;
  title: string;
}

/** apiKey = Linear personal API key (used directly in Authorization, no "Bearer"). */
async function gql<T>(apiKey: string, query: string, variables: unknown): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.errors?.length) throw new Error(`Linear: ${data.errors[0]?.message ?? 'GraphQL error'}`);
  return data.data as T;
}

const CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier url title } }
}`;

export async function createIssue(
  apiKey: string,
  teamId: string,
  title: string,
  description: string,
): Promise<CreatedIssue> {
  const d = await gql<{ issueCreate: { success: boolean; issue: CreatedIssue } }>(apiKey, CREATE, {
    input: { teamId, title, description },
  });
  if (!d.issueCreate?.success || !d.issueCreate.issue) throw new Error('Linear: 作成に失敗');
  return d.issueCreate.issue;
}

const FIND = `query($id: String!) { issue(id: $id) { id identifier url title } }`;
const COMMENT = `mutation($input: CommentCreateInput!) {
  commentCreate(input: $input) { success }
}`;

/** Add a comment to an existing issue referenced by its identifier (e.g. "KEN-622"). */
export async function addComment(
  apiKey: string,
  identifier: string,
  body: string,
): Promise<CreatedIssue> {
  const found = await gql<{ issue: { id: string } & CreatedIssue }>(apiKey, FIND, { id: identifier });
  if (!found.issue) throw new Error(`Issue ${identifier} が見つかりません`);
  const c = await gql<{ commentCreate: { success: boolean } }>(apiKey, COMMENT, {
    input: { issueId: found.issue.id, body },
  });
  if (!c.commentCreate?.success) throw new Error('Linear: コメント作成に失敗');
  return { identifier: found.issue.identifier, url: found.issue.url, title: found.issue.title };
}
