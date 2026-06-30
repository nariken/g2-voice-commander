import './styles.css';
import QRCode from 'qrcode';
import { createGlasses, SAMPLE_RATE, type Glasses, type Gesture } from './glasses';
import { framesToWavBase64, totalSeconds } from './wav';
import { audioToCommand, createIssue, addComment } from './api';

const TITLE = 'ボイスコマンダー';
const MAX_SEC = 60;

type Mode = 'idle' | 'recording' | 'processing' | 'done' | 'error';

const screenEl = document.getElementById('screen') as HTMLPreElement;
const hintEl = document.getElementById('hint') as HTMLElement;
const simBar = document.getElementById('sim') as HTMLElement;
const sideloadEl = document.getElementById('sideload') as HTMLElement;

let glasses: Glasses;
let mode: Mode = 'idle';
let frames: Float32Array[] = [];
let recStart = 0;
let recTimer: ReturnType<typeof setInterval> | null = null;
let level = 0; // smoothed mic level 0..1 (live from onAudio)
let meterPhase = 0; // animation step for the equalizer

const idleText = () =>
  [TITLE, '', 'タップで録音開始', '', '声で Issue / PRD / コメント'].join('\n');

// Text equalizer driven by the real mic level, with a little per-bar motion.
const RAMP = ' ▁▂▃▄▅▆▇█';
function meter(): string {
  const n = 14;
  let s = '';
  for (let i = 0; i < n; i++) {
    const v = level * (0.5 + 0.5 * Math.abs(Math.sin(meterPhase * 0.6 + i * 0.7)));
    s += RAMP[Math.min(8, Math.max(0, Math.round(v * 8)))];
  }
  return s;
}

const recText = () => {
  const sec = Math.floor((Date.now() - recStart) / 1000);
  return ['● 録音中…', '', `${sec}s / ${MAX_SEC}s`, '', meter(), '', 'タップで停止'].join('\n');
};

async function toIdle(): Promise<void> {
  mode = 'idle';
  await glasses.showText(idleText());
  hintEl.textContent = glasses.isReal ? 'タップで録音開始' : 'シミュレーター：下のボタンで操作';
}

async function startRecording(): Promise<void> {
  frames = [];
  level = 0;
  meterPhase = 0;
  recStart = Date.now();
  mode = 'recording';
  await glasses.startAudio();
  await glasses.showText(recText());
  recTimer = setInterval(() => {
    if (mode !== 'recording') return;
    meterPhase++;
    void glasses.updateText(recText());
    if ((Date.now() - recStart) / 1000 >= MAX_SEC) void stopRecording();
  }, 250);
}

async function stopRecording(): Promise<void> {
  if (recTimer) {
    clearInterval(recTimer);
    recTimer = null;
  }
  await glasses.stopAudio();
  mode = 'processing';
  await glasses.showText(['要件化中…', '', '🎙 → 📝 → Linear', '', 'しばらくお待ちを'].join('\n'));
  try {
    if (totalSeconds(frames, SAMPLE_RATE) < 0.5) throw new Error('録音が短すぎます');
    const wav = framesToWavBase64(frames, SAMPLE_RATE);
    const cmd = await audioToCommand(wav);

    let head: string;
    let result;
    if (cmd.action === 'comment') {
      if (!cmd.issueId) throw new Error('対象Issueが不明。「KEN-XXX に〜」と言ってください');
      result = await addComment(cmd.issueId, cmd.comment);
      head = `✓ ${result.identifier} にコメント`;
    } else {
      const title =
        cmd.action === 'prd' && !/^PRD/i.test(cmd.title) ? `PRD: ${cmd.title}` : cmd.title;
      result = await createIssue(title, cmd.description);
      head = cmd.action === 'prd' ? `✓ PRD作成 ${result.identifier}` : `✓ Issue作成 ${result.identifier}`;
    }
    mode = 'done';
    await glasses.showText([head, '', result.title, '', 'タップで戻る'].join('\n'));
    hintEl.textContent = result.url;
  } catch (e) {
    mode = 'error';
    await glasses.showText(
      ['⚠ 失敗', '', String((e as Error).message).slice(0, 90), '', 'タップで戻る'].join('\n'),
    );
  }
}

function handleGesture(g: Gesture): void {
  if (g === 'doubleClick' && mode === 'idle') return void glasses.exit();
  switch (mode) {
    case 'idle':
      if (g === 'click') void startRecording();
      break;
    case 'recording':
      if (g === 'click') void stopRecording();
      break;
    case 'processing':
      break; // busy — ignore input
    case 'done':
    case 'error':
      if (g === 'click') void toIdle();
      break;
  }
}

function wireSimulator(): void {
  const map: Record<string, Gesture> = { 'g-tap': 'click', 'g-dtap': 'doubleClick' };
  const mock = () =>
    (window as unknown as { evenMock?: { fire: (g: Gesture) => void } }).evenMock;
  for (const [id, g] of Object.entries(map)) {
    document.getElementById(id)?.addEventListener('click', () => mock()?.fire(g));
  }
}

function showSideloadQr(): void {
  const canvas = document.getElementById('qr') as HTMLCanvasElement;
  const url = window.location.href;
  (document.getElementById('qr-url') as HTMLElement).textContent = url;
  void QRCode.toCanvas(canvas, url, { width: 180, margin: 1 }).catch(() => {
    (document.getElementById('qr-url') as HTMLElement).textContent = `QR生成に失敗: ${url}`;
  });
}

async function main(): Promise<void> {
  glasses = createGlasses({ onRender: (c) => (screenEl.textContent = c) });
  // init() FIRST — it creates the SDK bridge that onAudio/onGesture subscribe to.
  await glasses.init(idleText());
  glasses.onAudio((samples) => {
    if (mode !== 'recording') return;
    frames.push(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    level = Math.min(1, Math.max(level * 0.55, rms * 6)); // gain + smooth decay
  });
  glasses.onGesture(handleGesture);
  if (glasses.isReal) {
    simBar.classList.add('hidden');
    sideloadEl.classList.add('hidden');
  } else {
    wireSimulator();
    showSideloadQr();
  }
  await toIdle();
}

void main();
