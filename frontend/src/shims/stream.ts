/**
 * Browser shim for Node.js 'stream' module.
 * Provides Readable, Writable, and Transform classes to prevent Vite externalization errors.
 */

import { EventEmitter } from './events';

export class Readable extends EventEmitter {
  public readable = true;
  public read(): any {
    return null;
  }
}

export class Writable extends EventEmitter {
  public writable = true;
  public write(_chunk?: any, _encoding?: any, _cb?: any): boolean {
    return true;
  }
  public end(_chunk?: any, _encoding?: any, _cb?: any): this {
    return this;
  }
}

export class Transform extends Readable {}

export default {
  Readable,
  Writable,
  Transform,
};

