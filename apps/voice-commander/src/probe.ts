// STT capability probe — decides whether keyless on-device STT (Whisper-WASM) is
// viable in the G2 WebView, or whether we must fall back to a cloud STT.
// Standalone screen (probe.html); does NOT touch the main app. Load its dev URL
// via Developer Center sideload, then tap to page through the results on the glasses.
import './styles.css';
import { createGlasses, type Glasses, type Gesture } from './glasses';

const screenEl = document.getElementById('screen') as HTMLPreElement | null;
const hintEl = document.getElementById('hint') as HTMLElement | null;

const yn = (b: boolean) => (b ? '✓' : '✗');

// wasm-feature-detect minimal validation modules (SIMD / threads-atomics).
function wasmValidate(bytes: number[]): boolean {
  try {
    return WebAssembly.validate(new Uint8Array(bytes));
  } catch {
    return false;
  }
}
const detectSimd = () =>
  wasmValidate([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const detectThreads = () =>
  wasmValidate([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11]);

const w = window as unknown as {
  flutter_inappwebview?: { callHandler?: unknown };
  MediaRecorder?: unknown;
  crossOriginIsolated?: boolean;
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
};
const nav = navigator as Navigator & { deviceMemory?: number };

const caps = {
  host: typeof w.flutter_inappwebview?.callHandler === 'function' ? 'even-webview' : 'browser',
  ua: navigator.userAgent,
  secureContext: !!window.isSecureContext,
  speechRecognition: 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window,
  getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  mediaRecorder: typeof w.MediaRecorder !== 'undefined',
  wasm: typeof WebAssembly === 'object',
  wasmSimd: detectSimd(),
  wasmThreads: detectThreads(),
  sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
  crossOriginIsolated: !!w.crossOriginIsolated,
  cores: nav.hardwareConcurrency ?? 0,
  deviceMemory: nav.deviceMemory ?? null,
};

// Full detail for the console (retrievable in browser devtools / simulator /api/console).
console.log('[PROBE]', JSON.stringify(caps, null, 2));

const whisperVerdict =
  !caps.wasm || !caps.wasmSimd
    ? '厳しい (SIMD無)'
    : caps.cores >= 4
      ? '見込みあり'
      : '要検証 (低速かも)';

const uaShort = caps.ua.length > 56 ? caps.ua.slice(0, 56) + '…' : caps.ua;

const pages = [
  ['STT能力プローブ', '', `判定 Whisper-WASM: ${whisperVerdict}`, `SIMD:${yn(caps.wasmSimd)}  threads:${yn(caps.wasmThreads)}  cores:${caps.cores}`, '', 'タップで詳細 →'].join('\n'),
  ['[1/3] 音声入力', '', `SpeechRecognition: ${yn(caps.speechRecognition)}`, `getUserMedia: ${yn(caps.getUserMedia)}`, `MediaRecorder: ${yn(caps.mediaRecorder)}`, `secureContext: ${yn(caps.secureContext)}`, '', 'タップ →'].join('\n'),
  ['[2/3] WASM', '', `wasm:${yn(caps.wasm)}   SIMD:${yn(caps.wasmSimd)}`, `threads:${yn(caps.wasmThreads)}   SAB:${yn(caps.sharedArrayBuffer)}`, `crossOriginIsolated:${yn(caps.crossOriginIsolated)}`, `cores:${caps.cores}   mem:${caps.deviceMemory ?? '?'}GB`, '', 'タップ →'].join('\n'),
  ['[3/3] 環境', '', `host: ${caps.host}`, 'UA:', uaShort, '', 'タップで最初へ / ●●で終了'].join('\n'),
];

let page = 0;
let glasses: Glasses;

const show = () => glasses.showText(pages[page]);

function onGesture(g: Gesture): void {
  if (g === 'doubleClick') return void glasses.exit();
  if (g === 'click') {
    page = (page + 1) % pages.length;
    void show();
  }
}

async function main(): Promise<void> {
  glasses = createGlasses({ onRender: (c) => { if (screenEl) screenEl.textContent = c; } });
  await glasses.init(pages[0]); // init() BEFORE onGesture (bridge is created in init)
  glasses.onGesture(onGesture);
  if (hintEl) hintEl.textContent = glasses.isReal ? 'タップでページ送り / ●●で終了' : 'ブラウザ: Mock表示';
  await show();
}

void main();
