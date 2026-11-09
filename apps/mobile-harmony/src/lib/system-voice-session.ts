/**
 * Native system-ASR events have no session identifier. Keep a cancelled or
 * failed session closed until its terminal `end` arrives so it cannot reset or
 * populate the next recording.
 */
export class SystemVoiceSessionGuard {
  private closing = false;

  isClosing(): boolean {
    return this.closing;
  }

  canStart(): boolean {
    return !this.closing;
  }

  beginClosing(): void {
    this.closing = true;
  }

  consumeTerminalEnd(): boolean {
    if (!this.closing) return false;
    this.closing = false;
    return true;
  }
}
