// G2 Voice Commander — key proxy (Cloudflare Worker).
// Holds the Gemini + Linear keys as Worker secrets so the glasses app ships
// ZERO provider keys. The app authenticates with a lightweight APP_TOKEN.
//
// Endpoints (POST, JSON):
//   /command  { wavBase64 }              -> { action, title, description, issueId, comment }
//   /issue    { title, description }      -> { identifier, url, title }
//   /comment  { identifier, body }        -> { identifier, url, title }

export interface Env {
  GEMINI_API_KEY: string;
  LINEAR_API_KEY: string;
  LINEAR_TEAM_ID: string;
  APP_TOKEN: string;
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_PROMPT = `あなたは優秀なプロダクトマネージャー兼開発ディレクターです。
次の音声は口頭の指示メモ（日本語または英語）。意図を判定し、Linear 用に構造化してください。

action を次から選ぶ:
- "issue": 思いつき・要望・バグなど、新しい Issue にすべきもの（デフォルト）。
- "prd": 「PRDを作って」等、要件定義(PRD)を求めている場合。description に「## 概要 / ## 背景 / ## ゴール / ## 非ゴール / ## 要件 / ## 受け入れ条件」を含む詳細版。
- "comment": 既存 Issue（"KEN-123" のような識別子を含む）への追記・指示（「〜に追記」「KEN-622を実装して」等）。issueId に識別子、comment に本文。

出力フィールド:
- title, description: issue / prd 用。Markdown。見出しは行頭、見出しと本文・各セクションの間に空行を入れ、改行は \\n エスケープでなく実際の改行文字を使う。
- issueId, comment: comment 用（issue/prd の場合は空文字）。

発話の意図を保ち、勝手に機能を足さない。聞き取れない箇所は本文末尾に「※不明瞭: …」と注記。JSON のみ返す。`;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['issue', 'prd', 'comment'] },
    title: { type: 'STRING' },
    description: { type: 'STRING' },
    issueId: { type: 'STRING' },
    comment: { type: 'STRING' },
  },
  required: ['action', 'title', 'description', 'issueId', 'comment'],
};

async function gemini(env: Env, wavBase64: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: wavBase64 } }, { text: GEMINI_PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d: any = await res.json();
  const t = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!t) throw new Error('Gemini: 空の応答');
  return JSON.parse(t);
}

async function linear(env: Env, query: string, variables: unknown) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: env.LINEAR_API_KEY },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d: any = await res.json();
  if (d.errors?.length) throw new Error(`Linear: ${d.errors[0]?.message ?? 'GraphQL error'}`);
  return d.data;
}

const CREATE = `mutation($input: IssueCreateInput!){ issueCreate(input:$input){ success issue { identifier url title } } }`;
const FIND = `query($id: String!){ issue(id:$id){ id identifier url title } }`;
const COMMENT = `mutation($input: CommentCreateInput!){ commentCreate(input:$input){ success } }`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!env.APP_TOKEN || request.headers.get('authorization') !== `Bearer ${env.APP_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const path = new URL(request.url).pathname;
    try {
      const body: any = await request.json().catch(() => ({}));
      if (path === '/command') {
        return json(await gemini(env, body.wavBase64));
      }
      if (path === '/issue') {
        const d = await linear(env, CREATE, {
          input: { teamId: env.LINEAR_TEAM_ID, title: body.title, description: body.description },
        });
        if (!d.issueCreate?.success) throw new Error('Linear: 作成に失敗');
        return json(d.issueCreate.issue);
      }
      if (path === '/comment') {
        const f = await linear(env, FIND, { id: body.identifier });
        if (!f.issue) throw new Error(`Issue ${body.identifier} が見つかりません`);
        const c = await linear(env, COMMENT, { input: { issueId: f.issue.id, body: body.body } });
        if (!c.commentCreate?.success) throw new Error('Linear: コメント作成に失敗');
        return json({ identifier: f.issue.identifier, url: f.issue.url, title: f.issue.title });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e as Error).message) }, 502);
    }
  },
};
