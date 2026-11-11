/**
 * Browser shim for Node.js 'events' module.
 * Prevents Vite browser externalization errors when libraries reference EventEmitter.
 */

export class EventEmitter {
  private _events: Record<string, Array<(...args: any[]) => void>> = {};

  public on(event: string, listener: (...args: any[]) => void): this {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(listener);
    return this;
  }

  public addListener(event: string, listener: (...args: any[]) => void): this {
    return this.on(event, listener);
  }

  public once(event: string, listener: (...args: any[]) => void): this {
    const g = (...args: any[]) => {
      this.removeListener(event, g);
      listener.apply(this, args);
    };
    (g as any).listener = listener;
    return this.on(event, g);
  }

  public off(event: string, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener);
  }

  public removeListener(event: string, listener: (...args: any[]) => void): this {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter(
      (fn) => fn !== listener && (fn as any).listener !== listener
    );
    return this;
  }

  public removeAllListeners(event?: string): this {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
    return this;
  }

  public emit(event: string, ...args: any[]): boolean {
    if (!this._events[event] || this._events[event].length === 0) return false;
    const listeners = [...this._events[event]];
    for (const fn of listeners) {
      fn.apply(this, args);
    }
    return true;
  }

  public listeners(event: string): Array<(...args: any[]) => void> {
    return this._events[event] ? [...this._events[event]] : [];
  }

  public listenerCount(event: string): number {
    return this._events[event] ? this._events[event].length : 0;
  }
}

export default {
  EventEmitter,
};

