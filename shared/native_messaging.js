/**
 * Native Messaging wrapper for Whisper service.
 *
 * Maintains a long-lived connection to the native host for:
 *  - Sending commands (start/stop/status/install_check)
 *  - Receiving push events (crashed, restarting)
 *  - Automatic reconnection on disconnect
 */

const NATIVE_HOST_NAME = 'com.bquantum.whisper';

class NativeMessagingClient {
  constructor() {
    this.port = null;
    this.eventHandlers = new Map();
    this.reconnectTimer = null;
    this._pending = new Map(); // msgId -> {resolve, reject, timer}
    this._msgSeq = 0;
    this._destroyed = false;
  }

  /**
   * Connect (or reconnect) to native host.
   * @returns {Promise<boolean>} true if connected successfully
   */
  connect() {
    if (this._destroyed) return Promise.resolve(false);

    // Close existing port if any
    this.disconnect();

    return new Promise((resolve) => {
      try {
        this.port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

        this.port.onMessage.addListener((msg) => {
          this._handleMessage(msg);
        });

        this.port.onDisconnect.addListener(() => {
          const lastError = chrome.runtime.lastError;
          this.port = null;
          this._rejectAllPending(new Error(lastError?.message || 'Native host disconnected'));

          // Notify listeners
          this._emit('disconnect', { error: lastError?.message });

          // Auto-reconnect after 3s (unless destroyed)
          if (!this._destroyed) {
            this.reconnectTimer = setTimeout(() => this.connect(), 3000);
          }

          resolve(false);
        });

        // Connection established (native host process is running)
        resolve(true);
      } catch (err) {
        this.port = null;
        resolve(false);
      }
    });
  }

  /**
   * Send a command and wait for response.
   * @param {object} msg - Command message (e.g. {command: 'start'})
   * @param {number} [timeout=5000] - Timeout in ms
   * @returns {Promise<object>} Response from native host
   */
  send(msg, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error('Native host not connected'));
        return;
      }

      const msgId = ++this._msgSeq;
      const msgWithId = { ...msg, _id: msgId };

      const timer = setTimeout(() => {
        this._pending.delete(msgId);
        reject(new Error(`Native host response timeout (${command})`));
      }, timeout);

      this._pending.set(msgId, { resolve, reject, timer });
      this.port.postMessage(msgWithId);
    });
  }

  /**
   * Register an event handler.
   * @param {string} event - Event name ('disconnect', 'restarting', 'crashed', etc.)
   * @param {function} handler
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * Remove an event handler.
   */
  off(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.port) {
      try { this.port.disconnect(); } catch {}
      this.port = null;
    }
    this._rejectAllPending(new Error('Native host disconnected'));
  }

  destroy() {
    this._destroyed = true;
    this.disconnect();
    this.eventHandlers.clear();
  }

  // ── Private ──

  _handleMessage(msg) {
    // Check if this is a response to a pending command
    if (msg._id && this._pending.has(msg._id)) {
      const { resolve, reject, timer } = this._pending.get(msg._id);
      clearTimeout(timer);
      this._pending.delete(msg._id);
      if (msg.status === 'error') {
        reject(new Error(msg.msg || 'Native host error'));
      } else {
        resolve(msg);
      }
      return;
    }

    // Push event from native host (e.g. restarting, crashed)
    if (msg.event) {
      this._emit(msg.event, msg);
      return;
    }

    // Legacy response format (no _id)
    // Treat as generic event
    this._emit('message', msg);
  }

  _emit(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(h => {
        try { h(data); } catch (e) { console.warn('Native event handler error:', e); }
      });
    }
  }

  _rejectAllPending(err) {
    for (const [id, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(err);
    }
    this._pending.clear();
  }
}

// Singleton
let _instance = null;

export function getNativeClient() {
  if (!_instance) {
    _instance = new NativeMessagingClient();
  }
  return _instance;
}

export function resetNativeClient() {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}
