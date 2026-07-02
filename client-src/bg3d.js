// ════════════════════════════════════════════════════════════════
// นุชฟอร์ไลฟ์ — ฉากพื้นหลัง 3D (WebGL)
// ใบไม้คริสตัล + หยดน้ำค้างเรืองแสง ลอยมีมิติ ในโทนสีแบรนด์
// (ม่วง #7b5cff · แมเจนตา #c061ff · ฟ้า #4cc4ff)
//
// เป็น progressive enhancement: ถ้า WebGL/CDN ใช้ไม่ได้ จะไม่ทำอะไร
// แล้วปล่อยให้ background CSS (.bg-aurora) ทำงานต่อตามปกติ
// ════════════════════════════════════════════════════════════════
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

(function initBackground3D() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PALETTE = [0x7b5cff, 0xc061ff, 0x4cc4ff, 0x9d7bff, 0xb98bff];
  const isMobile = window.matchMedia('(max-width: 760px)').matches;
  // น้อยลง = พรีเมียม สงบตา ไม่แย่งความเด่นกับตัวหนังสือ
  const LEAF_COUNT = isMobile ? 3 : 5;
  const DROP_COUNT = isMobile ? 4 : 7;

  const host = document.querySelector('.bg-aurora') || document.body;
  const canvas = document.createElement('canvas');
  canvas.className = 'bg-3d';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  // ขอ context เองครั้งเดียว แล้วส่งให้ Three ใช้ต่อ — กัน Three ไล่ลอง context หลายชนิด
  // (เลี่ยง error "Canvas has an existing context of a different type" บนบางเบราว์เซอร์)
  let renderer;
  try {
    const attrs = { alpha: true, antialias: !isMobile, powerPreference: 'low-power', premultipliedAlpha: true, failIfMajorPerformanceCaveat: false };
    const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    if (!gl) { canvas.remove(); return; } // ไม่รองรับ WebGL → ใช้ background CSS เดิมต่อ
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: !isMobile });
  } catch { canvas.remove(); return; }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

  const scene = new THREE.Scene();
  // หมอกใกล้ขึ้น → วัตถุไกลจางหายนุ่ม ๆ ให้ความรู้สึกลึกแบบพรีเมียม
  scene.fog = new THREE.Fog(0xf3effb, 6, 16);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  // ── แสง: ขาวนวล + จุดสีแบรนด์ 3 ดวง เพื่อให้พื้นผิวมีไล่เฉดแบบ nebula ──
  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const lights = [
    new THREE.PointLight(0x7b5cff, 26, 60),
    new THREE.PointLight(0xc061ff, 22, 60),
    new THREE.PointLight(0x4cc4ff, 20, 60),
  ];
  lights[0].position.set(6, 4, 6);
  lights[1].position.set(-7, -3, 4);
  lights[2].position.set(0, 5, -6);
  lights.forEach((l) => scene.add(l));

  // ── geometry: รูปใบไม้ (extrude) + หยดน้ำ (sphere) ──
  function leafGeometry() {
    const s = new THREE.Shape();
    s.moveTo(0, -1.15);
    s.bezierCurveTo(0.95, -0.45, 0.78, 0.78, 0, 1.35);
    s.bezierCurveTo(-0.78, 0.78, -0.95, -0.45, 0, -1.15);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.16, bevelEnabled: true, bevelThickness: 0.09,
      bevelSize: 0.09, bevelSegments: 3, curveSegments: 26,
    });
    geo.center();
    return geo;
  }
  const LEAF_GEO = leafGeometry();
  const DROP_GEO = new THREE.SphereGeometry(0.5, 32, 32);

  const group = new THREE.Group();
  scene.add(group);
  const floaters = [];

  function spawn(geo, { gloss }) {
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: gloss ? 0.3 : 0.12,
      roughness: gloss ? 0.1 : 0.28,
      transparent: true,
      // โปร่งแสงขึ้นมาก → อ่อนโยน ไม่บังตัวหนังสือ
      opacity: gloss ? 0.4 : 0.36,
      emissive: color,
      emissiveIntensity: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const scale = gloss ? (0.45 + Math.random() * 0.55) : (0.75 + Math.random() * 0.7);
    mesh.scale.setScalar(scale);
    // ดันออกด้านข้างมากขึ้น + ถอยลึกขึ้น → เว้นพื้นที่กลางจอให้ตัวหนังสือ
    mesh.position.set(
      (Math.random() - 0.5) * 17,
      (Math.random() - 0.5) * 10,
      -9 + Math.random() * 7,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    group.add(mesh);
    floaters.push({
      mesh,
      // ความเร็วหมุน (rad/วินาที) — ช้า นุ่มนวล ดูพรีเมียม
      spin: new THREE.Vector3((Math.random() - 0.5) * 0.42, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.32),
      // ลอยไหลข้ามจอแนวนอน (หน่วย/วินาที) แล้ววนกลับ — ช้าลงให้ลื่นไหล
      drift: (0.1 + Math.random() * 0.26) * (Math.random() < 0.5 ? 1 : -1),
      bob: 0.3 + Math.random() * 0.4,
      bobSpeed: 0.32 + Math.random() * 0.34,
      phase: Math.random() * Math.PI * 2,
      baseY: mesh.position.y,
    });
  }
  for (let i = 0; i < LEAF_COUNT; i++) spawn(LEAF_GEO, { gloss: false });
  for (let i = 0; i < DROP_COUNT; i++) spawn(DROP_GEO, { gloss: true });

  // ── parallax ตามเมาส์ / การเอียงอุปกรณ์ ──
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!isMobile) {
    window.addEventListener('pointermove', (e) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const clock = new THREE.Clock();
  // เคารพ prefers-reduced-motion แบบนุ่มนวล: ยังเคลื่อนไหวอยู่ แต่ช้าลงมาก (ไม่หยุดนิ่ง)
  const motionScale = reduceMotion ? 0.32 : 1;

  const X_BOUND = 9; // ขอบเขตแนวนอนสำหรับการวนกลับ
  let elapsed = 0;
  let raf;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05) * motionScale; // กันกระโดดตอนสลับแท็บกลับมา
    elapsed += dt;
    const t = elapsed;
    for (const f of floaters) {
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      // ลอยไหลข้ามจอต่อเนื่อง แล้ววนกลับอีกฝั่ง
      f.mesh.position.x += f.drift * dt;
      if (f.mesh.position.x > X_BOUND) f.mesh.position.x = -X_BOUND;
      else if (f.mesh.position.x < -X_BOUND) f.mesh.position.x = X_BOUND;
      f.mesh.position.y = f.baseY + Math.sin(t * f.bobSpeed + f.phase) * f.bob;
    }
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    // แกว่งกลุ่มอัตโนมัติ (เห็นการเคลื่อนไหวแม้ไม่ขยับเมาส์) + parallax เมาส์
    group.rotation.y = Math.sin(t * 0.12) * 0.12 + pointer.x * 0.26;
    group.rotation.x = Math.cos(t * 0.1) * 0.06 + pointer.y * 0.16;
    lights[0].position.x = Math.sin(t * 0.45) * 8;
    lights[1].position.y = Math.cos(t * 0.4) * 6;
    lights[2].position.x = Math.cos(t * 0.3) * 6;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);
  // เผยฉากแบบ fade-in หลังเฟรมแรก
  requestAnimationFrame(() => canvas.classList.add('is-ready'));
  // หมายเหตุ: เบราว์เซอร์หยุด requestAnimationFrame เองเมื่อแท็บอยู่เบื้องหลัง
  // จึงไม่ต้องจัดการ visibilitychange เพิ่ม (เลี่ยงปัญหาลูปค้างตอนกลับมาที่แท็บ)
})();
