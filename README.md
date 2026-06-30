# G2 Voice Commander

Turn your [Even Realities G2](https://www.evenrealities.com/) smart glasses into a
**hands-free voice commander for your own workflow.** Speak a thought — it becomes a
structured [Linear](https://linear.app) issue, a PRD, or a comment on an existing issue,
and the glasses show you the result. No phone, no screen, no hands.

> The killer app for smart glasses might be **going all-in on private/personal use** —
> ambient, glanceable, hands-free augmentation of *your* work. This is that bet.

A series of small, self-contained Even G2 (Even Hub) plugins built with
**Even Hub SDK + TypeScript**, each a step toward an ambient *agentic dev cockpit*.

![G2 Voice Commander demo — speak → Issue / PRD / comment on Linear](apps/voice-commander/media/demo.gif)

> Tap → speak → Gemini classifies the intent → it lands as a Linear **Issue**, a **PRD**,
> or a **comment** on an existing issue. (Green dot-art is the actual G2 monochrome display.)

## Apps

| App | What it does | Status |
| --- | --- | --- |
| [`apps/voice-commander`](apps/voice-commander) | Tap → speak → Gemini turns it into a Linear **Issue / PRD / comment** → glasses show `✓ KEN-123` | ✅ device-verified MVP |

_(more in the series to come)_

## The vision — an ambient agentic dev loop

The glasses as the **voice-in / status-out** surface for orchestrating AI agents on your work:

1. **Issue作成** — speak a thought → Linear issue. *(shipped)*
2. **AI commands** — “make a PRD”, “summarize requirements”, route by spoken intent. *(shipped)*
3. **Claude Code link** — hand off an issue # → implementation starts → progress on the glasses.
4. **Two-way notifications** — “done”, “review pending”, “CI failed”, “PR created” pushed to the HUD.
5. **Multi-agent** — ChatGPT (sparring) · Claude Code (build) · Linear (tasks) · GitHub (PRs) · G2 (UI).

Architecture note: stages 1–2 are **client-only** (glasses → SaaS APIs directly). Stage 3+
adds a small orchestrator and uses **Linear/GitHub as the shared event bus** — agents write
status there, the glasses read it.

## Run it

Each app is a standalone Vite + TypeScript project. **Bring your own API keys** — they are
read from `.env` at build time, so this is a **personal sideload** (never publish a build:
the bundle embeds your keys).

```bash
cd apps/voice-commander
cp .env.example .env        # then fill in your keys
npm install
npm run dev                 # serves on your LAN (host:true)
```

Open the dev URL on your **LAN IP** and scan the on-screen QR in the Even Realities app →
Developer Center. (No public tunnel needed — these apps don't require https/secure-context.
Keeping it on your LAN keeps your embedded keys off public networks.)

**Keys for `apps/voice-commander`:**
- `VITE_GEMINI_API_KEY` — [Google AI Studio](https://aistudio.google.com)
- `VITE_LINEAR_API_KEY` — Linear → Settings → Security & access → Personal API keys (needs write)

## Safety

- `.env`, `dist/`, and `*.ehpk` are git-ignored — they embed your keys. **Never commit them.**
- These are personal-use sideload apps. Do **not** upload a keyed build to the public app store.

## License

[MIT](LICENSE) © Ken Narita
