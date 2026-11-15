/**
 * Scenarios: scripted timelines of disruptions and other events, stored in the layout.
 *
 *   {
 *     "id": "evening-peak",
 *     "name": "Evening peak with signal failure",
 *     "description": "...",
 *     "steps": [
 *       { "at": 0,   "set": { "demand": 1.5 } },
 *       { "at": 5,   "message": "Evening peak: many commuters." },
 *       { "at": 20,  "call": "platform-1" },
 *       { "at": 60,  "start": { "id": "sf", "type": "signal-failure", "target": "*", "params": { "minutes": 4 } } },
 *       { "at": 200, "stop": "sf" }
 *     ]
 *   }
 *
 * `at` is simulated seconds after the start of the scenario. Actions:
 * - `set`: world settings (`demand`, `speed`), the time of day (`time`: "HH:MM", as `world.setTime`),
 *   the date (`date`: "MM-DD", as `world.setDate`) and the weather (`weather`: a preset's name,
 *   "typical", "off" or an object, as `world.setWeather`); what is none of them fails the step,
 *   which says so and changes none of them
 * - `message`: text for the app (event `scenario.message`)
 * - `call`: send a vehicle to an object / stop area / dock
 * - `start`: start a disruption (same fields as `DisruptionManager.start`)
 * - `stop`: stop a disruption by ID
 * - `emit`: `{ "name": "...", "payload": {...} }` custom event for plugins
 * @module arail/core/scenarios
 */
export class ScenarioPlayer {
  /** @param {import("./world.js").World} world */
  constructor(world) {
    this.world = world;
    this.scenarios = [];
    this.current = null;
    this.startedAt = 0;
    this.nextStep = 0;
  }

  load(scenarios = []) {
    this.stop();
    this.scenarios = scenarios.map((s) => ({ ...s, steps: [...(s.steps || [])].sort((a, b) => (a.at || 0) - (b.at || 0)) }));
  }

  get running() {
    return !!this.current;
  }

  /** Seconds since the scenario started (simulated). */
  get elapsed() {
    return this.current ? this.world.time - this.startedAt : 0;
  }

  play(id) {
    const sc = this.scenarios.find((s) => s.id === id);
    if (!sc) throw new Error(`Unknown scenario: ${id}`);
    this.stop();
    this.current = sc;
    this.startedAt = this.world.time;
    this.nextStep = 0;
    this.world.events.emit("scenario.started", { scenario: sc });
    this.step();
  }

  stop() {
    if (!this.current) return;
    const sc = this.current;
    this.current = null;
    this.world.events.emit("scenario.ended", { scenario: sc });
  }

  step() {
    const sc = this.current;
    if (!sc) return;
    const t = this.elapsed;
    while (this.nextStep < sc.steps.length && (sc.steps[this.nextStep].at || 0) <= t + 1e-9) {
      this._run(sc.steps[this.nextStep++]);
    }
    if (this.nextStep >= sc.steps.length) this.stop();
  }

  _run(step) {
    const w = this.world;
    try {
      if (step.set) {
        if (step.set.demand != null) w.demand = Number(step.set.demand);
        if (step.set.speed != null) w.speed = Number(step.set.speed);
        // all of it checked first, so that a step that fails changes nothing
        const { date, time, weather } = step.set;
        if (date != null && date !== "" && !w.clock.isDate(date)) throw new Error(`"${date}" is no date (MM-DD)`);
        if (time != null && !w.clock.isTime(time)) throw new Error(`"${time}" is no time of day (HH:MM)`);
        if (weather != null && !w.weather.isWeather(weather)) throw new Error(`${JSON.stringify(weather)} is no weather`);
        // the date first: the time and the weather are those of that day
        if (date != null) w.setDate(date);
        if (time != null) w.setTime(time);
        if (weather != null) w.setWeather(weather);
      }
      if (step.message) w.events.emit("scenario.message", { scenario: this.current, text: step.message });
      if (step.call) w.services.call(step.call, { source: "scenario" });
      if (step.start) w.disruptions.start(step.start);
      if (step.stop) w.disruptions.stop(step.stop);
      if (step.emit) w.events.emit(step.emit.name, step.emit.payload || {});
    } catch (err) {
      console.warn("Scenario step failed:", step, err);
      w.events.emit("scenario.message", { scenario: this.current, text: `Scenario step failed: ${err.message}` });
    }
  }
}
