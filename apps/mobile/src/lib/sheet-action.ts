// iOS must finish dismissing one native modal before presenting the next.
export class SheetAction {
  private pending: (() => void) | null = null;

  select(close: () => void, action: () => void, waitForDismiss: boolean) {
    if (this.pending) return;
    this.pending = action;
    close();
    if (!waitForDismiss) this.dismissed();
  }

  dismissed() {
    const action = this.pending;
    this.pending = null;
    action?.();
  }
}
