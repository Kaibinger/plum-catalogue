/*
  3D viewer for one product at a time.
  createViewer(el, { lang, onFallback }) -> { show(product, level), reset(), setLang(lang), dispose() }
  show() resolves to { note } (a UI-string key or null).
  onFallback(reason) is called with "contextlost" or "error"; the page then shows photos.
  Frames are drawn only while something moves (render on demand).
*/
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { buildModel } from "./models.js";

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (e) { return false; }
}

const LABEL_FONT = "Poppins, 'Segoe UI', system-ui, sans-serif";

function translator(lang) {
  const idx = lang === "da" ? 0 : lang === "de" ? 1 : -1;
  const str = (window.PLUM_I18N && window.PLUM_I18N.STR) || {};
  return (s) => (idx >= 0 && str[s] && str[s][idx]) || s;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

// Load an image and crop its near-white margins (product photos sit on white).
async function trimmedCanvas(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 10 && (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return c;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function labelCanvas(text) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#2DA17F";
  ctx.fillRect(0, 0, c.width, 18);
  // two copies so the label reads from front and back of a bottle
  for (const cx of [256, 768]) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#2DA17F";
    ctx.font = `700 54px ${LABEL_FONT}`;
    ctx.fillText("Plum", cx, 92);
    ctx.fillStyle = "#202020";
    ctx.font = `500 22px ${LABEL_FONT}`;
    const words = String(text).split(" ");
    let line = "", y = 140;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > 440 && line) { ctx.fillText(line, cx, y); line = w; y += 28; }
      else line = test;
      if (y > 230) break;
    }
    if (line && y <= 230) ctx.fillText(line, cx, y);
  }
  return c;
}

export function createViewer(el, { lang = "en", onFallback = () => {} } = {}) {
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;";
  el.appendChild(canvas);

  const sizeLabel = document.createElement("div");
  sizeLabel.className = "size-label";
  el.appendChild(sizeLabel);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe8e7, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 3, 2.5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-2, 1, -1.5);
  scene.add(fill);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 1.2;

  let token = 0, root = null, home = null, t = translator(lang), disposed = false, pending = false, onScreen = true;

  // draw only while the viewer is shown and on screen (photo mode hides it; scrolling moves it away)
  function shouldRender() {
    return !disposed && onScreen && el.isConnected && !el.hidden && el.offsetParent !== null;
  }
  const visibility = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    if (onScreen) request();
  });
  visibility.observe(el);

  function frame() {
    pending = false;
    if (!shouldRender()) return;
    const moved = controls.update();
    renderer.render(scene, camera);
    if (moved || controls.autoRotate) request();
  }
  function request() { if (!pending && !disposed) { pending = true; requestAnimationFrame(frame); } }

  controls.addEventListener("change", request);
  controls.addEventListener("start", () => { controls.autoRotate = false; });
  canvas.addEventListener("dblclick", () => reset());
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); onFallback("contextlost"); });

  const ro = new ResizeObserver(() => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    request();
  });
  ro.observe(el);

  function texturesFor(myToken) {
    return {
      async photo(src) {
        try {
          const c = await trimmedCanvas(src);
          if (myToken !== token || disposed) return null;
          const tex = new THREE.CanvasTexture(c);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          request();
          return tex;
        } catch (e) { return null; }
      },
      label(text) {
        const tex = new THREE.CanvasTexture(labelCanvas(text));
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      }
    };
  }

  function fmt(n) {
    const s = String(Math.round(n * 10) / 10);
    return lang === "en" ? s : s.replace(".", ",");
  }

  function fit(obj) {
    const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1;
    const dir = new THREE.Vector3(1, 0.55, 1.6).normalize();
    home = { pos: sphere.center.clone().addScaledVector(dir, dist), target: sphere.center.clone() };
    camera.near = dist / 100; camera.far = dist * 10;
    camera.updateProjectionMatrix();
    reset();
  }

  function clear() {
    if (root) { scene.remove(root); disposeTree(root); root = null; }
  }

  function reset() {
    if (!home) return;
    camera.position.copy(home.pos);
    controls.target.copy(home.target);
    controls.update();
    request();
  }

  async function show(product, level) {
    const my = ++token;
    clear();
    try {
      const { object, sizeMm, note } = buildModel(product, level, { THREE, textures: texturesFor(my), t });
      if (my !== token) { if (object) disposeTree(object); return { note }; }
      if (object) {
        root = new THREE.Group();
        root.name = "product";
        root.userData = { id: product.id, level };
        root.add(object);
        scene.add(root);
        fit(root);
      }
      sizeLabel.textContent = sizeMm ? sizeMm.map(fmt).join(" × ") + " mm" : "";
      sizeLabel.hidden = !sizeMm;
      request();
      return { note };
    } catch (e) {
      console.error(e);
      onFallback("error");
      return { note: null };
    }
  }

  return {
    show,
    reset,
    setLang(l) { lang = l; t = translator(l); },
    dispose() {
      disposed = true;
      token++;
      clear();
      ro.disconnect();
      visibility.disconnect();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
      sizeLabel.remove();
    },
    _debug: { renderer, scene, camera, shouldRender, renderNow: () => renderer.render(scene, camera) }
  };
}
