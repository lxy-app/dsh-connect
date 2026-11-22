/** Keep picker suggestions to one conservative filename, never a desktop path. */
export function sanitizeAttachmentFileName(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return cleaned.length === 0 || cleaned === '.' || cleaned === '..' ? 'attachment' : cleaned;
}
