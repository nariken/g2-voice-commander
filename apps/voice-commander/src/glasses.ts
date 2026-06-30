import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
  StartUpPageCreateResult,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

const W = 576;
const H = 288;
const MAIN_ID = 1;
const MAIN_NAME = 'main';
export const SAMPLE_RATE = 16000;

export type Gesture = 'click' | 'doubleClick' | 'swipeUp' | 'swipeDown';
export type GestureHandler = (g: Gesture) => void;
export type AudioHandler = (samples: Float32Array, sampleRate: number) => void;

export interface GlassesOptions {
  onRender?: (content: string) => void;
  forceMock?: boolean;
}

export interface Glasses {
  readonly isReal: boolean;
  init(content: string): Promise<void>;
  showText(content: string): Promise<void>;
  updateText(content: string): Promise<void>;
  onGesture(handler: GestureHandler): () => void;
  onAudio(handler: AudioHandler): () => void;
  startAudio(): Promise<void>;
  stopAudio(): Promise<void>;
  exit(): Promise<void>;
}

/** G2 touchpad input all arrives as sysEvent; tap = CLICK(0) drops to undefined. */
function gestureFromEvent(e: EvenHubEvent): Gesture | null {
  if (e.audioEvent) return null;
  const src = e.sysEvent ?? e.textEvent ?? e.listEvent;
  if (!src) return null;
  switch (src.eventType) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'swipeUp';
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'swipeDown';
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'doubleClick';
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      return 'click';
    default:
      return null;
  }
}

function decodePcm16(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
  return out;
}

const fullText = (content: string) =>
  new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: H,
    paddingLength: 8,
    containerID: MAIN_ID,
    containerName: MAIN_NAME,
    isEventCapture: 1,
    content,
  });

class RealGlasses implements Glasses {
  readonly isReal = true;
  private bridge!: EvenAppBridge;

  constructor(private readonly opts: GlassesOptions) {}

  async init(content: string): Promise<void> {
    this.bridge = await waitForEvenAppBridge();
    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [fullText(content)] }),
    );
    if (result !== StartUpPageCreateResult.success) {
      throw new Error(`createStartUpPageContainer failed (code=${result})`);
    }
    this.opts.onRender?.(content);
  }

  async showText(content: string): Promise<void> {
    await this.bridge.rebuildPageContainer(
      new RebuildPageContainer({ containerTotalNum: 1, textObject: [fullText(content)] }),
    );
    this.opts.onRender?.(content);
  }

  async updateText(content: string): Promise<void> {
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: MAIN_ID,
        containerName: MAIN_NAME,
        contentOffset: 0,
        contentLength: content.length,
        content,
      }),
    );
    this.opts.onRender?.(content);
  }

  onGesture(handler: GestureHandler): () => void {
    return this.bridge.onEvenHubEvent((event: EvenHubEvent) => {
      const g = gestureFromEvent(event);
      if (g) handler(g);
    });
  }

  onAudio(handler: AudioHandler): () => void {
    return this.bridge.onEvenHubEvent((event: EvenHubEvent) => {
      const pcm = event.audioEvent?.audioPcm;
      if (pcm && pcm.length) handler(decodePcm16(pcm), SAMPLE_RATE);
    });
  }

  async startAudio(): Promise<void> {
    await this.bridge.audioControl(true);
  }
  async stopAudio(): Promise<void> {
    await this.bridge.audioControl(false);
  }
  async exit(): Promise<void> {
    await this.bridge.shutDownPageContainer(0);
  }
}

/** Browser simulator: buttons fire gestures; startAudio streams a fake tone. */
class MockGlasses implements Glasses {
  readonly isReal = false;
  private gestureHandlers: GestureHandler[] = [];
  private audioHandlers: AudioHandler[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private phase = 0;

  constructor(private readonly opts: GlassesOptions) {
    (window as unknown as { evenMock?: unknown }).evenMock = {
      fire: (g: Gesture) => this.gestureHandlers.forEach((h) => h(g)),
    };
  }

  async init(content: string): Promise<void> {
    this.opts.onRender?.(content);
  }
  async showText(content: string): Promise<void> {
    this.opts.onRender?.(content);
  }
  async updateText(content: string): Promise<void> {
    this.opts.onRender?.(content);
  }
  onGesture(handler: GestureHandler): () => void {
    this.gestureHandlers.push(handler);
    return () => {
      this.gestureHandlers = this.gestureHandlers.filter((h) => h !== handler);
    };
  }
  onAudio(handler: AudioHandler): () => void {
    this.audioHandlers.push(handler);
    return () => {
      this.audioHandlers = this.audioHandlers.filter((h) => h !== handler);
    };
  }
  async startAudio(): Promise<void> {
    if (this.timer) return;
    const frame = 1600;
    this.timer = setInterval(() => {
      const x = new Float32Array(frame);
      for (let i = 0; i < frame; i++) {
        this.phase += (2 * Math.PI * 220) / SAMPLE_RATE;
        x[i] = 0.2 * Math.sin(this.phase);
      }
      this.audioHandlers.forEach((h) => h(x, SAMPLE_RATE));
    }, 100);
  }
  async stopAudio(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  async exit(): Promise<void> {
    await this.stopAudio();
    this.opts.onRender?.('終了しました');
  }
}

function isEvenAppHost(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { flutter_inappwebview?: { callHandler?: unknown } }).flutter_inappwebview
      ?.callHandler === 'function'
  );
}

export function createGlasses(opts: GlassesOptions = {}): Glasses {
  if (isEvenAppHost() && !opts.forceMock) return new RealGlasses(opts);
  return new MockGlasses(opts);
}
