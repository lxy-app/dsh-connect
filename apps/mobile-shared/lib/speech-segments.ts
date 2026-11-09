export const FIRST_SPEECH_SEGMENT_MAX = 64;
export const SPEECH_SEGMENT_MAX = 180;

/**
 * Split replies at speakable boundaries. A shorter first segment reduces time
 * to first audio; later segments use fewer requests and natural pauses.
 */
export function splitTextForSpeech(text: string): string[] {
  const normalized = text.replace(/\r/g, '').trim();
  if (!normalized) return [];
  const units = (normalized.match(/[^。！？!?；;\n]+[。！？!?；;]*|\n+/g) ?? [normalized])
    .map((unit) => unit.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const result: string[] = [];
  let current = '';
  for (const unit of units) {
    let limit = result.length === 0 ? FIRST_SPEECH_SEGMENT_MAX : SPEECH_SEGMENT_MAX;
    if (current && `${current} ${unit}`.length <= limit) {
      current = `${current} ${unit}`;
      continue;
    }
    if (current) {
      result.push(current);
      current = '';
      limit = result.length === 0 ? FIRST_SPEECH_SEGMENT_MAX : SPEECH_SEGMENT_MAX;
    }
    if (unit.length <= limit) {
      current = unit;
      continue;
    }
    const parts = splitLongUnit(unit, limit);
    result.push(...parts.slice(0, -1));
    current = parts.at(-1) ?? '';
  }
  if (current) result.push(current);
  return result;
}

function splitLongUnit(unit: string, firstLimit: number): string[] {
  const result: string[] = [];
  let remaining = unit;
  let limit = firstLimit;
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit + 1);
    let breakAt = -1;
    for (let index = candidate.length - 1; index >= Math.floor(limit * 0.45); index -= 1) {
      if (/[\s，,、：:]/.test(candidate[index] ?? '')) {
        breakAt = index;
        break;
      }
    }
    const end = breakAt >= 0 ? breakAt + 1 : limit;
    result.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
    limit = SPEECH_SEGMENT_MAX;
  }
  if (remaining) result.push(remaining);
  return result.filter(Boolean);
}
