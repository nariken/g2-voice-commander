// Audio-capable, supports structured JSON output. Swap to 'gemini-flash-latest'
// to auto-track the newest flash and avoid future model deprecations.
const DEFAULT_MODEL = 'gemini-2.5-flash';
const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export type Action = 'issue' | 'prd' | 'comment';

export interface Command {
  action: Action;
  title: string; // issue / prd
  description: string; // issue / prd (Markdown)
  issueId: string; // comment target identifier e.g. "KEN-622" ('' otherwise)
  comment: string; // comment body
}

const PROMPT = `あなたは優秀なプロダクトマネージャー兼開発ディレクターです。
次の音声は口頭の指示メモ（日本語または英語）。意図を判定し、Linear 用に構造化してください。

action を次から選ぶ:
- "issue": 思いつき・要望・バグなど、新しい Issue にすべきもの（デフォルト）。
- "prd": 「PRDを作って」等、要件定義(PRD)を求めている場合。description に「## 概要 / ## 背景 / ## ゴール / ## 非ゴール / ## 要件 / ## 受け入れ条件」を含む詳細版。
- "comment": 既存 Issue（"KEN-123" のような識別子を含む）への追記・指示（「〜に追記」「KEN-622を実装して」等）。issueId に識別子、comment に本文。

出力フィールド:
- title, description: issue / prd 用。Markdown。見出しは行頭、見出しと本文・各セクションの間に空行を入れ、改行は \\n エスケープでなく実際の改行文字を使う。
- issueId, comment: comment 用（issue/prd の場合は空文字）。

発話の意図を保ち、勝手に機能を足さない。聞き取れない箇所は本文末尾に「※不明瞭: …」と注記。JSON のみ返す。`;

export async function audioToCommand(
  wavBase64: string,
  apiKey: string,
  model = DEFAULT_MODEL,
): Promise<Command> {
  const res = await fetch(endpoint(model), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inlineData: { mimeType: 'audio/wav', data: wavBase64 } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', enum: ['issue', 'prd', 'comment'] },
            title: { type: 'STRING' },
            description: { type: 'STRING' },
            issueId: { type: 'STRING' },
            comment: { type: 'STRING' },
          },
          required: ['action', 'title', 'description', 'issueId', 'comment'],
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: 空の応答');
  const obj = JSON.parse(text) as Command;
  if (!obj.action) throw new Error('Gemini: action を判定できず');
  return obj;
}
