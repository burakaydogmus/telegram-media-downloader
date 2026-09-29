/** Subset of the Web Locks API (`navigator.locks`) used for cross-context locking. */
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/**
 * Serializes async tasks per key: a task starts only after every previously
 * queued task for the same key has settled (fulfilled or rejected).
 * When a `LockManagerLike` is supplied, each task additionally runs under a
 * named Web Lock so same-origin contexts (e.g. several Telegram tabs) queue too.
 */
export class KeyMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly locks?: LockManagerLike,
    private readonly lockPrefix = 'tgmd-lock:',
  ) {}

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const locks = this.locks;
    const guarded = locks ? () => locks.request(this.lockPrefix + key, task) : task;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(guarded, guarded);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Resolves once all tasks queued so far (for every key) have settled. */
  async idle(): Promise<void> {
    await Promise.all([...this.tails.values()]);
  }
}
