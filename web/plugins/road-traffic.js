// Example plugin: a new simulation (cars driving along the layout's road objects).
// Load it from a layout file and enable it:
//   "plugins": ["../plugins/road-traffic.js"],
//   "simulations": [{ "type": "passengers" }, { "type": "road-traffic", "cars_per_km": 30 }]

export default function register(arail) {
  const { Simulation, polylineAt, rectFootprint, registry } = arail;
  const COLOURS = ["#c0392b", "#2c7fb8", "#f4f4f4", "#3b3b3b", "#e1b12c", "#27ae60"];

  class RoadTraffic extends Simulation {
    static type = "road-traffic";
    static label = "Road traffic";
    static description = "Example plugin: cars drive along the roads in both directions.";
    static params = [
      { key: "cars_per_km", label: "Cars", type: "number", unit: "per km", min: 0, max: 200, step: 5, default: 25 },
      { key: "speed_kmh", label: "Speed", type: "number", unit: "km/h", min: 5, max: 100, step: 5, default: 40 },
    ];

    constructor(world, config) {
      super(world, config);
      this.cars = new Map(); // road id -> cars
    }

    clear() {
      this.cars.clear();
    }

    step(dt) {
      const v = this.config.speed_kmh / 3.6; // m/s
      for (const road of this.world.objects) {
        if (road.type !== "road" || !road.geometry || road.spec.kind === "path") continue;
        const length = road.meters(road.geometry.lengths.at(-1)); // prototype metres
        let cars = this.cars.get(road.id);
        if (!cars || cars.length !== Math.round((length / 1000) * this.config.cars_per_km)) {
          const n = Math.round((length / 1000) * this.config.cars_per_km);
          cars = Array.from({ length: n }, (_, i) => ({
            s: (length * (i + this.world.rng.next())) / Math.max(1, n),
            dir: i % 2 ? 1 : -1,
            speed: v * this.world.rng.uniform(0.8, 1.15),
            colour: this.world.rng.pick(COLOURS),
          }));
          this.cars.set(road.id, cars);
        }
        for (const c of cars) c.s = (((c.s + c.dir * c.speed * dt) % length) + length) % length;
      }
    }

    draw(view) {
      for (const [id, cars] of this.cars) {
        const road = this.world.getObject(id);
        if (!road?.geometry) continue;
        const g = road.geometry;
        const lane = view.m((+road.spec.width_m || 7) / 4); // drive on the right
        for (const c of cars) {
          const at = polylineAt(g.points, road.mm(c.s), g.lengths);
          const d = [at.dir[0] * c.dir, at.dir[1] * c.dir];
          const centre = [at.point[0] + d[1] * lane, at.point[1] - d[0] * lane];
          const fp = rectFootprint(centre, view.m(4.4), view.m(1.8), Math.atan2(d[1], d[0]));
          view.prism(fp, view.m(0.3), view.m(1.45), { side: c.colour, top: c.colour, outline: "rgba(0,0,0,0.35)" });
        }
      }
    }
  }

  registry.registerSimulation(RoadTraffic);
}
