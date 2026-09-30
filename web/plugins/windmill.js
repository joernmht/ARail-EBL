// Example plugin: a new object type (a windmill with turning sails).
// Load it from a layout file:  "plugins": ["../plugins/windmill.js"]
// Then "Windmill" appears in the Build panel, with a settings form made from `params`.

export default function register(arail) {
  const { LayoutObject, resolvePoint, rectFootprint, registry } = arail;

  class Windmill extends LayoutObject {
    static type = "windmill";
    static label = "Windmill";
    static category = "Scenery";
    static placement = "point";
    static description = "Example plugin: a windmill with turning sails.";
    static params = [
      { key: "name", label: "Name", type: "text", default: "" },
      { key: "rotation_deg", label: "Rotation", type: "number", unit: "°", min: -180, max: 180, step: 5, default: 0 },
      { key: "height_m", label: "Height", type: "number", unit: "m", min: 8, max: 40, step: 1, default: 18 },
      { key: "rpm", label: "Sail speed", type: "number", unit: "rpm", min: 0, max: 30, step: 1, default: 8 },
      { key: "color", label: "Colour", type: "color", default: "#e8e1d0" },
    ];

    computeGeometry() {
      const c = resolvePoint(this.world.map, this.spec.position);
      return c ? { center: c, angle: ((+this.spec.rotation_deg || 0) * Math.PI) / 180 } : null;
    }

    footprint() {
      const g = this.geometry;
      return g ? rectFootprint(g.center, this.mm(6), this.mm(6), g.angle) : null;
    }

    update(dt) {
      this.sails = ((this.sails || 0) + dt * ((+this.spec.rpm || 0) / 60) * 2 * Math.PI) % (2 * Math.PI);
    }

    draw(view) {
      const { center, angle } = this.geometry;
      const h = view.m(+this.spec.height_m || 18);
      // tower: a prism that narrows towards the top (two stacked prisms)
      view.prism(rectFootprint(center, view.m(6), view.m(6), angle), 0, h * 0.55, { side: this.spec.color, top: this.spec.color });
      view.prism(rectFootprint(center, view.m(4.5), view.m(4.5), angle), h * 0.55, h * 0.85, { side: this.spec.color, top: "#8a5a3c" });
      // sails in a vertical plane in front of the tower
      const ux = Math.cos(angle), uy = Math.sin(angle); // along the sail plane
      const front = [center[0] - uy * view.m(2.6), center[1] + ux * view.m(2.6)];
      const hub = [front[0], front[1], h * 0.8];
      const L = h * 0.45, w = view.m(1.6);
      const faces = [];
      for (let i = 0; i < 4; i++) {
        const a = (this.sails || 0) + (i * Math.PI) / 2;
        const d = [ux * Math.cos(a), uy * Math.cos(a), Math.sin(a)]; // blade direction
        const n = [ux * -Math.sin(a), uy * -Math.sin(a), Math.cos(a)]; // across the blade
        const P = (s, t) => [hub[0] + d[0] * s + n[0] * t, hub[1] + d[1] * s + n[1] * t, hub[2] + d[2] * s + n[2] * t];
        faces.push({ pts: [P(view.m(0.5), 0), P(L, 0), P(L, w), P(view.m(0.5), w)], normal: [-uy, ux, 0], twoSided: true, color: "#6b4a2f" });
      }
      view.faces(faces, [front[0], front[1], h * 0.8], { outline: "rgba(40,25,10,0.6)" });
    }
  }

  registry.registerObject(Windmill);
}
