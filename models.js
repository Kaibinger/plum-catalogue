/*
  3D models for the public catalogue.
  buildModel(product, level, { THREE, textures, t })
    level: "unit" | "outer" | "pallet"
    -> { object, sizeMm: [L, W, H], note } or { object: null, sizeMm: null, note }
  note is a UI-string key: "noData", "noPallet", "illustrative", "dispenserNotShown" or null.
  three.js is passed in (no import here) so the builders run in node tests too.
  Scene units are metres; Y is up; L runs along X, W along Z.
*/
import { packLayer } from "./pallet.js";

// Bottle sizes from the technical data sheets: [diameter, height] in mm
const BOTTLES = { 200: [58.5, 165], 500: [78, 220], 1000: [90, 260] };

// Model per item. dimsFrom: which logistics level gives the unit size.
const MODELS = {
  "4604": { type: "bottle", ml: 500 }, "4691": { type: "bottle", ml: 200 },
  "4707": { type: "bottle", ml: 1000 }, "4752": { type: "bottle", ml: 200 },
  "4695": { type: "carton", dimsFrom: "unit" }, "4605": { type: "carton", dimsFrom: "unit" },
  "4620": { type: "carton", dimsFrom: "unit" }, "4755": { type: "carton", dimsFrom: "unit" },
  "4613": { type: "carton", dimsFrom: "outer" },
  "5160": { type: "ampoules", count: 5, d: 21, h: 125 },
  "4632": { type: "dispenser", dimsFrom: "unit" },
  "6001": { type: "set", ml: 500, count: 4 }, "6002": { type: "set", ml: 200, count: 4 },
  "6003": { type: "set", ml: 200, count: 4 }
};
export const MODEL_TYPES = Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, m.type]));

export const PALLET = { l: 1200, w: 800, h: 144 };
const COLORS = { green: "#2DA17F", blue: "#2F6FB5", carton: "#F2F1EC", kraft: "#C8A26B", wood: "#D9B98C", body: "#F4F7F6", line: "#1C7A5E" };
const MM = 0.001;

export function parseDims(s) {
  if (typeof s !== "string") return null;
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (/Ø/.test(s) && nums.length >= 2) return [nums[0], nums[0], nums[1]];
  return nums.length >= 3 ? nums.slice(0, 3) : null;
}

// Why a level cannot be shown, or null when it can.
export function levelNote(product, level) {
  const m = MODELS[product && product.id];
  const l = (product && product.logistics) || {};
  if (!m) return "noData";
  if (level === "unit") {
    if (m.dimsFrom && !parseDims(l[m.dimsFrom] && l[m.dimsFrom].dims)) return "noData";
    return null;
  }
  if (!parseDims(l.outer && l.outer.dims)) return "noData";
  if (level === "outer") return null;
  if (level === "pallet") {
    const p = l.pallet || {};
    return p.layers > 0 && p.perLayer > 0 ? null : "noPallet";
  }
  return "noData";
}

export function buildModel(product, level, deps) {
  const note = levelNote(product, level);
  if (note) return { object: null, sizeMm: null, note };
  const m = MODELS[product.id];
  const b = builders(deps);
  if (level === "outer") return b.outer(product);
  if (level === "pallet") return b.pallet(product);
  if (m.type === "bottle") { const d = BOTTLES[m.ml]; return { object: b.bottle(product, m.ml), sizeMm: [d[0], d[0], d[1]], note: null }; }
  if (m.type === "set") return b.set(product, m);
  if (m.type === "ampoules") return b.ampoules(m);
  return b.box(product, parseDims(product.logistics[m.dimsFrom].dims));
}

function builders({ THREE, textures, t = (s) => s }) {
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
  const lathe = (pts, rx, h) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x * rx, y * h)), 48);
  const applyPhoto = (material, src) => {
    if (!src) return;
    Promise.resolve(textures.photo(src)).then((tex) => {
      if (!tex) return;
      material.map = tex;
      material.color.set("#ffffff");
      material.needsUpdate = true;
    });
  };
  const labelMat = (text, fallback) => {
    const tex = textures.label(text);
    return tex ? mat("#ffffff", { map: tex }) : mat(fallback);
  };

  function bottle(product, ml) {
    const [d, h] = BOTTLES[ml];
    const r = (d / 2) * MM, H = h * MM;
    const g = new THREE.Group();
    g.name = "bottle";
    const body = new THREE.Mesh(
      lathe([[0, 0], [0.95, 0], [1, 0.03], [1, 0.62], [0.9, 0.72], [0.55, 0.78], [0.5, 0.8], [0, 0.8]], r, H),
      new THREE.MeshPhysicalMaterial({ color: COLORS.body, roughness: 0.35, transmission: 0.35, thickness: 0.01 }));
    const cupColor = /phosphate/i.test(product.name) ? COLORS.blue : COLORS.green;
    const cup = new THREE.Mesh(
      lathe([[0, 0.8], [0.5, 0.8], [0.6, 0.86], [0.82, 0.96], [0.84, 1], [0.74, 1], [0.55, 0.9], [0, 0.9]], r, H),
      mat(cupColor, { roughness: 0.5 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.004, r * 1.004, H * 0.3, 48, 1, true), labelMat(t(product.name), "#ffffff"));
    band.position.y = H * 0.35;
    g.add(body, cup, band);
    return g;
  }

  function box(product, [L, W, H]) {
    const imgs = product.images || [];
    const front = imgs[0] && imgs[0].src;
    const sideImg = imgs.find((i) => /side$/i.test(i.caption || ""));
    const side = sideImg ? sideImg.src : front;
    // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z (back)
    const mats = [mat(COLORS.carton), mat(COLORS.carton), mat(COLORS.carton), mat(COLORS.carton), mat(COLORS.carton), mat(COLORS.carton)];
    applyPhoto(mats[0], side); applyPhoto(mats[1], side); applyPhoto(mats[4], front); applyPhoto(mats[5], front);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(L * MM, H * MM, W * MM), mats);
    mesh.position.y = (H * MM) / 2;
    const g = new THREE.Group();
    g.add(mesh);
    return { object: g, sizeMm: [L, W, H], note: null };
  }

  function set(product, m) {
    const [d, h] = BOTTLES[m.ml];
    const g = new THREE.Group();
    const gap = 10, step = d + gap, span = m.count * d + (m.count - 1) * gap;
    for (let i = 0; i < m.count; i++) {
      const b = bottle(product, m.ml);
      b.position.x = (-span / 2 + d / 2 + i * step) * MM;
      g.add(b);
    }
    return { object: g, sizeMm: [span, d, h], note: "dispenserNotShown" };
  }

  function ampoules(m) {
    const g = new THREE.Group();
    const r = (m.d / 2) * MM, H = m.h * MM;
    const material = new THREE.MeshPhysicalMaterial({ color: COLORS.body, roughness: 0.35, transmission: 0.35, thickness: 0.005 });
    const geo = lathe([[0, 0], [1, 0], [1, 0.72], [0.35, 0.8], [0.35, 0.84], [0.8, 0.86], [0.8, 1], [0, 1]], r, H);
    for (let i = 0; i < m.count; i++) {
      const a = new THREE.Mesh(geo, material);
      a.name = "ampoule";
      a.position.x = (-(m.count * m.d) / 2 + m.d / 2 + i * m.d) * MM;
      g.add(a);
    }
    return { object: g, sizeMm: [m.count * m.d, m.d, m.h], note: null };
  }

  function outer(product) {
    const [L, W, H] = parseDims(product.logistics.outer.dims);
    const qty = product.logistics.outer.qty;
    const plain = mat(COLORS.kraft);
    const printed = labelMat(`Plum · ${product.itemNo} · ${qty} ×`, COLORS.kraft);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(L * MM, H * MM, W * MM), [plain, plain, plain, plain, printed, printed]);
    mesh.position.y = (H * MM) / 2;
    const g = new THREE.Group();
    g.add(mesh);
    return { object: g, sizeMm: [L, W, H], note: null };
  }

  function euroPallet() {
    const g = new THREE.Group();
    g.name = "pallet";
    const wood = mat(COLORS.wood, { roughness: 0.9 });
    const board = (l, h, w, x, y, z) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(l * MM, h * MM, w * MM), wood);
      b.position.set(x * MM, (y + h / 2) * MM, z * MM);
      g.add(b);
    };
    // 3 bottom runners, 9 blocks, 3 stringer boards, 5 deck boards = 22 + 78 + 22 + 22 = 144 mm
    for (const z of [-327.5, 0, 327.5]) board(1200, 22, 145, 0, 0, z);
    for (const x of [-550, 0, 550]) for (const z of [-327.5, 0, 327.5]) board(100, 78, 145, x, 22, z);
    for (const z of [-327.5, 0, 327.5]) board(1200, 22, 145, 0, 100, z);
    for (const x of [-527.5, -263.75, 0, 263.75, 527.5]) board(145, 22, 800, x, 122, 0);
    return g;
  }

  function pallet(product) {
    const [L, W, H] = parseDims(product.logistics.outer.dims);
    const { layers, perLayer, heightMm } = product.logistics.pallet;
    const g = new THREE.Group();
    g.add(euroPallet());
    const placed = packLayer(L, W, perLayer, PALLET.l, PALLET.w);
    const kraft = mat(COLORS.kraft);
    if (placed) {
      const geos = new Map();
      const geoFor = (l, w) => {
        const k = `${l}x${w}`;
        if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(l * MM * 0.995, H * MM, w * MM * 0.995));
        return geos.get(k);
      };
      for (let layer = 0; layer < layers; layer++) {
        for (const p of placed) {
          const c = new THREE.Mesh(geoFor(p.l, p.w), kraft);
          c.name = "carton";
          c.position.set((p.x + p.l / 2 - PALLET.l / 2) * MM, (PALLET.h + layer * H + H / 2) * MM, (p.y + p.w / 2 - PALLET.w / 2) * MM);
          g.add(c);
        }
      }
    } else {
      const stackH = layers * H;
      const side = labelMat(`${layers} × ${perLayer}`, COLORS.kraft);
      const block = new THREE.Mesh(new THREE.BoxGeometry(PALLET.l * MM, stackH * MM, PALLET.w * MM), [kraft, kraft, kraft, kraft, side, side]);
      block.name = "block";
      block.position.y = (PALLET.h + stackH / 2) * MM;
      g.add(block);
    }
    // measurement line at the front-left corner up to the pallet height given in the data
    if (heightMm > 0) {
      const x = (-PALLET.l / 2 - 40) * MM, z = (PALLET.w / 2) * MM;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0, z), new THREE.Vector3(x, heightMm * MM, z),
        new THREE.Vector3(x - 0.02, 0, z), new THREE.Vector3(x + 0.02, 0, z),
        new THREE.Vector3(x - 0.02, heightMm * MM, z), new THREE.Vector3(x + 0.02, heightMm * MM, z)]);
      const line = new THREE.LineSegments(geo.setIndex([0, 1, 2, 3, 4, 5]), new THREE.LineBasicMaterial({ color: COLORS.line }));
      line.name = "heightLine";
      g.add(line);
    }
    return { object: g, sizeMm: [PALLET.l, PALLET.w, heightMm || PALLET.h + layers * H], note: "illustrative" };
  }

  return { bottle, box, set, ampoules, outer, pallet };
}
