/**
 * WebSocket connection to a control-system bridge (see tools/arail_tools/bridge and
 * docs/control-system-interface.md). Every message is passed to `world.trains.apply()`.
 *
 * Note for https pages (e.g. GitHub Pages): browsers only allow `wss://` URLs, and
 * `ws://localhost`. Use the bridge with TLS, or serve the app from the bridge itself.
 * @module arail/feeds/websocket
 */
export class WebSocketFeed {
  /**
   * @param {import("../core/world.js").World} world
   * @param {{url: string, reconnect?: boolean, WebSocketImpl?: typeof WebSocket}} options
   */
  constructor(world, { url, reconnect = true, WebSocketImpl = globalThis.WebSocket }) {
    this.world = world;
    this.url = url;
    this.reconnect = reconnect;
    this.WebSocketImpl = WebSocketImpl;
    /** @type {"idle" | "connecting" | "connected" | "disconnected" | "error"} */
    this.status = "idle";
    this.error = null;
    this.messages = 0;
    this.rejected = 0;
    this.ws = null;
    this._retry = 1;
    this._timer = null;
    this._closed = false;
  }

  _setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.world.events.emit("feed.status", { status, error, url: this.url });
  }

  connect() {
    this._closed = false;
    clearTimeout(this._timer);
    if (!this.WebSocketImpl) {
      this._setStatus("error", "WebSockets are not available");
      return;
    }
    let ws;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (err) {
      this._setStatus("error", err.message);
      return;
    }
    this.ws = ws;
    this._setStatus("connecting");
    ws.onopen = () => {
      this._retry = 1;
      this._setStatus("connected");
      ws.send(JSON.stringify({ type: "hello", protocol: "arail-feed/1", client: "arail-web" }));
    };
    ws.onmessage = (e) => {
      try {
        this.world.trains.apply(typeof e.data === "string" ? e.data : String(e.data));
        this.messages++;
      } catch (err) {
        this.rejected++;
        this.error = `Invalid message: ${err.message}`;
      }
    };
    ws.onerror = () => this._setStatus("error", "Connection failed");
    ws.onclose = () => {
      this.ws = null;
      if (this._closed) return this._setStatus("idle");
      this._setStatus("disconnected", this.error);
      if (this.reconnect) {
        this._timer = setTimeout(() => this.connect(), Math.min(30, this._retry) * 1000);
        this._retry *= 2;
      }
    };
  }

  close() {
    this._closed = true;
    clearTimeout(this._timer);
    if (this.ws) this.ws.close();
    else this._setStatus("idle");
    this.world.trains.reset();
  }
}
