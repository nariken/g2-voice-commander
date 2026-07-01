// G2 Voice Commander — key proxy (Cloudflare Worker).
// Holds the Gemini + Linear keys as Worker secrets so the glasses app ships
// ZERO provider keys. The app authenticates with a lightweight APP_TOKEN.
//
// Endpoints (POST, JSON):
//   /command  { wavBase64 }              -> { action, title, description, issueId, comment, eventStart, eventEnd, eventLocation }
//   /issue    { title, description }      -> { identifier, url, title }
//   /comment  { identifier, body }        -> { identifier, url, title }
//   /calendar { summary, description, location, start, end } -> { summary, start, url }

export interface Env {
  GEMINI_API_KEY: string;
  LINEAR_API_KEY: string;
  LINEAR_TEAM_ID: string;
  APP_TOKEN: string;
  // Google Calendar (personal, single-user): one-time refresh_token minted offline.
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
}

const TIME_ZONE = 'Asia/Tokyo';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

const GEMINI_MODEL = 'gemini-2.5-flash';

// Current time in JST, so Gemini can resolve relative dates ("明日15時", "来週火曜").
function nowInJst(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date());
}

const geminiPrompt = (now: string) => `あなたは優秀なプロダクトマネージャー兼開発ディレクターです。
次の音声は口頭の指示メモ（日本語または英語）。意図を判定し、構造化してください。
現在時刻（${TIME_ZONE}）: ${now}

action を次から選ぶ:
- "calendar": **日時（日付・時刻・「朝/昼/夜/夕方」など）を伴う予定・アポ・やること**は最優先で calendar。例「明日の朝に歯医者」「来週火曜10-11時 定例」「金曜の夜 飲み会」「3日後にレビュー」。title=予定名、eventStart/eventEnd=日時。
- "comment": 既存 Issue（"KEN-123" のような識別子を含む）への追記・指示（「〜に追記」「KEN-622を実装して」等）。issueId に識別子、comment に本文。
- "prd": 「PRDを作って」等、要件定義(PRD)を求めている場合。description に「## 概要 / ## 背景 / ## ゴール / ## 非ゴール / ## 要件 / ## 受け入れ条件」を含む詳細版。
- "issue": 上記以外（日時を伴わない思いつき・要望・バグ・課題メモ）。デフォルト。

判定の要点: **発話に具体的な日時・時間帯があり、それが「その時に何かする/会う」予定なら calendar。** 日時が無い、または「Issueにして」「バグ」「課題」等の明示があれば issue。「PRD」明示なら prd。

出力フィールド:
- title, description: issue / prd / calendar 用。issue/prd は Markdown（見出しは行頭、セクション間に空行、改行は実際の改行文字）。calendar では title=予定名、description=メモ（無ければ空文字）。**calendar の title は必ず埋める**（発話の用件そのもの。単語だけでも可：「歯医者」「美容院」「定例ミーティング」）。日時語（明日/朝/15時 等）は title に含めない。
- issueId, comment: comment 用（他は空文字）。
- eventStart, eventEnd: calendar 用。ISO 8601＋オフセット（例 2026-07-02T15:00:00+09:00）。現在時刻を基準に相対表現を解決。曖昧な時間帯の既定は 朝=09:00 / 昼=12:00 / 夕方=17:00 / 夜=19:00。終了時刻が不明なら開始+1時間。時刻が全く不明（日付のみ）なら朝=09:00 扱い。他の action では空文字。
- eventLocation: calendar の場所（任意、無ければ空文字）。

発話の意図を保ち、勝手に機能を足さない。聞き取れない箇所は本文末尾に「※不明瞭: …」と注記。JSON のみ返す。`;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['issue', 'prd', 'comment', 'calendar'] },
    title: { type: 'STRING' },
    description: { type: 'STRING' },
    issueId: { type: 'STRING' },
    comment: { type: 'STRING' },
    eventStart: { type: 'STRING' },
    eventEnd: { type: 'STRING' },
    eventLocation: { type: 'STRING' },
  },
  required: ['action', 'title', 'description', 'issueId', 'comment', 'eventStart', 'eventEnd', 'eventLocation'],
};

async function gemini(env: Env, wavBase64: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: wavBase64 } }, { text: geminiPrompt(nowInJst()) }] }],
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

// Exchange the stored refresh_token for a short-lived access_token (personal, single-user).
async function googleToken(env: Env): Promise<string> {
  if (!env.GOOGLE_REFRESH_TOKEN) throw new Error('カレンダー未設定 (GOOGLE_REFRESH_TOKEN)');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google auth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d: any = await res.json();
  if (!d.access_token) throw new Error('Google: access_token が取れません');
  return d.access_token;
}

async function createEvent(
  env: Env,
  ev: { summary: string; description?: string; location?: string; start: string; end: string },
) {
  const token = await googleToken(env);
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: ev.summary,
        description: ev.description || undefined,
        location: ev.location || undefined,
        start: { dateTime: ev.start, timeZone: TIME_ZONE },
        end: { dateTime: ev.end, timeZone: TIME_ZONE },
      }),
    },
  );
  if (!res.ok) throw new Error(`Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d: any = await res.json();
  return { summary: d.summary as string, start: d.start?.dateTime as string, url: d.htmlLink as string };
}

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
      if (path === '/calendar') {
        if (!body.summary || !body.start || !body.end) throw new Error('予定名・開始・終了が必要です');
        return json(
          await createEvent(env, {
            summary: body.summary,
            description: body.description,
            location: body.location,
            start: body.start,
            end: body.end,
          }),
        );
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e as Error).message) }, 502);
    }
  },
};
