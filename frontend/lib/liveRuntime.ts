// What runs inside a live block's sandboxed frame (ArtCraft study item 7). One block type,
// three kinds, decided by the code itself — no setting:
//
//   mermaid — the code is Mermaid source ("flowchart LR …", "mindmap", "timeline" …). The best
//             target for small/local models: short text, clean SVG.
//   model   — the code is a link to a .glb / .gltf / .stl file: a 3D viewer, auto-framed.
//   html    — anything else: the block's own HTML/JS. It may call `await sbScene()` for a
//             three.js scene that is already lit and framed.
//
// 3D uses ArtCraft's recipe (captureModelThumbnail.ts, Apache-2.0/MIT, rewritten here): scale
// to a 2-unit box standing on the origin, camera on a 45° diagonal fitted to the bounding sphere, a
// fixed five-light rig, damped orbit controls. Every frame gets a CSP that allows the pinned
// library sites only (LIBRARY_ORIGINS, plus `assetOrigin` for model files), the height reporter and an export responder.

import { withAutoHeight } from "./liveBlock";

export type LiveKind = "mermaid" | "model" | "html";

export const CDN = "https://cdn.jsdelivr.net";
/** Public library sites a block may load scripts, styles, fonts and files from. jsDelivr is
 *  where our own runtime comes from; the others are where pasted examples usually point
 *  (the user chose to allow them, 2026-10-24). The frame stays sandboxed either way: no
 *  same-origin, so no access to the note, the account or any other site. */
export const LIBRARY_ORIGINS = [CDN, "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://esm.sh"];
export const MERMAID_URL = `${CDN}/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs`;
export const THREE_URL = `${CDN}/npm/three@0.169.0/build/three.module.js`;
export const THREE_ADDONS = `${CDN}/npm/three@0.169.0/examples/jsm/`;

const MERMAID_START = /^(?:%%.*\n\s*)*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|journey|quadrantChart|gitGraph|xychart-beta|sankey-beta|block-beta)\b/;
const MODEL_URL = /^https:\/\/\S+\.(glb|gltf|stl)(\?\S*)?$/i;

export function detectKind(code: string): LiveKind {
  const c = code.trim();
  if (MODEL_URL.test(c)) return "model";
  if (!c.startsWith("<") && MERMAID_START.test(c)) return "mermaid";
  return "html";
}

/** JSON for a value placed inside a <script>: no "</script>" can close it early. */
const jsonInScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LIBS = LIBRARY_ORIGINS.join(" ");

function csp(origins: string[]): string {
  const extra = origins.length ? " " + origins.join(" ") : "";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${LIBS}`,
    `style-src 'unsafe-inline' ${LIBS}`,
    `img-src data: blob: ${LIBS}${extra}`,
    `font-src data: ${LIBS}`,
    `connect-src ${LIBS}${extra}`,
    "media-src data: blob:",
    "worker-src blob:",
  ].join("; ");
}

// Answers the parent's export request with the block's picture: the first canvas as PNG, else
// the first SVG cropped to its content plus a 2 % margin.
const EXPORT_SCRIPT = `<script>addEventListener("message",function(e){if(!e.data||!e.data["sb-live-export"])return;
var out=null,kind=null;try{var cv=document.querySelector("canvas"),svg=document.querySelector("svg");
if(cv){out=cv.toDataURL("image/png");kind="png";}else if(svg){var bb=svg.getBBox(),m=Math.max(bb.width,bb.height)*0.02;
var c=svg.cloneNode(true);c.setAttribute("viewBox",[bb.x-m,bb.y-m,bb.width+2*m,bb.height+2*m].join(" "));
c.setAttribute("xmlns","http://www.w3.org/2000/svg");c.removeAttribute("style");c.setAttribute("width",Math.ceil(bb.width+2*m));
c.setAttribute("height",Math.ceil(bb.height+2*m));out="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(new XMLSerializer().serializeToString(c));kind="svg";}}catch(err){}
parent.postMessage({"sb-live-image":out,"sb-live-kind":kind},"*");});</script>`;

export type LiveTheme = "light" | "dark";

/** The note's colours, for content to use (`var(--sb-text)` …) so it sits in the note in light
 *  and dark like Notion's previews do. The page itself is transparent: the block's own box
 *  (the code-block fill) shows through. Values are the app's tokens (tokens.css). */
export const THEME_VARS: Record<LiveTheme, Record<string, string>> = {
  light: {
    "--sb-text": "rgb(44,44,43)", "--sb-muted": "rgb(125,122,117)", "--sb-border": "rgba(28,19,1,0.11)",
    "--sb-surface": "#ffffff", "--sb-hover": "rgba(33,27,23,0.051)", "--sb-accent": "rgb(39,131,222)",
    "--sb-ok": "rgb(68,131,97)", "--sb-ok-bg": "rgb(237,243,236)", "--sb-bad": "rgb(207,81,72)", "--sb-bad-bg": "rgb(252,233,231)",
    "--sb-scene": "#f5f5f4",
  },
  dark: {
    "--sb-text": "rgb(240,239,237)", "--sb-muted": "rgb(173,169,163)", "--sb-border": "rgba(255,255,235,0.1)",
    "--sb-surface": "rgb(37,37,37)", "--sb-hover": "rgba(255,255,255,0.055)", "--sb-accent": "rgb(61,144,225)",
    "--sb-ok": "rgb(82,158,114)", "--sb-ok-bg": "rgba(82,158,114,0.18)", "--sb-bad": "rgb(230,91,80)", "--sb-bad-bg": "rgba(230,91,80,0.18)",
    "--sb-scene": "#252525",
  },
};

function baseStyle(theme: LiveTheme): string {
  const vars = Object.entries(THEME_VARS[theme]).map(([k, v]) => `${k}:${v}`).join(";");
  // color-scheme matches the note's, or Chrome paints an opaque backdrop behind the frame.
  return `<style>:root{color-scheme:${theme};${vars}}html,body{margin:0;background:transparent}` +
    `body{font-family:system-ui,sans-serif;color:var(--sb-text)}</style>`;
}

// Where the camera goes for a model of size (sx, sy, sz) standing on the origin: far enough
// that the whole bounding sphere fits the vertical field of view (seen from a corner a box is
// wider than its longest side — a cube was cut off), on the 45° diagonal, a little above.
// Plain JS source so the frame embeds exactly what the tests run.
export const FIT_CAMERA_JS = `function fitCamera(sx, sy, sz, fov) {
  var r = Math.sqrt(sx * sx + sy * sy + sz * sz) / 2;
  var d = (r / Math.sin((fov * Math.PI) / 360)) * 1.1;
  var dir = [Math.SQRT1_2, 0.45, Math.SQRT1_2], n = Math.hypot(dir[0], dir[1], dir[2]);
  var ty = sy / 2;
  return { x: (dir[0] / n) * d, y: ty + (dir[1] / n) * d, z: (dir[2] / n) * d, ty: ty };
}`;

// The 3D helper: `await sbScene(el?)` → { THREE, scene, camera, renderer, controls, frame(obj),
// onFrame(cb) }. `frame` scales/centres an object and points the camera at it.
const SCENE_RUNTIME = `<script type="importmap">{"imports":{"three":"${THREE_URL}","three/addons/":"${THREE_ADDONS}"}}</script>
<script>window.sbReady=new Promise(function(r){window.__sbResolve=r});
window.sbScene=function(el){return window.sbReady.then(function(rt){return rt.makeScene(el)})};</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
const FOV = 50;
${FIT_CAMERA_JS}
function lights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.2));
  for (const [i, p] of [[2, [2, 10, 8]], [1.2, [-6, 6, -4]], [1, [0, 4, 10]]]) {
    const l = new THREE.DirectionalLight(0xffffff, i); l.position.set(...p); scene.add(l);
  }
}
function makeScene(el) {
  if (!el) { el = document.createElement("div"); document.body.appendChild(el); }
  const w = Math.max(200, el.clientWidth || document.body.clientWidth || 600);
  const h = Math.min(420, Math.round(w * 0.66));
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.domElement.style.display = "block";
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--sb-scene").trim() || "#f5f5f4");
  const camera = new THREE.PerspectiveCamera(FOV, w / h, 0.01, 1000);
  camera.position.set(3, 2, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.05;
  lights(scene);
  // Something to reflect: a glTF without a material gets the spec's default, fully metallic,
  // and a metal with no environment is black wherever no direct light hits it.
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const hooks = [];
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    for (const f of hooks) f(dt);
    controls.update(); renderer.render(scene, camera);
  });
  new ResizeObserver(() => {
    const nw = Math.max(200, el.clientWidth || w), nh = Math.min(420, Math.round(nw * 0.66));
    renderer.setSize(nw, nh); camera.aspect = nw / nh; camera.updateProjectionMatrix();
  }).observe(el);
  function frame(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 1;
    obj.scale.multiplyScalar(2 / max);
    const b2 = new THREE.Box3().setFromObject(obj), c = b2.getCenter(new THREE.Vector3());
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y;
    const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    const p = fitCamera(s.x, s.y, s.z, FOV);
    camera.position.set(p.x, p.y, p.z);
    controls.target.set(0, p.ty, 0); controls.update();
  }
  return { THREE, scene, camera, renderer, controls, frame, onFrame: (f) => hooks.push(f) };
}
window.__sbResolve({ THREE, makeScene });
</script>`;

function modelBody(url: string): string {
  const ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  const safe = jsonInScript(url);
  return `<div id="sb-model"></div><p id="sb-msg" style="font-size:12px;color:var(--sb-muted);margin:6px 8px"></p>
<script type="module">
const s = await sbScene(document.getElementById("sb-model"));
const { THREE } = s;
const msg = document.getElementById("sb-msg");
try {
  let obj;
  if (${jsonInScript(ext)} === "stl") {
    const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
    const geo = await new STLLoader().loadAsync(${safe});
    geo.computeVertexNormals();
    obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.1, roughness: 0.6 }));
  } else {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const loader = new GLTFLoader(); loader.setCrossOrigin("anonymous");
    const gltf = await loader.loadAsync(${safe});
    obj = gltf.scene;
    if (gltf.animations && gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(obj);
      gltf.animations.forEach((c) => mixer.clipAction(c).play());
      s.onFrame((dt) => mixer.update(dt));
    }
  }
  s.scene.add(obj); s.frame(obj);
  msg.textContent = "Drag to rotate · scroll to zoom";
} catch (e) { msg.textContent = "Could not load this model."; }
</script>`;
}

function mermaidBody(code: string, theme: LiveTheme): string {
  return `<pre class="mermaid" style="margin:0;padding:0;display:flex;justify-content:center">${escapeHtml(code.trim())}</pre>
<p id="sb-msg" style="font-size:12px;color:var(--sb-bad);margin:6px 8px"></p>
<script type="module">
import mermaid from "${MERMAID_URL}";
mermaid.initialize({ startOnLoad: false, theme: ${JSON.stringify(theme === "dark" ? "dark" : "neutral")}, securityLevel: "strict" });
try { await mermaid.run({ querySelector: ".mermaid" }); }
catch (e) { document.getElementById("sb-msg").textContent = "This diagram has a syntax error: " + (e && e.message ? e.message.split("\\n")[0] : ""); }
</script>`;
}

function head(origins: string[], withScene: boolean, theme: LiveTheme): string {
  return `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp(origins)}">` +
    baseStyle(theme) + (withScene ? SCENE_RUNTIME : "");
}

/** The complete document for a live block's frame. */
export function buildSrcDoc(code: string, opts: { assetOrigin?: string; theme?: LiveTheme } = {}): string {
  const theme = opts.theme ?? "light";
  const kind = detectKind(code);
  const origins = opts.assetOrigin ? [opts.assetOrigin] : [];
  if (kind === "model") {
    // The block's own declared file may come from its own site (textures too).
    try { origins.push(new URL(code.trim()).origin); } catch { /* not reachable: detectKind checked */ }
  }
  let doc: string;
  if (kind === "mermaid") {
    doc = `<!doctype html><html><head>${head(origins, false, theme)}</head><body>${mermaidBody(code, theme)}</body></html>`;
  } else if (kind === "model") {
    doc = `<!doctype html><html><head>${head(origins, true, theme)}</head><body>${modelBody(code.trim())}</body></html>`;
  } else {
    const wantsScene = /\bsbScene\s*\(|from\s+["']three["']/.test(code);
    const injected = head(origins, wantsScene, theme);
    const i = code.search(/<head[^>]*>/i);
    doc = i >= 0
      ? code.replace(/<head[^>]*>/i, (m) => m + injected)
      : `<!doctype html><html><head>${injected}</head><body>${code}</body></html>`;
  }
  const j = doc.toLowerCase().lastIndexOf("</body>");
  doc = j >= 0 ? doc.slice(0, j) + EXPORT_SCRIPT + doc.slice(j) : doc + EXPORT_SCRIPT;
  return withAutoHeight(doc);
}

/** One-line warnings about what a block tries to do that the sandbox will refuse (VC4). */
export function preflightWarnings(code: string): string[] {
  const out: string[] = [];
  if (/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon|EventSource/.test(code)) {
    out.push("This block tries to reach the internet; that is blocked here.");
  }
  if (/\b(?:top|parent)\s*\.\s*(?:location|document|localStorage)/.test(code)) {
    out.push("This block tries to reach the page around it; that is blocked here.");
  }
  const srcs = [...code.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi)].map((m) => m[1]);
  if (srcs.some((u) => !LIBRARY_ORIGINS.some((o) => u.startsWith(o + "/")))) {
    out.push("This block loads files from a site that isn't allowed; only jsDelivr, cdnjs, unpkg and esm.sh are.");
  }
  return out;
}

/** The origin model files may come from (the app's own storage), for the frame's CSP. */
export function assetOrigin(): string | undefined {
  try {
    const u = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return u ? new URL(u).origin : undefined;
  } catch {
    return undefined;
  }
}
