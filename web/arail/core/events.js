/**
 * Minimal publish/subscribe event bus.
 *
 * Event names used by ARail (payloads in parentheses):
 * - `vehicle.arriving`, `vehicle.arrived`, `vehicle.departing`, `vehicle.departed`,
 *   `vehicle.cancelled` ({vehicle, dock, area})
 * - `disruption.started`, `disruption.ended` ({disruption})
 * - `scenario.started`, `scenario.ended`, `scenario.message` ({scenario, text})
 * - `object.added`, `object.changed`, `object.removed` ({object})
 * - `layout.loaded` ({layout})
 * - `feed.status` ({status, error}), `feed.trains` ({trains})
 * Plugins may emit their own events; please prefix them with the plugin name.
 * @module arail/core/events
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
  }

  /**
   * Subscribe to an event (or "*" for all events). Returns an unsubscribe function.
   * @param {string} name
   * @param {(payload: any, name: string) => void} handler
   */
  on(name, handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
    return () => this.off(name, handler);
  }

  /** Subscribe for a single event. */
  once(name, handler) {
    const off = this.on(name, (payload, n) => {
      off();
      handler(payload, n);
    });
    return off;
  }

  off(name, handler) {
    this.handlers.get(name)?.delete(handler);
  }

  emit(name, payload = {}) {
    for (const key of [name, "*"]) {
      for (const h of this.handlers.get(key) || []) {
        try {
          h(payload, name);
        } catch (err) {
          console.error(`Error in handler for "${name}":`, err);
        }
      }
    }
  }
}
