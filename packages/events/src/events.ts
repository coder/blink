export interface Disposable {
  dispose(): void;
}

export interface Event<T> {
  (listener: (event: T) => void): Disposable;
}

export class Emitter<T = void> {
  private listeners: ((event: T) => void)[] = [];

  public get event(): Event<T> {
    return (listener: (event: T) => void) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          this.listeners = this.listeners.filter((l) => l !== listener);
        },
      };
    };
  }

  public emit(event: T) {
    // Do this in reverse order so that listeners
    // that are registered in a listener are not
    // called.
    for (let i = this.listeners.length - 1; i >= 0; i--) {
      this.listeners[i]?.(event);
    }
  }

  public dispose() {
    this.listeners = [];
  }
}
