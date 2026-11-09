/** Coalesce identical cache publications without exposing a partial destination. */
export class KeyedPublishQueue<T> {
  private readonly tasks = new Map<string, Promise<T>>();

  get(key: string): Promise<T> | null {
    return this.tasks.get(key) ?? null;
  }

  run(key: string, publish: () => Promise<T>): Promise<T> {
    const existing = this.tasks.get(key);
    if (existing) return existing;
    const task = Promise.resolve().then(publish);
    this.tasks.set(key, task);
    void task.finally(() => {
      if (this.tasks.get(key) === task) this.tasks.delete(key);
    }).catch(() => undefined);
    return task;
  }
}
