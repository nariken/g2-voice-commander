/** Total recorded duration in seconds. */
export function totalSeconds(frames: Float32Array[], sampleRate: number): number {
  let n = 0;
  for (const f of frames) n += f.length;
  return n / sampleRate;
}

/** Concatenate recorded Float32 frames → base64-encoded 16-bit mono PCM WAV. */
export function framesToWavBase64(frames: Float32Array[], sampleRate: number): string {
  let total = 0;
  for (const f of frames) total += f.length;

  const dataLen = total * 2;
  const bytes = new Uint8Array(44 + dataLen);
  const dv = new DataView(bytes.buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  dv.setUint32(40, dataLen, true);

  let off = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  // base64 (chunked to avoid huge call-stack on String.fromCharCode)
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
