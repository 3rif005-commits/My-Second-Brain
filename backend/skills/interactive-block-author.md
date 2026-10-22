---
name: interactive-block-author
description: Use when generating an interactive HTML/JS block — simulation, quiz, chart, calculator, timeline. Constrained to vanilla JS in a sandboxed iframe.
priority: 4
---

When asked to generate an interactive block, output ONE of these, with nothing
else around it (no explanation, no code fences):

1. **A diagram** (flowchart, process, mind map, timeline, sequence, class/state/ER
   diagram, gantt, pie): output **only Mermaid source**, starting with its keyword,
   e.g. `flowchart LR`, `mindmap`, `timeline`, `sequenceDiagram`. Prefer this for
   anything that is boxes and arrows — it is short and always renders cleanly.
2. **A 3D model or scene**: a self-contained HTML snippet whose module script calls
   the built-in helper, which is already lit and framed:
   ```html
   <script type="module">
   const s = await sbScene();          // { THREE, scene, frame, onFrame }
   const { THREE } = s;
   const group = new THREE.Group();
   group.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32),
     new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.5 })));
   s.scene.add(group);
   s.frame(group);                     // scales, centres and points the camera
   s.onFrame((dt) => { group.rotation.y += dt * 0.3; });
   </script>
   ```
   Build models from simple shapes in a Group, colour the parts, call `s.frame(group)`
   once. Don't add lights, cameras, controls or a renderer — the helper has them.
3. **Anything else** (quiz, calculator, simulation, chart): a self-contained HTML
   snippet, as below.

Hard constraints:
- **No external URLs.** No `fetch`, no `<script src=...>`, no images from other
  sites — the frame blocks them. The only libraries are the two above (Mermaid, `sbScene`).
- All CSS inline in `<style>` tags. All JS inline in `<script>` tags.
- Vanilla JavaScript only. Canvas API for graphics is fine.
- The frame grows to fit the content: keep it compact (under ~600px tall), no fixed
  body height, no inner scrollbars.
- When the request includes the block's current code, return the complete updated
  document with only the asked-for change; keep the rest as it is.
- Use `system-ui, sans-serif` for typography. Clean colors, rounded corners.
- For option 3, it must be interactive — not just static HTML. Add at least one
  input, button, or drag handle that does something visible.

Good examples by domain:
- Algorithms → animated comparison (bubble vs merge sort)
- Physics → live simulator with sliders (orbit, pendulum)
- Math → function plotter with adjustable parameters
- Quizzes → multiple-choice with instant feedback (see template below)
- Charts → Canvas-drawn bar/line chart with hover

Quiz template:
```html
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;padding:16px;background:#f8fafc}
.q{font-weight:600;font-size:15px;margin-bottom:14px;color:#1e293b}
.opts button{display:block;width:100%;text-align:left;padding:9px 13px;margin:5px 0;
  background:#fff;border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer;
  font-size:14px;transition:.15s}
.opts button:hover{border-color:#6366f1;background:#eef2ff}
.opts button.correct{background:#d1fae5;border-color:#10b981;color:#065f46;font-weight:600}
.opts button.wrong{background:#fee2e2;border-color:#ef4444;color:#7f1d1d}
#msg{margin-top:10px;font-size:13px;font-weight:500}
</style>
<div class="q">[Question]</div>
<div class="opts">
  <button onclick="check(this,true)">[Correct]</button>
  <button onclick="check(this,false)">[Plausible wrong]</button>
  <button onclick="check(this,false)">[Plausible wrong]</button>
</div>
<div id="msg"></div>
<script>
var done=false;
function check(btn,ok){
  if(done)return;done=true;
  btn.className=ok?'correct':'wrong';
  var m=document.getElementById('msg');
  m.textContent=ok?'✅ Correct!':'❌ Review the concept above.';
  m.style.color=ok?'#065f46':'#991b1b';
}
</script>
```

Never:
- Reference external resources.
- Output more than one block per request.
- Generate purely decorative content with no interaction.
