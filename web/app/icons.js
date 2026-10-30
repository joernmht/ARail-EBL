// The icons of Interaction: line drawings in the colour of the text, for the scenarios in the list
// and the boxes of the modules (24 × 24, drawn with currentColor).
import { h } from "./ui.js";

/** Icons by what they stand for. */
export const ICONS = {
  operations: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8 21l2-4M16 21l-2-4"/></svg>',
  infrastructure: '<svg viewBox="0 0 24 24"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5"/><circle cx="12" cy="6.2" r="1.4"/><circle cx="12" cy="10.8" r="1.4"/><path d="M12 14.5V21M8 21h8"/></svg>',
  plan: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg>',
  journeys: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><path d="M8 18.5h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16" stroke-dasharray="2.2 2.2"/></svg>',
  terminal: '<svg viewBox="0 0 24 24"><path d="M3 21V5h18v16M3 8h18"/><path d="M12 8v5"/><rect x="9" y="13" width="6" height="4" rx=".5"/><path d="M6 21v-2h12v2"/></svg>',
  layout: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="14" height="10" rx="1"/><path d="M6.5 7v10M10 7v10M13.5 7v10M14 3.5h6.5V10M20.5 3.5 15 9"/></svg>',
  module: '<svg viewBox="0 0 24 24"><path d="M12 3 21 8l-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5M3 16.5l9 5 9-5"/></svg>',
  build: '<svg viewBox="0 0 24 24"><path d="M3.5 20.5 4.6 16 15.8 4.8a2.1 2.1 0 0 1 3 3L7.6 19l-4.1 1.5Z"/><path d="m14 6.6 3 3M3 20.9h18"/></svg>',
  disruptions: '<svg viewBox="0 0 24 24"><path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.2h.01"/></svg>',
  intro: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M10 9v6l5-3-5-3Z"/></svg>',
  sandbox: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6.5" r="2.5"/><path d="M4.5 20v-5a4.5 4.5 0 0 1 9 0v5"/><circle cx="17" cy="8.5" r="2"/><path d="M15 13.2a3.5 3.5 0 0 1 5.5 2.8V20"/></svg>',
  freight: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 7v10M11 7v10M15 7v10M5 20h.01M19 20h.01"/></svg>',
};

/** An icon (aria-hidden: the text next to it names it). */
export function icon(key, cls) {
  const el = h("span", { class: cls, "aria-hidden": "true" });
  el.innerHTML = ICONS[key] ?? ICONS.module;
  return el;
}
