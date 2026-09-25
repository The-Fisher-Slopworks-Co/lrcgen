export function msToLrc(ms: number): string {
  const totalHundredths = Math.round(ms / 10);
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

// Accepts tenths, hundredths or milliseconds after the dot: other tools write all three.
export const LRC_TIME_PATTERN = String.raw`\d{2,}:\d{2}\.\d{1,3}`;

export function lrcToMs(lrc: string): number | null {
  const match = lrc.match(/^(\d{2,}):(\d{2})\.(\d{1,3})$/);
  if (!match) return null;
  const minutes = parseInt(match[1]!, 10);
  const seconds = parseInt(match[2]!, 10);
  const millis = parseInt(match[3]!.padEnd(3, "0"), 10);
  return (minutes * 60 + seconds) * 1000 + millis;
}

export function formatPosition(ms: number): string {
  return msToLrc(ms);
}
