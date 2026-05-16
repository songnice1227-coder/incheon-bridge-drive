import * as THREE from 'three';
import { GLTFLoader }      from 'three/addons/loaders/GLTFLoader.js';
import { Sky }             from 'three/addons/objects/Sky.js';
import { Water }           from 'three/addons/objects/Water.js';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const CAR_COLORS = {
  red:    new THREE.Color(0xcc2828),
  yellow: new THREE.Color(0xf0c000),
  black:  new THREE.Color(0x1c2232),
  mint:   new THREE.Color(0x3dbcb4),
  gray:   new THREE.Color(0x909090),
};

const COLOR_PROPS = {
  red:    { metalness: 0.75, roughness: 0.22 },
  yellow: { metalness: 0.70, roughness: 0.25 },
  black:  { metalness: 0.92, roughness: 0.06 },
  mint:   { metalness: 0.72, roughness: 0.22 },
  gray:   { metalness: 0.78, roughness: 0.20 },
};

const BRIDGE = { length: 9000, width: 26, deckH: 8, towerH: 185 };
const LAMP_SPACING = 40; // meters between streetlamps

const DRIVE = {
  forwardAccel: 22,   // units/s² forward acceleration
  maxSpeed:    100,   // max forward speed (= 100 km/h displayed)
  friction:     14,   // forward decel when not pressing
  drag:          0.012,
  maxLateral:   14,   // max lateral (X) speed
  lateralAccel: 32,   // lateral acceleration towards target
  lateralDecay: 16,   // lateral decel when input released
  maxVisualYaw:  0.42, // max visual tilt in radians (~24°)
  yawSmooth:     8,   // visual yaw smoothing rate
};

const DEFAULT_MUSIC = './assets/music.mp3'; // 기본 음악 파일 (없으면 업로드 유도)

// ─────────────────────────────────────────────
// RENDERER
// ─────────────────────────────────────────────
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 900;

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = isMobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;

// ─────────────────────────────────────────────
// SCENES & CAMERAS
// ─────────────────────────────────────────────
const garageScene = new THREE.Scene();
garageScene.background = new THREE.Color(0x080808);
garageScene.fog        = new THREE.Fog(0x080808, 15, 55);

const driveScene = new THREE.Scene();

const garageCam = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 300);
garageCam.position.set(0, 2.2, 7.5);
garageCam.lookAt(0, 0.8, 0);

const driveCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 25000);

// ─────────────────────────────────────────────
// POST-PROCESSING
// ─────────────────────────────────────────────
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(garageScene, garageCam);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function switchToDriveComposer() {
  renderPass.scene  = driveScene;
  renderPass.camera = driveCam;
  bloom.strength    = 0.55;
}

// ─────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────
let appState      = 'garage';
let selectedColor = 'red';
let timeOfDay     = 'morning';
let cameraMode    = 'rear';   // 'rear' | 'front'

const carPhys = {
  pos: new THREE.Vector3(0, BRIDGE.deckH + 0.45, -(BRIDGE.length / 2 - 30)),
};

// Motion state
let forwardSpd = 0;   // speed along Z axis
let lateralVel = 0;   // velocity along X axis
let visualYaw  = 0;   // visual lean angle (purely cosmetic)

// Touch-based input (mobile-first)
const inp = { fwd: false };
let steeringInput  = 0;  // -1 (left) … +1 (right)
let verticalInput  = 0;  // -1 (down/low) … +1 (up/high) — camera angle only
let camVertical    = 0;  // smoothed camera vertical offset
let activeTouchId  = null;
let touchStartX    = 0;
let touchStartY    = 0;

// Keyboard steering (desktop fallback)
const keyState = { left: false, right: false };

// ─────────────────────────────────────────────
// ── GARAGE SCENE ──
// ─────────────────────────────────────────────
const garageCarGroup = new THREE.Group();
const driveCarGroup  = new THREE.Group();
let carBodyMats      = [];
let garageMixer      = null;
let driveMixer       = null;
let driveWheels      = [];

function buildGarage() {
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85, metalness: 0.15 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  garageScene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 1 });
  const bw = new THREE.Mesh(new THREE.PlaneGeometry(40, 15), wallMat);
  bw.position.set(0, 7.5, -12);
  garageScene.add(bw);

  // Platform
  const platMat = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.5, metalness: 0.6 });
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 0.08, 80), platMat);
  plat.position.y = 0.04;
  plat.receiveShadow = true;
  garageScene.add(plat);

  // Glow ring
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x2266cc, emissive: 0x1144aa, emissiveIntensity: 1.5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.05, 8, 80), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  garageScene.add(ring);

  garageScene.add(new THREE.AmbientLight(0xffffff, 0.12));

  const spotMain = new THREE.SpotLight(0xffffff, 90, 22, Math.PI / 7, 0.3, 1.5);
  spotMain.position.set(0, 12, 1.5);
  spotMain.castShadow = true;
  spotMain.shadow.mapSize.set(1024, 1024);
  garageScene.add(spotMain);
  garageScene.add(spotMain.target);

  const pl1 = new THREE.PointLight(0x4488ff, 20, 14); pl1.position.set(-6, 5, -2); garageScene.add(pl1);
  const pl2 = new THREE.PointLight(0xff6633, 14, 12); pl2.position.set( 6, 5, -2); garageScene.add(pl2);
  const pl3 = new THREE.PointLight(0xffffff,  6,  8); pl3.position.set( 0, 2, -5); garageScene.add(pl3);

  garageCarGroup.position.set(0, 0, 0);
  garageScene.add(garageCarGroup);
}

// ─────────────────────────────────────────────
// ── DRIVE SCENE ──
// ─────────────────────────────────────────────
let sky, water, sunLight, ambLight, moonLight, frontFillLight;
let bridgeLampLights = []; // PointLights for night mode
let lampHeadMat      = null; // shared emissive material for lamp heads
let starsPoints      = null;
let cityWindowPoints = null;  // window-light particle cloud
const skylineMeshes  = [];    // distant skyline billboard planes

function buildDriveScene() {
  ambLight  = new THREE.AmbientLight(0xffffff, 0.4);
  driveScene.add(ambLight);
  driveScene.add(new THREE.HemisphereLight(0x87ceeb, 0x3d5f8f, 0.5));

  sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -120;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top = 120;
  sunLight.shadow.camera.near = 1; sunLight.shadow.camera.far = 600;
  sunLight.shadow.bias = -0.0005;
  driveScene.add(sunLight);
  driveScene.add(sunLight.target);

  // Moonlight (only visible at night)
  moonLight = new THREE.DirectionalLight(0x4466aa, 0);
  moonLight.position.set(-200, 300, 100);
  driveScene.add(moonLight);

  // Front fill: lights car's front face — only active when camera is in front mode
  frontFillLight = new THREE.DirectionalLight(0xfff0d0, 0);
  driveScene.add(frontFillLight);
  driveScene.add(frontFillLight.target);


  // Sky
  sky = new Sky();
  sky.scale.setScalar(500000);
  driveScene.add(sky);

  // Water
  water = new Water(new THREE.PlaneGeometry(200000, 200000, 8, 8), {
    textureWidth: 512, textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load(
      'https://threejs.org/examples/textures/waternormals.jpg',
      t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    ),
    sunDirection: new THREE.Vector3(),
    sunColor: 0xffffff, waterColor: 0x001e3f,
    distortionScale: 3.5, fog: false,
  });
  water.rotation.x = -Math.PI / 2;
  driveScene.add(water);

  driveScene.fog = new THREE.FogExp2(0x9bc8d8, 0.00012);

  starsPoints = buildStars();
  starsPoints.visible = false;

  buildBridge();
  buildCityBackdrop();

  // Night light pool: 10 lights repositioned near the player each frame
  for (let i = 0; i < 10; i++) {
    const pl = new THREE.PointLight(0xffcc66, 0, 90, 1.2); // warm, wide range, soft decay
    pl.visible = false;
    driveScene.add(pl);
    bridgeLampLights.push(pl);
  }

  buildNPCCars();

  driveCarGroup.position.copy(carPhys.pos);
  driveScene.add(driveCarGroup);

  applyTimeOfDay('morning');
}

// ─────────────────────────────────────────────
// ── STARS ──
// ─────────────────────────────────────────────
function buildStars() {
  const n = 2500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(Math.random()); // upper hemisphere
    const r     = 12000;
    pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.cos(phi);
    pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 28, sizeAttenuation: true }));
  driveScene.add(pts);
  return pts;
}

// ─────────────────────────────────────────────
// ── TIME OF DAY ──
// ─────────────────────────────────────────────
const TIME = {
  morning: {
    turbidity: 4,  rayleigh: 1.8, mieCoef: 0.004, mieDir: 0.82,
    elevation: 9,  azimuth: 175,
    sunColor: 0xffe4b0, sunInt: 2.8, ambInt: 0.55,
    exposure: 0.58, waterColor: 0x005f8a, dist: 3.5,
    fogColor: 0x9bc8d8, fogDensity: 0.00012, sky: true,
  },
  night: {
    turbidity: 20, rayleigh: 0.5, mieCoef: 0.002, mieDir: 0.6,
    elevation: -5, azimuth: 0,
    sunColor: 0x000000, sunInt: 0.0, ambInt: 0.07,
    exposure: 0.34, waterColor: 0x000208, dist: 1.0,
    fogColor: 0x00010a, fogDensity: 0.00025, sky: false,
  },
};

function applyTimeOfDay(time) {
  timeOfDay = time;
  const p = TIME[time];

  // Sky shader params
  const u = sky.material.uniforms;
  u['turbidity'].value       = p.turbidity;
  u['rayleigh'].value        = p.rayleigh;
  u['mieCoefficient'].value  = p.mieCoef;
  u['mieDirectionalG'].value = p.mieDir;

  const phi   = THREE.MathUtils.degToRad(90 - p.elevation);
  const theta = THREE.MathUtils.degToRad(p.azimuth);
  const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  u['sunPosition'].value.copy(sunPos);

  sunLight.position.set(sunPos.x * 300, sunPos.y * 300, sunPos.z * 300);
  sunLight.color.set(p.sunColor);
  sunLight.intensity  = p.sunInt;
  ambLight.intensity  = p.ambInt;
  renderer.toneMappingExposure = p.exposure;

  water.material.uniforms['sunDirection'].value.copy(sunPos).normalize();
  water.material.uniforms['waterColor'].value.set(p.waterColor);
  water.material.uniforms['distortionScale'].value = p.dist;

  driveScene.fog.color.set(p.fogColor);
  driveScene.fog.density = p.fogDensity;

  // Night-specific: sky visibility, stars, moonlight, lamps
  sky.visible          = p.sky;
  starsPoints.visible  = !p.sky;
  moonLight.intensity  = p.sky ? 0 : 0.35;
driveScene.background = p.sky ? null : new THREE.Color(0x00010a);

  const isNight = !p.sky;
  bridgeLampLights.forEach(l => {
    l.visible   = isNight;
    l.intensity = isNight ? 18 : 0;
  });
  if (lampHeadMat) {
    lampHeadMat.emissiveIntensity = isNight ? 2.5 : 0;
  }

  // City backdrop
  skylineMeshes.forEach(m => {
    m.material.opacity = isNight ? 0.92 : 0.45;
  });
  if (cityWindowPoints) {
    cityWindowPoints.material.opacity = isNight ? 0.88 : 0.40;
    cityWindowPoints.visible = true;
  }

  // ── 모바일 아침 경량화 ──
  if (isMobile) {
    // 아침: bloom 끄기 + 그림자 끄기 → 가장 큰 GPU 비용 2개 제거
    bloom.strength    = isNight ? 0.55 : 0;
    sunLight.castShadow = isNight ? false : false; // 아침·저녁 모두 모바일 그림자 끔
    // NPC 차량: 아침에는 8대만 (저녁은 16대 유지)
    npcCars.forEach((car, i) => { car.mesh.visible = isNight ? true : i < 8; });
  } else {
    bloom.strength = isNight ? 0.55 : 0.15;
  }
}

// ─────────────────────────────────────────────
// ── BRIDGE ──
// ─────────────────────────────────────────────
function buildBridge() {
  // helper functions defined first
  function mat(c, r=0.9, m=0) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  }
  function addMesh(group, geo, material, x, y, z, shadow=false) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    if (shadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
    group.add(mesh);
    return mesh;
  }

  const g = new THREE.Group();
  const DH = BRIDGE.deckH, W = BRIDGE.width, HL = BRIDGE.length / 2;
  const TH = BRIDGE.towerH;

  const mDeck     = mat(0x505050, 0.85);
  const mRoad     = mat(0x3a3a3a, 0.95);
  const mConcrete = mat(0x808080, 0.90);
  const mSteel    = mat(0x9aacb5, 0.35, 0.8);
  const mCable    = mat(0x777777, 0.4,  0.7);
  const mRail     = mat(0xb0b8c0, 0.3,  0.85);
  const mWhite    = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mLamp     = mat(0x555555, 0.5,  0.7);
  // lampHeadMat is module-level so applyTimeOfDay can toggle glow
  lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xffee88,
    emissive: new THREE.Color(0xffaa33),
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  const mLampHead = lampHeadMat;

  // Deck
  addMesh(g, new THREE.BoxGeometry(W, 0.7, BRIDGE.length), mDeck, 0, DH, 0, true);

  // Road surface
  const road = new THREE.Mesh(new THREE.PlaneGeometry(W - 1.8, BRIDGE.length), mRoad);
  road.rotation.x = -Math.PI / 2; road.position.set(0, DH + 0.36, 0);
  road.receiveShadow = true; g.add(road);

  // Lane markings
  const dashGeo = new THREE.PlaneGeometry(0.22, 4.5);
  for (let z = -HL + 8; z < HL; z += 18) {
    [0, -W*0.25, W*0.25].forEach(x => {
      const d = new THREE.Mesh(dashGeo, mWhite);
      d.rotation.x = -Math.PI / 2; d.position.set(x, DH + 0.37, z);
      g.add(d);
    });
  }
  // Edge lines
  [-W/2+1.2, W/2-1.2].forEach(x => {
    const el = new THREE.Mesh(new THREE.PlaneGeometry(0.18, BRIDGE.length), mWhite);
    el.rotation.x = -Math.PI / 2; el.position.set(x, DH + 0.37, 0);
    g.add(el);
  });

  // Guard rails
  [-W/2+0.25, W/2-0.25].forEach(rx => {
    addMesh(g, new THREE.BoxGeometry(0.18, 0.18, BRIDGE.length), mRail, rx, DH+1.4, 0, true);
    addMesh(g, new THREE.BoxGeometry(0.12, 0.12, BRIDGE.length), mRail, rx, DH+0.9, 0);
    for (let z = -HL; z <= HL; z += 4.5) {
      addMesh(g, new THREE.BoxGeometry(0.12, 1.2, 0.12), mRail, rx, DH+0.9, z, true);
    }
  });

  // Cross beams
  for (let z = -HL; z <= HL; z += 12) {
    addMesh(g, new THREE.BoxGeometry(W+2.5, 1.2, 0.9), mDeck, 0, DH-0.9, z, true);
  }

  // Pillars
  for (let z = -HL+40; z < HL-40; z += 50) {
    if (Math.abs(z) < 210) continue;
    addMesh(g, new THREE.BoxGeometry(2.8, DH+2, 2.8), mConcrete, 0, (DH)/2-1.5, z, true);
  }

  // Towers — two pairs spread out across the longer bridge
  [{ tz: -550 }, { tz: 550 }].forEach(({ tz }) => {
    const dir = tz < 0 ? -1 : 1;
    [-(W/2-3.5), (W/2-3.5)].forEach(tx => {
      addMesh(g, new THREE.BoxGeometry(3.5, TH, 3.5), mConcrete, tx, DH+TH/2, tz, true);
      addMesh(g, new THREE.BoxGeometry(Math.abs(tx)*2, 2.5, 2.5), mConcrete, 0, DH+TH*0.45, tz);
      addMesh(g, new THREE.BoxGeometry(Math.abs(tx)*2, 1.8, 1.8), mSteel, 0, DH+TH*0.82, tz);

      // Stay cables — longer spans for bigger bridge
      [220, 170, 125, 85, 50, 22].forEach(span => {
        const from = new THREE.Vector3(tx, DH+TH, tz);
        const to   = new THREE.Vector3(tx, DH+0.38, tz + dir*span);
        const d3   = to.clone().sub(from);
        const len  = d3.length();
        const mid  = from.clone().add(to).multiplyScalar(0.5);
        const cyl  = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, len, 6), mCable);
        cyl.position.copy(mid);
        cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d3.normalize());
        g.add(cyl);
      });
    });
  });

  // ── Streetlamp posts (both sides) ──
  const lampPoleGeo = new THREE.CylinderGeometry(0.09, 0.13, 6, 8);
  const lampArmGeo  = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6);
  const lampHeadGeo = new THREE.SphereGeometry(0.22, 10, 10);

  for (let z = -HL+20; z < HL; z += LAMP_SPACING) {
    [-W/2+0.6, W/2-0.6].forEach(lx => {
      // Pole
      const pole = new THREE.Mesh(lampPoleGeo, mLamp);
      pole.position.set(lx, DH + 3, z);
      pole.castShadow = true;
      g.add(pole);

      // Arm extending inward
      const arm = new THREE.Mesh(lampArmGeo, mLamp);
      arm.rotation.z = Math.PI / 2;
      const armX = lx > 0 ? lx - 0.75 : lx + 0.75;
      arm.position.set(armX, DH + 6.1, z);
      g.add(arm);

      // Lamp head (emissive, glows at night)
      const head = new THREE.Mesh(lampHeadGeo, mLampHead);
      const hx = lx > 0 ? lx - 1.5 : lx + 1.5;
      head.position.set(hx, DH + 6.15, z);
      g.add(head);
      // PointLights are managed as a small pool in buildDriveScene (for performance)
    });
  }

  // Far approach sections
  [-1, 1].forEach(side => {
    const ap = new THREE.Mesh(new THREE.PlaneGeometry(W-1.8, 600), mRoad);
    ap.rotation.x = -Math.PI/2; ap.position.set(0, DH+0.36, side*(HL+300));
    g.add(ap);
    addMesh(g, new THREE.BoxGeometry(W, 0.7, 600), mDeck, 0, DH, side*(HL+300));
  });

  driveScene.add(g);
}

// ─────────────────────────────────────────────
// ── CITY BACKDROP ──
// ─────────────────────────────────────────────
function makeSkylineTex(seedNum) {
  const W = 2048, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Deterministic RNG from seed
  let s = seedNum >>> 0;
  const rnd = () => { s = Math.imul(s, 1664525) + 1013904223 >>> 0; return s / 0x100000000; };

  // Horizon glow
  const glow = ctx.createLinearGradient(0, H * 0.35, 0, H);
  glow.addColorStop(0, 'rgba(8,16,45,0)');
  glow.addColorStop(1, 'rgba(22,40,95,0.65)');
  ctx.fillStyle = glow; ctx.fillRect(0, H * 0.35, W, H * 0.65);

  // Building silhouettes
  const bldgs = [];
  for (let i = 0; i < 68; i++) {
    bldgs.push({ x: rnd() * W, w: 18 + rnd() * 88, h: 32 + Math.pow(rnd(), 1.2) * 400 });
  }
  bldgs.sort((a, b) => b.h - a.h);

  bldgs.forEach(b => {
    const lum = 5 + rnd() * 9;
    ctx.fillStyle = `rgb(${lum},${lum+3},${lum+10})`;
    ctx.fillRect(b.x - b.w/2, H - b.h, b.w, b.h);
  });

  // Windows
  bldgs.forEach(b => {
    const WSTEP = 11, HSTEP = 14;
    const cols = Math.max(1, Math.floor(b.w / WSTEP));
    const rows = Math.max(1, Math.floor(b.h / HSTEP));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rnd() > 0.50) continue;
        const wx = b.x - b.w/2 + 2 + c * WSTEP;
        const wy = H - b.h + 4 + r * HSTEP;
        const t = rnd();
        ctx.fillStyle = t < 0.18
          ? `rgba(160,215,255,${0.75+rnd()*0.25})`   // cool white
          : t < 0.55
          ? `rgba(255,215,125,${0.75+rnd()*0.25})`   // warm yellow
          : `rgba(255,170,65,${0.70+rnd()*0.25})`;   // amber
        ctx.fillRect(wx, wy, 6, 8);
      }
    }
  });

  return new THREE.CanvasTexture(cv);
}

function buildCityBackdrop() {
  const matOpts = { transparent: true, depthWrite: false };

  // ── 1. Distant skyline billboards ──
  // Two side billboards running parallel to the bridge
  [{ side: -1, seed: 42 }, { side: 1, seed: 99 }].forEach(({ side, seed }) => {
    const m = new THREE.MeshBasicMaterial({ ...matOpts, map: makeSkylineTex(seed), opacity: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7500, 520), m);
    mesh.position.set(side * 1600, 260, 0);
    mesh.rotation.y = side * Math.PI / 2;
    driveScene.add(mesh);
    skylineMeshes.push(mesh);
  });

  // Two end-cap billboards (ahead of / behind the bridge)
  [{ z: 3900, ry: Math.PI, seed: 77 }, { z: -3900, ry: 0, seed: 55 }].forEach(({ z, ry, seed }) => {
    const m = new THREE.MeshBasicMaterial({ ...matOpts, map: makeSkylineTex(seed), opacity: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4200, 520), m);
    mesh.position.set(0, 260, z);
    mesh.rotation.y = ry;
    driveScene.add(mesh);
    skylineMeshes.push(mesh);
  });

  // ── 2. Mid-ground buildings (single InstancedMesh → 1 draw call) ──
  const COUNT  = 210;
  const dummy  = new THREE.Object3D();
  const bldgMat = new THREE.MeshStandardMaterial({
    color: 0x2a3f5c, roughness: 0.85, metalness: 0.15,
    emissive: new THREE.Color(0x1a3058), emissiveIntensity: 1.4,
  });
  const bldgMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bldgMat, COUNT);
  bldgMesh.castShadow = false; bldgMesh.receiveShadow = false;

  let idx = 0;
  const HL = BRIDGE.length / 2;

  const addBldg = (x, z, w, d, h) => {
    if (idx >= COUNT) return;
    dummy.position.set(x, h / 2, z);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    bldgMesh.setMatrixAt(idx++, dummy.matrix);
  };

  // Close row (45–160 m from bridge center)
  [-1, 1].forEach(side => {
    for (let i = 0; i < 55; i++) {
      const z = (Math.random() - 0.5) * (BRIDGE.length + 1200);
      const x = side * (45 + Math.random() * 115);
      addBldg(x, z, 10+Math.random()*40, 10+Math.random()*40, 35+Math.pow(Math.random(),1.3)*200);
    }
  });

  // Mid row (160–500 m)
  [-1, 1].forEach(side => {
    for (let i = 0; i < 35; i++) {
      const z = (Math.random() - 0.5) * (BRIDGE.length + 1600);
      const x = side * (160 + Math.random() * 340);
      addBldg(x, z, 18+Math.random()*60, 18+Math.random()*60, 60+Math.pow(Math.random(),1.1)*320);
    }
  });

  // Bridge ends
  [-1, 1].forEach(side => {
    for (let i = 0; i < 15; i++) {
      const z = side * (HL + 60 + Math.random() * 1100);
      const x = (Math.random() - 0.5) * 450;
      addBldg(x, z, 12+Math.random()*55, 12+Math.random()*55, 22+Math.pow(Math.random(),1.2)*200);
    }
  });

  bldgMesh.count = idx;
  bldgMesh.instanceMatrix.needsUpdate = true;
  driveScene.add(bldgMesh);

  // ── 3. Window-light particle cloud ──
  const posArr = [], colArr = [];
  const palette = [
    [1.0, 0.87, 0.44], [1.0, 0.78, 0.30], [1.0, 0.96, 0.62],
    [0.62, 0.82, 1.0], [0.70, 0.90, 1.0],
  ];
  for (let i = 0; i < 5000; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (42 + Math.random() * 520);
    const z = (Math.random() - 0.5) * 7000;
    const h = 3 + Math.random() * 175;
    posArr.push(x, h, z);
    const [r, g, b] = palette[Math.floor(Math.random() * palette.length)];
    colArr.push(r, g, b);
  }
  const winGeo = new THREE.BufferGeometry();
  winGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  winGeo.setAttribute('color',    new THREE.Float32BufferAttribute(colArr, 3));
  cityWindowPoints = new THREE.Points(winGeo, new THREE.PointsMaterial({
    size: 3.8, sizeAttenuation: true,
    vertexColors: true, transparent: true, opacity: 0,
    depthWrite: false,
  }));
  cityWindowPoints.visible = false;
  driveScene.add(cityWindowPoints);
}

// ─────────────────────────────────────────────
// ── NPC TRAFFIC ──
// ─────────────────────────────────────────────
const npcCars = [];

function buildNPCCars() {
  // Create empty groups first — GLB models are added later in loadNPCCars()
  const lanes = [
    { x: -9.2, dir: -1 },
    { x: -3.1, dir: -1 },
    { x:  3.1, dir:  1 },
    { x:  9.2, dir:  1 },
  ];
  lanes.forEach(lane => {
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const startZ = ((i / 4) - 0.5) * BRIDGE.length * 0.75 + (Math.random() - 0.5) * 200;
      g.position.set(lane.x, BRIDGE.deckH + 0.45, startZ);
      if (lane.dir === -1) g.rotation.y = Math.PI;
      driveScene.add(g);
      npcCars.push({ mesh: g, dir: lane.dir, speed: 22 + Math.random() * 22 });
    }
  });
}

function loadNPCCars() {
  const loader = new GLTFLoader();
  loader.load('./assets/car.glb',
    gltf => {
      const template = gltf.scene;

      // Scale — same logic as player car
      const bbox = new THREE.Box3().setFromObject(template);
      const sz   = bbox.getSize(new THREE.Vector3());
      const maxD = Math.max(sz.x, sz.y, sz.z);
      if (maxD > 0) template.scale.setScalar(4.5 / maxD);

      const bbox2 = new THREE.Box3().setFromObject(template);
      const ctr   = bbox2.getCenter(new THREE.Vector3());
      template.position.x -= ctr.x;
      template.position.z -= ctr.z;
      template.position.y -= bbox2.min.y;

      // Paint all body parts gray (0x909090), keep glass/wheels original
      template.traverse(n => {
        if (!n.isMesh || !n.material) return;
        const nm   = (n.name || '').toLowerCase();
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        const isGlass = nm.includes('glass') || nm.includes('window') ||
                        nm.includes('windshield') || nm.includes('windscreen') ||
                        mats.some(m => (m.transparent && m.opacity < 0.95) || m.transmission > 0 || m.roughness < 0.05);
        const isWheel = nm.includes('wheel') || nm.includes('tire') || nm.includes('tyre');
        if (!isGlass && !isWheel && !nm.includes('light') && !nm.includes('lamp')) {
          mats.forEach(m => { if (m.color) m.color.set(0x909090); });
        }
        n.castShadow = true;
      });

      // Clone template into each NPC group (geometry/texture shared → low memory)
      npcCars.forEach(npc => {
        npc.mesh.add(template.clone(true));
      });
    },
    undefined,
    err => console.warn('[NPC GLB] 로딩 실패:', err)
  );
}

function updateNPCs(dt) {
  const halfLen = BRIDGE.length / 2 - 10;
  npcCars.forEach(car => {
    car.mesh.position.z += car.dir * car.speed * dt;
    if (car.dir > 0 && car.mesh.position.z >  halfLen) car.mesh.position.z = -halfLen;
    if (car.dir < 0 && car.mesh.position.z < -halfLen) car.mesh.position.z =  halfLen;
  });
}

// ─────────────────────────────────────────────
// ── NIGHT LIGHTS (pool, repositioned near player) ──
// ─────────────────────────────────────────────
function updateNightLights() {
  if (!bridgeLampLights.length) return;
  if (timeOfDay !== 'night') {
    bridgeLampLights.forEach(l => { l.visible = false; l.intensity = 0; });
    return;
  }
  const HL      = BRIDGE.length / 2;
  const firstZ  = -HL + 20;
  const nearIdx = Math.round((carPhys.pos.z - firstZ) / LAMP_SPACING);
  const sides   = [-(BRIDGE.width / 2 - 2), BRIDGE.width / 2 - 2];
  let idx = 0;
  for (let di = -2; di <= 2; di++) {
    const lz = firstZ + (nearIdx + di) * LAMP_SPACING;
    const ok = lz >= -HL && lz <= HL;
    sides.forEach(sx => {
      const l = bridgeLampLights[idx++];
      if (!l) return;
      if (!ok) { l.visible = false; return; }
      l.position.set(sx, BRIDGE.deckH + 6.15, lz);
      l.visible   = true;
      l.intensity = 28;
    });
  }
}

// ─────────────────────────────────────────────
// ── CAR LOADING ──
// ─────────────────────────────────────────────
function loadCar() {
  const loader = new GLTFLoader();

  const load = (targetGroup, onMixer, onWheels, callback, onProgress) => {
    loader.load('./assets/car.glb',
      gltf => {
        console.log('[Car] GLB 로딩 성공 ✅');
        const model = gltf.scene;

        // Collect body materials before scaling
        model.traverse(n => {
          if (!n.isMesh) return;
          n.castShadow = n.receiveShadow = true;
          if (!n.material) return;
          const nm = (n.name || '').toLowerCase();

          // Detect glass by name keywords OR material transparency/roughness
          const isGlassByName = nm.includes('glass') || nm.includes('window') ||
                                nm.includes('windshield') || nm.includes('windscreen') ||
                                nm.includes('crystal') || nm.includes('vitre') ||
                                nm.includes('screen') || nm.includes('glazing');
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          const isGlassByMat = mats.some(m =>
            (m.transparent && m.opacity < 0.95) || m.transmission > 0 || m.roughness < 0.05
          );
          const isGlass = isGlassByName || isGlassByMat;

          const isWheel = nm.includes('wheel') || nm.includes('tire') || nm.includes('tyre');
          const isExcluded = isGlass || isWheel ||
                             nm.includes('light') || nm.includes('lamp');

          if (!isExcluded) {
            mats.forEach((mat, idx) => {
              const c = mat.clone();
              if (Array.isArray(n.material)) n.material[idx] = c; else n.material = c;
              carBodyMats.push(c);
            });
          }
          if (isWheel) onWheels(n);
        });

        targetGroup.add(model);

        // Auto-scale to car-sized bounding box (~4.5 units long)
        const bbox = new THREE.Box3().setFromObject(model);
        const sz   = bbox.getSize(new THREE.Vector3());
        const maxD = Math.max(sz.x, sz.y, sz.z);
        if (maxD > 0) model.scale.setScalar(4.5 / maxD);

        // Center + sit on ground
        const bbox2 = new THREE.Box3().setFromObject(model);
        const ctr   = bbox2.getCenter(new THREE.Vector3());
        model.position.x -= ctr.x;
        model.position.z -= ctr.z;
        model.position.y -= bbox2.min.y;

        // Wheel animations from GLB
        if (gltf.animations?.length) {
          const mx = new THREE.AnimationMixer(model);
          gltf.animations.forEach(clip => mx.clipAction(clip).play());
          onMixer(mx);
        }
        callback?.();
      },
      onProgress,
      err => {
        console.warn('[Car] GLB 로딩 실패 (폴백 사용):', err);
        fallbackCar(targetGroup, onWheels, callback);
      }
    );
  };

  // 첫 번째 로드에서 진행률 표시
  const trackProgress = xhr => {
    if (!xhr.total) return;
    const pct = Math.min(100, Math.round(xhr.loaded / xhr.total * 100));
    const bar = document.getElementById('loading-bar');
    const txt = document.getElementById('loading-pct');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = pct + '%';
  };

  load(garageCarGroup, mx => { garageMixer = mx; }, () => {}, () => applyColor(selectedColor), trackProgress);
  load(driveCarGroup,  mx => { driveMixer  = mx; }, n  => driveWheels.push(n),
    () => {
      // 드라이브 차량 로드 완료 → 로딩 화면 페이드 아웃
      const screen = document.getElementById('loading-screen');
      if (screen) {
        const bar = document.getElementById('loading-bar');
        const txt = document.getElementById('loading-pct');
        if (bar) bar.style.width = '100%';
        if (txt) txt.textContent = '100%';
        setTimeout(() => {
          screen.classList.add('fade-out');
          setTimeout(() => screen.remove(), 950);
        }, 300);
      }
      document.getElementById('touch-hint') && (document.getElementById('touch-hint').style.opacity = '0');
      applyColor(selectedColor);
    }
  );
}

function fallbackCar(group, onWheels, callback) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: CAR_COLORS[selectedColor], roughness: 0.25, metalness: 0.7 });
  carBodyMats.push(bodyMat);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 4.4), bodyMat);
  body.position.y = 0.38; body.castShadow = true; group.add(body);

  const roofMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.4 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, 2.3), roofMat);
  roof.position.set(0, 1.05, 0.25); group.add(roof);

  const wMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9 });
  [[-1.15,0,-1.4],[1.15,0,-1.4],[-1.15,0,1.4],[1.15,0,1.4]].forEach(([x,y,z]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.32, 20), wMat);
    w.rotation.z = Math.PI / 2; w.position.set(x, y, z); w.castShadow = true;
    group.add(w); onWheels(w);
  });
  callback?.();
}

function applyColor(key) {
  selectedColor = key;
  const props = COLOR_PROPS[key];
  carBodyMats.forEach(m => {
    if (m.color) m.color.set(CAR_COLORS[key]);
    if (props) { m.metalness = props.metalness; m.roughness = props.roughness; }
  });
}

// ─────────────────────────────────────────────
// ── PHYSICS ──
// ─────────────────────────────────────────────
function updatePhysics(dt) {
  const keySteer = (keyState.right ? 1 : 0) - (keyState.left ? 1 : 0);
  const steer    = steeringInput || keySteer;
  const forward  = inp.fwd || keyState.fwd;

  // ── Forward speed (Z axis always) ──
  if (forward) {
    forwardSpd += DRIVE.forwardAccel * dt;
  } else {
    forwardSpd -= DRIVE.friction * dt;
  }
  forwardSpd -= DRIVE.drag * forwardSpd * Math.abs(forwardSpd) * dt;
  forwardSpd  = THREE.MathUtils.clamp(forwardSpd, 0, DRIVE.maxSpeed);
  if (!forward && forwardSpd < 0.1) forwardSpd = 0;

  // ── Lateral velocity (X axis, drag-controlled) ──
  const lateralTarget = steer * DRIVE.maxLateral;
  const diff          = lateralTarget - lateralVel;
  const step          = (steer !== 0 ? DRIVE.lateralAccel : DRIVE.lateralDecay) * dt;
  lateralVel += Math.sign(diff) * Math.min(Math.abs(diff), step);

  // ── Move ──
  carPhys.pos.z += forwardSpd * dt;
  carPhys.pos.x += lateralVel * dt;

  // Bridge bounds — zero lateral on wall hit
  const xMax = BRIDGE.width / 2 - 1.6;
  if (carPhys.pos.x < -xMax) { carPhys.pos.x = -xMax; lateralVel = 0; }
  if (carPhys.pos.x >  xMax) { carPhys.pos.x =  xMax; lateralVel = 0; }
  carPhys.pos.z = THREE.MathUtils.clamp(carPhys.pos.z, -(BRIDGE.length/2-15), BRIDGE.length/2-15);

  // ── Visual yaw (cosmetic lean — pure visual, no effect on movement) ──
  // velYaw: actual heading direction of combined velocity vector
  // steer * 0.12: input "anticipation" so car starts tilting immediately on drag
  const velYaw    = forwardSpd > 0.5 ? Math.atan2(lateralVel, forwardSpd) : 0;
  const targetYaw = THREE.MathUtils.clamp(
    velYaw + steer * 0.12,
    -DRIVE.maxVisualYaw, DRIVE.maxVisualYaw
  );
  visualYaw += (targetYaw - visualYaw) * Math.min(DRIVE.yawSmooth * dt, 1);

  driveCarGroup.position.copy(carPhys.pos);
  driveCarGroup.rotation.y = visualYaw;

  // ── Wheel spin & mixer ──
  const spin = forwardSpd * dt * 2.5;
  driveWheels.forEach(w => { w.rotation.x += spin; });
  if (driveMixer) {
    driveMixer.timeScale = Math.min(forwardSpd / 12, 3);
    driveMixer.update(dt);
  }

  // Speedometer (1:1 — maxSpeed 100 = 100 km/h)
  document.getElementById('speed-val').textContent = Math.round(forwardSpd);

  // ── Camera ──
  // camVertical: 위 드래그 = +1(하이앵글), 아래 드래그 = -1(로우앵글)
  camVertical += (verticalInput - camVertical) * Math.min(4 * dt, 1);
  const camDist   = 6.5;
  const camH      = 4 + camVertical * 3;   // 1 ~ 7 범위
  const lookAtY   = 1.2 - camVertical * 0.5; // 앵글에 따라 시선 높이 미세조정

  if (cameraMode === 'rear') {
    const rearDist = 6.5 - camVertical * 2.5; // 로우앵글(↓) → 최대 9.0, 하이앵글(↑) → 최소 4.0
    const targetCamPos = new THREE.Vector3(
      carPhys.pos.x,
      carPhys.pos.y + camH,
      carPhys.pos.z - rearDist
    );
    driveCam.position.lerp(targetCamPos, 0.09);
    driveCam.up.set(0, 1, 0);
    driveCam.lookAt(carPhys.pos.clone().add(new THREE.Vector3(0, lookAtY, 0)));
  } else {
    const speedRatio = forwardSpd / DRIVE.maxSpeed;
    const frontDist  = 12 + speedRatio * 4 - camVertical * 4; // 로우앵글(↓) → 최대 16+, 하이앵글(↑) → 최소 8+
    const frontH     = Math.max(3.0, camH * 0.7 + speedRatio * 1.2);
    const targetCamPos = new THREE.Vector3(
      carPhys.pos.x,
      carPhys.pos.y + frontH,
      carPhys.pos.z + frontDist
    );
    driveCam.position.lerp(targetCamPos, 0.09);
    driveCam.up.set(0, 1, 0);
    driveCam.lookAt(carPhys.pos.clone().add(new THREE.Vector3(0, lookAtY, 0)));
  }

  // Shadow follows car
  sunLight.target.position.copy(carPhys.pos);
  sunLight.target.updateMatrixWorld();

  // Front fill: ON only when front camera — shines from ahead of car onto its front face
  if (cameraMode === 'front') {
    frontFillLight.intensity = timeOfDay === 'night' ? 2.2 : 1.5;
    frontFillLight.position.set(carPhys.pos.x, carPhys.pos.y + 25, carPhys.pos.z + 70);
    frontFillLight.target.position.copy(carPhys.pos);
    frontFillLight.target.updateMatrixWorld();
  } else {
    frontFillLight.intensity = 0;
  }

}

// ─────────────────────────────────────────────
// ── GARAGE ANIMATION ──
// ─────────────────────────────────────────────
let garageAngle = 0, garageCamAngle = 0;

function updateGarage(dt) {
  garageAngle += dt * 0.22;
  garageCarGroup.rotation.y = garageAngle;

  garageCamAngle += dt * 0.07;
  garageCam.position.x = Math.sin(garageCamAngle) * 0.9;
  garageCam.position.z = 7.5 + Math.cos(garageCamAngle * 0.6) * 0.4;
  garageCam.lookAt(0, 0.9, 0);

  if (garageMixer) garageMixer.update(dt);
}

// ─────────────────────────────────────────────
// ── ENGINE SOUND ──
// ─────────────────────────────────────────────
let engineAudio = null;

function initEngineSound() {
  const audio = new Audio('./assets/engine.mp3');
  audio.loop   = true;
  audio.volume = 0;
  audio.playbackRate = 0.8;
  audio.addEventListener('canplaythrough', () => { engineAudio = audio; }, { once: true });
  audio.addEventListener('error', () => { engineAudio = null; });
  audio.load();
}

function updateEngineSound(dt) {
  if (!engineAudio || appState !== 'drive') return;
  const ratio = forwardSpd / DRIVE.maxSpeed;
  // volume: ramps from 0 to 0.55 as speed increases
  const targetVol  = inp.fwd || forwardSpd > 0.5 ? 0.45 + ratio * 0.45 : 0;
  // pitch: 0.8 (idle) → 1.9 (max speed)
  const targetRate = 0.8 + ratio * 1.1;
  engineAudio.volume       = THREE.MathUtils.lerp(engineAudio.volume,       targetVol,  Math.min(3 * dt, 1));
  engineAudio.playbackRate = THREE.MathUtils.lerp(engineAudio.playbackRate, targetRate, Math.min(4 * dt, 1));
  if (engineAudio.paused && (inp.fwd || forwardSpd > 0.5)) {
    engineAudio.play().catch(() => {});
  }
}

// ── MUSIC ──
// ─────────────────────────────────────────────
let bgAudio   = null;   // HTML5 Audio (local MP3 or uploaded file)
let ytPlayer  = null;   // YouTube IFrame player (optional, user-provided link)
let ytReady   = false;
let ytActive  = false;  // true = YouTube is the active source
let playing   = false;

// ── Default local MP3 ──
function initDefaultMusic() {
  const audio = new Audio(DEFAULT_MUSIC);
  audio.loop = true; audio.volume = 0.7;
  audio.addEventListener('canplaythrough', () => { bgAudio = audio; bgAudio.currentTime = 0.5; }, { once: true });
  audio.addEventListener('error', () => { bgAudio = null; });
  audio.load();
}

// ── YouTube: extract ID from any youtube URL ──
function extractYTId(url) {
  const m = url.match(/(?:youtu\.be\/|[?&]v=)([\w-]{11})/);
  return m ? m[1] : null;
}

function setYTStatus(msg, isError) {
  const el = document.getElementById('yt-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#ff6b6b' : 'rgba(255,255,255,0.5)';
}

function playYTLink(videoId) {
  if (bgAudio) { bgAudio.pause(); }

  if (ytPlayer && ytReady) {
    ytPlayer.loadVideoById(videoId);
    ytActive = true;
    playing  = true;
    document.getElementById('music-play-btn').textContent = '⏸';
    document.getElementById('music-src').textContent = 'YouTube';
    setYTStatus('연결 중...', false);
  } else {
    // Player not ready yet — create it
    ytPlayer = new YT.Player('yt-player', {
      width: '200', height: '120',
      videoId,
      playerVars: { autoplay: 1, controls: 0, playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          ytReady = true;
          ytPlayer.setVolume(70);
          ytPlayer.playVideo();
          ytActive = true; playing = true;
          document.getElementById('music-play-btn').textContent = '⏸';
          document.getElementById('music-src').textContent = 'YouTube';
          setYTStatus('재생 중', false);
        },
        onStateChange: e => {
          if (e.data === YT.PlayerState.ENDED) ytPlayer.playVideo();
        },
        onError: e => {
          const msg = e.data === 150 || e.data === 101
            ? 'embed 차단 영상 — MP3 업로드를 이용해 주세요'
            : `재생 오류 (${e.data})`;
          setYTStatus(msg, true);
          ytActive = false;
        },
      },
    });
  }
}

// Called by YouTube IFrame API when script loads
window.onYouTubeIframeAPIReady = () => { ytReady = false; /* player created on demand */ };

function playMusic() {
  playing = true;
  document.getElementById('music-play-btn').textContent = '⏸';
  if (ytActive && ytPlayer && ytReady) ytPlayer.playVideo();
  else if (bgAudio) bgAudio.play().catch(() => {});
}
function pauseMusic() {
  playing = false;
  document.getElementById('music-play-btn').textContent = '▶';
  if (ytActive && ytPlayer && ytReady) ytPlayer.pauseVideo();
  else if (bgAudio) bgAudio.pause();
}
function toggleMusic() { playing ? pauseMusic() : playMusic(); }

// ─────────────────────────────────────────────
// ── CONTROLS (mobile-first) ──
// ─────────────────────────────────────────────
function setupControls() {
  const driveTouch = document.getElementById('drive-touch');

  // ── Touch: tap anywhere = forward, drag = steer ──
  driveTouch.addEventListener('touchstart', e => {
    e.preventDefault();
    if (activeTouchId !== null) return;
    const t = e.changedTouches[0];
    activeTouchId = t.identifier;
    touchStartX   = t.clientX;
    touchStartY   = t.clientY;
    steeringInput = 0;
    verticalInput = 0;
    inp.fwd       = true;
    document.getElementById('touch-hint')?.classList.add('hidden');
  }, { passive: false });

  driveTouch.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = [...e.changedTouches].find(t => t.identifier === activeTouchId);
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    steeringInput = Math.max(-1, Math.min(1,  dx / (innerWidth  * 0.32)));
    verticalInput = Math.max(-1, Math.min(1, -dy / (innerHeight * 0.35))); // 위로 드래그 = +1
  }, { passive: false });

  driveTouch.addEventListener('touchend', e => {
    e.preventDefault();
    if (![...e.changedTouches].some(t => t.identifier === activeTouchId)) return;
    activeTouchId = null;
    steeringInput = 0;
    verticalInput = 0;
    inp.fwd       = false;
  }, { passive: false });

  driveTouch.addEventListener('touchcancel', () => {
    activeTouchId = null; steeringInput = 0; verticalInput = 0; inp.fwd = false;
  });

  // ── Mouse (desktop) ──
  let mouseDown = false;
  driveTouch.addEventListener('mousedown', e => {
    mouseDown     = true;
    touchStartX   = e.clientX;
    touchStartY   = e.clientY;
    steeringInput = 0;
    verticalInput = 0;
    inp.fwd = true;
  });
  driveTouch.addEventListener('mousemove', e => {
    if (!mouseDown) return;
    steeringInput = Math.max(-1, Math.min(1,  (e.clientX - touchStartX) / (innerWidth  * 0.32)));
    verticalInput = Math.max(-1, Math.min(1, -(e.clientY - touchStartY) / (innerHeight * 0.35)));
  });
  const stopMouse = () => { mouseDown = false; inp.fwd = false; steeringInput = 0; verticalInput = 0; };
  driveTouch.addEventListener('mouseup',    stopMouse);
  driveTouch.addEventListener('mouseleave', stopMouse);

  // ── Keyboard (desktop) ──
  const km = { ArrowUp:'fwd', KeyW:'fwd', ArrowLeft:'left', KeyA:'left', ArrowRight:'right', KeyD:'right' };
  window.addEventListener('keydown', e => { if (km[e.code]) { keyState[km[e.code]] = true; e.preventDefault(); } });
  window.addEventListener('keyup',   e => { if (km[e.code])   keyState[km[e.code]] = false; });
}

// ─────────────────────────────────────────────
// ── UI EVENTS ──
// ─────────────────────────────────────────────
function setupUI() {
  document.querySelectorAll('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      applyColor(sw.dataset.color);
    });
  });

  document.getElementById('start-btn').addEventListener('click', transitionToDrive);

  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyTimeOfDay(btn.dataset.time);
    });
  });

  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cameraMode = btn.dataset.cam;
    });
  });

  document.getElementById('music-play-btn').addEventListener('click', toggleMusic);

  document.getElementById('music-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (ytActive && ytPlayer && ytReady) { ytPlayer.stopVideo(); ytActive = false; }
    if (bgAudio) { bgAudio.pause(); if (bgAudio.src?.startsWith('blob:')) URL.revokeObjectURL(bgAudio.src); }
    bgAudio = new Audio(URL.createObjectURL(file));
    bgAudio.loop = true; bgAudio.volume = 0.7;
    bgAudio.play().catch(() => {});
    playing = true;
    document.getElementById('music-play-btn').textContent = '⏸';
    document.getElementById('music-name').textContent = file.name.replace(/\.[^.]+$/, '');
    document.getElementById('music-src').textContent  = '내 음악';
    setYTStatus('', false);
  });

  // YouTube link input
  const ytBtn   = document.getElementById('yt-link-btn');
  const ytInput = document.getElementById('yt-link-input');
  function tryYTLink() {
    const id = extractYTId(ytInput.value.trim());
    if (!id) { setYTStatus('올바른 YouTube 링크가 아닙니다', true); return; }
    document.getElementById('music-name').textContent = 'YouTube 음악';
    document.getElementById('music-src').textContent  = 'YouTube';
    setYTStatus('연결 중...', false);
    playYTLink(id);
  }
  ytBtn.addEventListener('click', tryYTLink);
  ytInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryYTLink(); });
}

// ─────────────────────────────────────────────
// ── SCENE TRANSITION ──
// ─────────────────────────────────────────────
function transitionToDrive() {
  const ov = document.getElementById('overlay');
  ov.style.transition = 'opacity 0.75s ease';
  ov.style.opacity    = '1';

  setTimeout(() => {
    document.getElementById('garage-ui').style.display = 'none';
    document.getElementById('drive-ui').classList.add('active');
    appState = 'driving';
    switchToDriveComposer();

    ov.style.transition = 'opacity 1s ease';
    ov.style.opacity    = '0';

    setTimeout(playMusic, 1400);
  }, 750);
}

// ─────────────────────────────────────────────
// ── RESIZE ──
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  [garageCam, driveCam].forEach(c => { c.aspect = w / h; c.updateProjectionMatrix(); });
});

// ─────────────────────────────────────────────
// ── MAIN LOOP ──
// ─────────────────────────────────────────────
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (appState === 'garage') {
    updateGarage(dt);
  } else {
    if (water) water.material.uniforms['time'].value += dt * 0.4;
    updatePhysics(dt);
    updateNPCs(dt);
    updateNightLights();
    updateEngineSound(dt);
  }
  composer.render();
}

// ─────────────────────────────────────────────
// ── INIT ──
// ─────────────────────────────────────────────
buildGarage();
buildDriveScene();
setupUI();
setupControls();
loadCar();
loadNPCCars();
initDefaultMusic();
initEngineSound();

window.addEventListener('load', () => {
  const ov = document.getElementById('overlay');
  ov.style.transition = 'opacity 1.2s ease';
  ov.style.opacity    = '0';
  setTimeout(() => ov.classList.add('gone'), 1300);
});

animate();
