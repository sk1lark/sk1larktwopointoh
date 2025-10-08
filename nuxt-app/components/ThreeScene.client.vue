<template>
  <div ref="container" class="three-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import * as THREE from 'three';
// three examples utilities for post-processing and rect area lights
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
// SSAO adds subtle contact shadows to ground objects
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
// We'll implement custom grain via a small noise shader instead of FilmPass to keep types compatible
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const container = ref<HTMLDivElement | null>(null);
let scene: THREE.Scene;
let camera: THREE.Camera; // Perspective per spec
let overlayCam: THREE.PerspectiveCamera | null = null;
let worldCam: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer;
let animationId: number;
let time = 0;
// Pixel-art pipeline
let pixelScale = 4; // chunky pixels (adjust to taste: 3-5)
let target: THREE.WebGLRenderTarget | null = null;
let screenScene: THREE.Scene | null = null;
let screenCam: THREE.OrthographicCamera | null = null;
let screenQuad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
const _tmpSize = new THREE.Vector2();
// Rendering pipeline: the pixel pipeline can overly darken the scene on some GPUs.
// Disable by default for reliability; you can set this back to true if you prefer the chunky look.
let usePixelPipeline = false; // use composer-based pipeline with a final Pixelate shader pass
let useOverlayLayers = false;  // disable card/world layer split for now
// Post-processing
let composer: EffectComposer | null = null;
let bloomPass: UnrealBloomPass | null = null;
let noisePass: ShaderPass | null = null;
let pixelatePass: ShaderPass | null = null;
let vignettePass: ShaderPass | null = null;
const usePost = true; // enable post stack (bloom, vignette, noise, SSAO)
const SPEC_MODE = false; // restore full decorated scene per previous build

// Cozy atoms
let dustParticles: THREE.Points | null = null;
let dustPhases: Float32Array | null = null;
let dustBounds = { minY: -0.5, maxY: 6.5 };
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let garlandSprites: THREE.Sprite[] = [];
let garlandBulbs: { mesh: THREE.Mesh, light: THREE.PointLight, phase: number }[] = [];
// Cozy Cafe palette (7 colors) — used consistently across materials
const PALETTE = {
  wall: '#2E4035',         // deep green wall (final blueprint)
  oakLight: '#D2B48C',     // light oak (counter)
  oakDark: '#8B5E3C',      // dark oak / accents
  chalk: '#F9E8C2',        // chalk/menu text
  coffee: '#A0522D',       // sienna floor planks base (final blueprint)
  shadowWarm: '#FFDDA1',   // warm ambient tint
  accent: '#3D2B1F',       // menu board wood / accents
} as const;

// Material factory. Toggle between PBR and simpler Lambert to avoid GPU/shader issues.
const usePBR = true; // use MeshStandardMaterial for realistic shading
function makeStandard(colorHex: string, opts?: { roughness?: number; metalness?: number; map?: THREE.Texture; roughnessMap?: THREE.Texture; normalMap?: THREE.Texture; emissive?: string | number; emissiveIntensity?: number; transparent?: boolean; opacity?: number; toneMapped?: boolean; side?: THREE.Side; envMapIntensity?: number; aoMap?: THREE.Texture; aoMapIntensity?: number; normalScale?: number | THREE.Vector2 }) {
  if (!usePBR) {
    const m = new THREE.MeshLambertMaterial({
      color: new THREE.Color(colorHex),
      map: opts?.map,
      side: opts?.side,
    });
    if (opts?.transparent) m.transparent = true;
    if (opts?.opacity !== undefined) m.opacity = opts.opacity;
    return m as any;
  }
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness: opts?.roughness ?? 0.85,
    metalness: opts?.metalness ?? 0.0,
  });
  (m as any).envMapIntensity = opts?.envMapIntensity ?? 0.25;
  if (opts?.aoMap) (m as any).aoMap = opts.aoMap;
  if (opts?.aoMapIntensity !== undefined) (m as any).aoMapIntensity = opts.aoMapIntensity;
  if (opts?.normalScale !== undefined) {
    const v = opts.normalScale;
    (m as any).normalScale = v instanceof THREE.Vector2 ? v : new THREE.Vector2(v as number, v as number);
  }
  if (opts?.map) (m as any).map = opts.map;
  if (opts?.roughnessMap) (m as any).roughnessMap = opts.roughnessMap;
  if (opts?.normalMap) (m as any).normalMap = opts.normalMap;
  if (opts?.emissive !== undefined) (m as any).emissive = new THREE.Color(opts.emissive as any);
  if (opts?.emissiveIntensity !== undefined) (m as any).emissiveIntensity = opts.emissiveIntensity;
  if (opts?.transparent) m.transparent = true;
  if (opts?.opacity !== undefined) m.opacity = opts.opacity;
  if (opts?.side !== undefined) m.side = opts.side;
  return m;
}

// Grid + texel density helpers
const GRID = 0.03125; // 1/32 unit grid for precise pixel placements
const TEXELS_PER_UNIT = 32; // 32px per 1 world unit
const snap = (n: number, g = GRID) => Math.round(n / g) * g;
const snapV3 = (v: THREE.Vector3, g = GRID) => v.set(snap(v.x, g), snap(v.y, g), snap(v.z, g));

// Pixel sign + one interactive hanging card
type PixelCard = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  targetScale: number;
  baseScale: number;
  baseY: number;
  hover: boolean;
  rotatePhase: number;
  front: THREE.CanvasTexture;
  back: THREE.CanvasTexture;
  showingFront: boolean;
  floatOffset: number;
  pivot?: THREE.Group; // for swinging from sign
  stringLine?: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  // typewriter state
  frontCanvas: HTMLCanvasElement;
  frontCtx: CanvasRenderingContext2D;
  textLines: string[];
  paragraph: string;
  typedCount: number;
  lastTypeUpdate: number;
  typewriterSpeed: number;
  textStartY: number;
  lineH: number;
  pad: number;
  title: string;
  accent: string;
  subAccent: string;
  W: number;
  H: number;
  // scrolling state
  linesVisible: number;
  scrollIndex: number; // -1 means auto-follow (stick to bottom as it types)
  // floating stickers
  stickerOrbit?: THREE.Group;
  stickers?: Array<{ sprite: THREE.Sprite; r: number; speed: number; phase: number; z: number; bob: number; }>;
};
const cards: PixelCard[] = [];

// Optional ambient audio (starts on first click anywhere)
let rainAudio: HTMLAudioElement | null = null;
// Typewriter audio via WebAudio (more reliable rapid playback). Fallback to <audio> pool if needed.
let audioCtx: AudioContext | null = null;
let typeBuffer: AudioBuffer | null = null;
let typeGain: GainNode | null = null;
let htmlTypePool: HTMLAudioElement[] = [];
let htmlTypeIdx = 0;
let lastTypeSound = 0;
let audioArmed = false;
let wheelHandler: ((e: WheelEvent) => void) | null = null;

const handleResize = () => {
  if (!container.value) return;
  const cw = container.value.clientWidth || window.innerWidth;
  const ch = container.value.clientHeight || window.innerHeight;
  const aspect = cw / ch;
  // If ortho camera, update its bounds; else, update aspect
  const anyCam: any = camera as any;
  if (anyCam && anyCam.isOrthographicCamera) {
    const viewHeight = 8; // world units tall to frame wall and floor
    const viewWidth = viewHeight * aspect;
    anyCam.left = -viewWidth / 2;
    anyCam.right = viewWidth / 2;
    anyCam.top = viewHeight / 2;
    anyCam.bottom = -viewHeight / 2;
    anyCam.updateProjectionMatrix();
  } else if (anyCam && anyCam.isPerspectiveCamera) {
    anyCam.aspect = aspect;
    anyCam.updateProjectionMatrix();
  }
  renderer.setSize(cw, ch);
  // resize composer
  if (composer) composer.setSize(cw, ch);
  // resize SSAO if present
  if (composer && (composer as any)._ssao && typeof (composer as any)._ssao.setSize === 'function') {
    (composer as any)._ssao.setSize(cw, ch);
  }
  // update pixelate resolution
  if (pixelatePass && (pixelatePass as any).uniforms && (pixelatePass as any).uniforms.resolution) {
    (pixelatePass as any).uniforms.resolution.value.set(cw, ch);
  }
  // update pixel target to maintain chunky resolution
  if (target) {
    const w = Math.max(1, Math.floor(cw / pixelScale));
    const h = Math.max(1, Math.floor(ch / pixelScale));
    target.setSize(w, h);
  }
};

const onPointerMove = (event: PointerEvent) => {
  if (!container.value) return;
  const rect = container.value.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  mouse.set(x * 2 - 1, -(y * 2 - 1));
};

const onClick = () => {
  // Enable ambient rain on first interaction
  if (!audioArmed) {
    audioArmed = true;
    try {
      rainAudio = new Audio('/rain.mp3');
      rainAudio.loop = true;
      rainAudio.volume = 0.15;
      rainAudio.play().catch(() => {/* ignore */});
      // Prepare WebAudio typewriter sample
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      fetch('/press.wav')
        .then(r => r.arrayBuffer())
        .then(ab => audioCtx!.decodeAudioData(ab))
        .then(buf => {
          typeBuffer = buf;
          typeGain = audioCtx!.createGain();
          typeGain.gain.value = 0.35;
          typeGain.connect(audioCtx!.destination);
        })
        .catch(() => {
          // Fallback: small HTMLAudio pool for overlapping clicks
          htmlTypePool = new Array(6).fill(0).map(() => { const a = new Audio('/press.wav'); a.volume = 0.35; return a; });
        });
    } catch (e) {}
  }
  // Gentle bounce for hovered card
  const first = raycaster.intersectObjects(cards.map(c => c.mesh))[0];
  if (first) {
    const card = cards.find(c => c.mesh === first.object);
    if (card) card.targetScale = card.baseScale * 1.2;
  }
};

onMounted(() => {
  if (!container.value) return;

  // Scene with cozy lamp-lit vibe
  scene = new THREE.Scene();
  console.log('[ThreeScene] build tag v4');
  scene.background = new THREE.Color(0x26221f);
  // Keep fog off for clarity; can re-enable later for depth
  scene.fog = null as any;

  // Camera — Perspective per spec
  const setPerspectiveCamera = () => {
    const cw = container.value!.clientWidth || window.innerWidth;
    const ch = container.value!.clientHeight || window.innerHeight;
    const aspect = cw / ch;
    const persp = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    persp.position.set(0, 2.2, 9);
    // Spec look target
    persp.lookAt(new THREE.Vector3(0, 1.8, 0));
    camera = persp;
  };
  setPerspectiveCamera();
  
  console.log('Camera init', camera.position.toArray());
  // overlay camera renders crisp UI layer (1)
  if (useOverlayLayers) {
    overlayCam = (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).clone() as any;
    if (overlayCam) overlayCam.layers.set(1);
    worldCam = (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).clone() as any;
    if (worldCam) worldCam.layers.set(0);
  }

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  // For pixel art, keep device pixel ratio at 1 so we control resolution ourselves
  renderer.setPixelRatio(1);
  renderer.setSize(container.value.clientWidth || window.innerWidth, container.value.clientHeight || window.innerHeight);
  container.value.appendChild(renderer.domElement);
  console.log('Renderer size', container.value.clientWidth, container.value.clientHeight);
  // Soft PCF shadows for cozy look
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // More realistic energy conservation
  try { (renderer as any).physicallyCorrectLights = true; } catch {}
  // Color & Tone per spec
  try { (renderer as any).toneMapping = (THREE as any).ACESFilmicToneMapping; } catch {}
  try { (renderer as any).outputColorSpace = (THREE as any).SRGBColorSpace; } catch {}
  if ((renderer as any).outputColorSpace === undefined && (THREE as any).sRGBEncoding) {
    (renderer as any).outputEncoding = (THREE as any).sRGBEncoding;
  }
  // Exposure tuned for PBR + IBL
  try { (renderer as any).toneMappingExposure = 0.85; } catch {}

  // RectAreaLight setup
  try { RectAreaLightUniformsLib.init(); } catch {}

  // Simple environment lighting for better PBR response
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    const rt = pmrem.fromScene(env as any, 0.04);
    scene.environment = rt.texture as any;
  } catch {}

  // Utility: enforce pixel-nearest filtering for textures
  const applyNearest = (tex?: THREE.Texture | null) => {
    if (!tex) return;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
  };

  // SPEC: Architecture, Lighting, and Vignettes per Final Technical Specification
  const buildSpecCafe = () => {
    // Lights
    const amb = new THREE.AmbientLight('#FFDDA1', 0.8);
    scene.add(amb);
    const key = new THREE.DirectionalLight('#FFFAE1', 1.5);
    key.position.set(5, 5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 20;
    (key.shadow.camera as any).left = -10; (key.shadow.camera as any).right = 10;
    (key.shadow.camera as any).top = 10; (key.shadow.camera as any).bottom = -10;
    key.shadow.bias = -0.001;
    scene.add(key);

    const addAccent = (x: number, y: number, z: number) => {
      const p = new THREE.PointLight('#FFDDA1', 1.0, 3.0);
      p.position.set(x, y, z);
      p.castShadow = false;
      scene.add(p);
    };
    for (let i = -3; i <= 3; i++) addAccent(i * 1.0, 5.2, 2.2);

    // Materials
    const matBack = new THREE.MeshStandardMaterial({ color: '#2E4035' });
    const matFloor = new THREE.MeshStandardMaterial({ color: '#A0522D' });
    const matWood = new THREE.MeshStandardMaterial({ color: '#D2B48C' });

    const setShadows = (m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; };

    // Back Wall
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), matBack);
    backWall.position.set(0, 3, -0.05);
    setShadows(backWall);
    scene.add(backWall);

    // Floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), matFloor);
    floor.position.set(0, 0, 4);
    floor.rotation.x = -Math.PI / 2;
    setShadows(floor);
    scene.add(floor);

    // Main Counter
    const counter = new THREE.Mesh(new THREE.BoxGeometry(8, 1.8, 2), matWood);
    counter.position.set(0, 0.9, 2.5);
    setShadows(counter);
    scene.add(counter);

    // Top Shelf
    const topShelf = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 1), matWood);
    topShelf.position.set(0, 4.5, 0.5);
    setShadows(topShelf);
    scene.add(topShelf);

    // Bottom Shelf
    const bottomShelf = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 1), matWood);
    bottomShelf.position.set(0, 3.5, 0.5);
    setShadows(bottomShelf);
    scene.add(bottomShelf);

    // Vignette 1: Book Nook on bottom shelf (left)
    const shelfY = 3.5 + 0.1 / 2; // top surface of bottom shelf
    const bookDepth = 0.05;
    const bookMat = new THREE.MeshStandardMaterial({ color: '#c9a06e' });
    const stackX = -3.0; const stackZ = 1.0;
    const heights = [0.26, 0.28, 0.25, 0.30, 0.27] as const;
    const b0: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, heights[0], bookDepth), bookMat);
    const b1: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, heights[1], bookDepth), bookMat);
    const b2: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, heights[2], bookDepth), bookMat);
    const b3: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, heights[3], bookDepth), bookMat);
    const b4: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, heights[4], bookDepth), bookMat);
    [b0, b1, b2, b3, b4].forEach(setShadows);
    // three stacked
    b0.position.set(stackX - 0.08, shelfY + heights[0] / 2, stackZ);
    b1.position.set(stackX,        shelfY + heights[1] / 2, stackZ);
    b2.position.set(stackX + 0.08, shelfY + heights[2] / 2, stackZ);
    // two leaning
    b3.position.set(stackX + 0.18, shelfY + heights[3] / 2, stackZ);
    b3.rotation.z = -0.12;
    b4.position.set(stackX - 0.18, shelfY + heights[4] / 2, stackZ);
    b4.rotation.z = 0.1;
    [b0, b1, b2, b3, b4].forEach(b => scene.add(b));

    // plant on top of the stack (center book)
    const potH = 0.1, potR = 0.05;
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(potR, potR, potH, 12), new THREE.MeshStandardMaterial({ color: '#8c5f3d' }));
    setShadows(pot);
  pot.position.set(stackX, shelfY + heights[1] + potH / 2, stackZ);
    scene.add(pot);

    // Vignette 2: Coffee Station on the counter
    const counterTopY = 0.9 + 1.8 / 2; // 1.8
    const espresso = new THREE.Group();
    const espBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: '#777777' }));
    setShadows(espBase);
    espBase.position.set(0, 0.25, 0);
    espresso.add(espBase);
    espresso.position.set(-2.5, 1.8, 2.2);
    scene.add(espresso);

    // Row of 3 mugs, neatly aligned
    const mugMat = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    const mugGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12);
    const mugZ = 2.8;
    for (let i = 0; i < 3; i++) {
      const mug = new THREE.Mesh(mugGeo, mugMat);
      setShadows(mug);
      mug.position.set(-1.6 + i * 0.14, counterTopY + 0.12 / 2, mugZ);
      scene.add(mug);
    }
  };

  // Post-processing is disabled in SPEC_MODE

  // Pixel-art post: render to a low-res target and upscale with NEAREST
  const setupPixelPipeline = () => {
    const vw = container.value!.clientWidth || window.innerWidth;
    const vh = container.value!.clientHeight || window.innerHeight;
    const w = Math.max(1, Math.floor(vw / pixelScale));
    const h = Math.max(1, Math.floor(vh / pixelScale));
    target = new THREE.WebGLRenderTarget(w, h, {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // Ensure the target texture stays in linear color space when sampled by post passes
    try {
      const LinearSRGB = (THREE as any).LinearSRGBColorSpace;
      const Linear = (THREE as any).LinearEncoding;
      if ((target.texture as any).colorSpace !== undefined && LinearSRGB) {
        (target.texture as any).colorSpace = LinearSRGB;
      } else if ((target.texture as any).encoding !== undefined && Linear) {
        (target.texture as any).encoding = Linear;
      }
    } catch {}
    // Fullscreen quad scene
    screenScene = new THREE.Scene();
    screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const plane = new THREE.PlaneGeometry(2, 2);
  // Important: this quad is showing an already-tonemapped scene texture.
  // Disable toneMapping on the material to avoid double mapping which darkens the image.
  const mat = new THREE.MeshBasicMaterial({ map: target.texture, toneMapped: false, depthTest: false, depthWrite: false });
    screenQuad = new THREE.Mesh(plane, mat);
    screenScene.add(screenQuad);
  };
  if (SPEC_MODE) {
    usePixelPipeline = false;
  } else {
    setupPixelPipeline();
  }
  if (!usePixelPipeline) {
    // If not using pixel pass, dispose target to save memory
    target?.dispose(); target = null; screenScene = null; screenCam = null; screenQuad = null;
  }
  // Initialize composer depending on pipeline choice
  const buildComposer = () => {
    composer?.dispose?.();
    if (!usePost) { composer = null; return; }
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera as any));
    try {
      const ssao = new SSAOPass(scene as any, camera as any, renderer.domElement.width, renderer.domElement.height);
      (ssao as any).kernelRadius = 8;
      (ssao as any).minDistance = 0.001;
      (ssao as any).maxDistance = 0.25;
      composer.addPass(ssao);
      (composer as any)._ssao = ssao;
    } catch {}
    bloomPass = new UnrealBloomPass(new THREE.Vector2(renderer.domElement.width, renderer.domElement.height), 0.07, 0.5, 0.88);
    composer.addPass(bloomPass);
    vignettePass = new ShaderPass(VignetteShader);
    (vignettePass as any).uniforms["offset"].value = 1.0;
    (vignettePass as any).uniforms["darkness"].value = 0.45;
    composer.addPass(vignettePass);
    const NoiseShader = {
      uniforms: { tDiffuse: { value: null }, time: { value: 0.0 }, amount: { value: 0.02 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; uniform float time; uniform float amount; float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); } void main(){ vec4 base = texture2D(tDiffuse, vUv); float n = rand(vUv * (time*60.0) + time) - 0.5; base.rgb += n * amount; gl_FragColor = base; }`,
    } as const;
    noisePass = new ShaderPass(NoiseShader as any);
    composer.addPass(noisePass);

    // Pixelate shader pass (final) to keep chunky look with post
    const PixelateShader = {
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        pixelSize: { value: pixelScale },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float pixelSize; varying vec2 vUv; void main(){ vec2 dxy = pixelSize / resolution; vec2 coord = dxy * floor(vUv / dxy); gl_FragColor = texture2D(tDiffuse, coord); }`,
    } as const;
    pixelatePass = new ShaderPass(PixelateShader as any);
    // set initial resolution
    const w = renderer.domElement.width || 1; const h = renderer.domElement.height || 1;
    (pixelatePass as any).uniforms.resolution.value.set(w, h);
    composer.addPass(pixelatePass);
  };
  buildComposer();
  // (no debug helpers)
  // Defer one more resize to catch first layout
  requestAnimationFrame(() => handleResize());

  // Lighting rig per spec
  const amb = new THREE.AmbientLight(new THREE.Color('#FFD19A'), 0.32); amb.layers.set(0); scene.add(amb);
  // Soft sky/ground fill to ensure StandardMaterial always reads some light
  const hemi = new THREE.HemisphereLight(new THREE.Color('#ffeac4'), new THREE.Color('#3a2b1f'), 0.12);
  hemi.layers.set(0); scene.add(hemi);
  const key = new THREE.DirectionalLight(new THREE.Color('#FFF0D8'), 1.6);
  key.position.set(2.2, 6.0, 1.2);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 20;
  key.shadow.camera.left = -10; key.shadow.camera.right = 10; key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
  (key.shadow as any).radius = 4.0; // soft, blurry-edged shadows like real diffusion
  key.shadow.bias = -0.0002;
  (key.shadow as any).normalBias = 0.03;
  key.layers.set(0); scene.add(key);

  // Gentle floor fill via a broad area light for soft grazing highlights (no harsh hotspot)
  let floorArea: any = null;
  try { floorArea = new (THREE as any).RectAreaLight('#ffe0b0', 0.08, 5.8, 1.0); } catch {}
  if (floorArea) {
    floorArea.position.set(0, 0.6, 4.0);
    floorArea.lookAt(0, 0.0, 2.4);
    floorArea.layers.set(0);
    floorArea.castShadow = false;
    scene.add(floorArea);
  }

  // Optional sprite vignette removed; handled in post-processing

  // --- Pixel/Toon helpers --------------------------------------------------
  function makeStepGradientTexture(steps = 4) {
    const w = 256, h = 1;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < steps; i++) {
      const x0 = Math.floor((i / steps) * w);
      const x1 = Math.floor(((i + 1) / steps) * w);
      const g = Math.floor(((i + 0.5) / steps) * 255);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  function makeToon(color: number, steps = 4, emissive = 0x000000) {
    const gradient = makeStepGradientTexture(steps);
    const mat = new THREE.MeshToonMaterial({ color, gradientMap: gradient, dithering: true });
    mat.emissive = new THREE.Color(emissive);
    mat.emissiveIntensity = 0.15;
    return mat;
  }

  function makePixelNoiseTexture(baseA: string, baseB: string, w = 256, h = 256, cell = 6) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const t = Math.random() * 0.9 + 0.1;
        // mix between the two input colors
        const c = new THREE.Color(baseA).lerp(new THREE.Color(baseB), t);
        const r = Math.floor(c.r * 255), g = Math.floor(c.g * 255), b = Math.floor(c.b * 255);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, cell, cell);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    return tex;
  }

  // Wall panel texture: draw subtle panel grid lines (1px) over a warm base
  function makeWallPanelTexture(widthUnits: number, heightUnits: number, cols = 10, rows = 6) {
    const W = Math.max(1, Math.floor(widthUnits * TEXELS_PER_UNIT));
    const H = Math.max(1, Math.floor(heightUnits * TEXELS_PER_UNIT));
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  // Base wall tone with subtle noise (lightened so the back wall is visible in darker scenes)
  const base = makePixelNoiseTexture('#3d5b4f', '#355045', W, H, 2);
    ctx.drawImage((base.image as HTMLCanvasElement), 0, 0);
    // Grid lines
    ctx.fillStyle = 'rgba(20,12,6,0.5)';
    // verticals
    for (let c = 0; c <= cols; c++) {
      const x = Math.floor((c / cols) * W);
      ctx.fillRect(x, 0, 1, H);
    }
    // horizontals
    for (let r = 0; r <= rows; r++) {
      const y = Math.floor((r / rows) * H);
      ctx.fillRect(0, y, W, 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    try { (tex as any).colorSpace = (THREE as any).SRGBColorSpace ?? (tex as any).colorSpace; } catch {}
    if (!(tex as any).colorSpace && (THREE as any).sRGBEncoding) { (tex as any).encoding = (THREE as any).sRGBEncoding; }
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  // Floor planks: 32px plank height with 1px separators
  function makeFloorPlanksTexture(widthUnits: number, heightUnits: number, plankPx = 32, seamPx = 2) {
    const W = Math.max(1, Math.floor(widthUnits * TEXELS_PER_UNIT));
    const H = Math.max(1, Math.floor(heightUnits * TEXELS_PER_UNIT));
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  // wood base noise (matches PALETTE.coffee / sienna)
  const base = makePixelNoiseTexture('#ab6136', '#8c4b28', W, H, 2);
    ctx.drawImage((base.image as HTMLCanvasElement), 0, 0);
    // horizontal seams every plankPx with seamPx thickness
  ctx.fillStyle = 'rgba(20,12,6,0.85)';
    for (let y = 0; y <= H; y += plankPx) ctx.fillRect(0, Math.max(0, y - Math.floor(seamPx / 2)), W, seamPx);
    const tex = new THREE.CanvasTexture(canvas);
    try { (tex as any).colorSpace = (THREE as any).SRGBColorSpace ?? (tex as any).colorSpace; } catch {}
    if (!(tex as any).colorSpace && (THREE as any).sRGBEncoding) { (tex as any).encoding = (THREE as any).sRGBEncoding; }
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  // Texel density helper: 32 px per world unit
  function makeTexelTextureForPlane(widthUnits: number, heightUnits: number, baseA: string, baseB: string) {
    const W = Math.max(1, Math.floor(widthUnits * TEXELS_PER_UNIT));
    const H = Math.max(1, Math.floor(heightUnits * TEXELS_PER_UNIT));
    const t = makePixelNoiseTexture(baseA, baseB, W, H, 1);
    try { (t as any).colorSpace = (THREE as any).SRGBColorSpace ?? (t as any).colorSpace; } catch {}
    if (!(t as any).colorSpace && (THREE as any).sRGBEncoding) { (t as any).encoding = (THREE as any).sRGBEncoding; }
    return t;
  }
  function makeRoughnessMap(widthUnits: number, heightUnits: number, base = 0.8) {
    const W = Math.max(1, Math.floor(widthUnits * TEXELS_PER_UNIT));
    const H = Math.max(1, Math.floor(heightUnits * TEXELS_PER_UNIT));
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    // mostly light gray with a few darker splotches
    ctx.fillStyle = `rgb(${Math.floor(base*255)},${Math.floor(base*255)},${Math.floor(base*255)})`;
    ctx.fillRect(0,0,W,H);
    for (let i=0;i<Math.max(1, Math.floor((W*H)/4000));i++){
      const rx = Math.floor(Math.random()*W); const ry = Math.floor(Math.random()*H);
      const rw = Math.floor(3+Math.random()*7); const rh = Math.floor(3+Math.random()*7);
      const v = Math.max(0, base - 0.3 - Math.random()*0.2);
      const g = Math.floor(v*255); ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(rx, ry, rw, rh);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    return tex;
  }
  // Counter wood texture: 192x48 px pattern scaled to requested size
  function makeCounterWoodTexture(widthUnits: number, depthUnits: number) {
    const W = Math.max(1, Math.floor(widthUnits * TEXELS_PER_UNIT));
    const H = Math.max(1, Math.floor(depthUnits * TEXELS_PER_UNIT));
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    // base
    ctx.fillStyle = '#D2B48C';
    ctx.fillRect(0,0,W,H);
    // subtle noise
    for (let y=0;y<H;y++){
      for (let x=0;x<W;x++){
        if ((x+y)%13===0) {
          const a = 0.06 + (x%7)/100;
          ctx.fillStyle = `rgba(0,0,0,${a})`;
          ctx.fillRect(x,y,1,1);
        }
      }
    }
    // darker grain lines
    ctx.fillStyle = '#C1A37C';
    for (let y=4; y<H; y+=6) {
      for (let x=0; x<W; x+=1) {
        if (Math.random() < 0.6) ctx.fillRect(x, y + Math.floor(Math.sin(x*0.05)*1), 1, 1);
      }
    }
    // light highlight band near front edge
    const bandH = Math.max(1, Math.floor(H*0.18));
    for (let y=0; y<bandH; y++){
      const t = y / bandH;
      const a = 0.12 * (1 - t);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(0, y, W, 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    return tex;
  }
  function makeCounterWoodNormal(widthUnits:number, depthUnits:number){
    const W = Math.max(1, Math.floor(widthUnits * TEXELS_PER_UNIT));
    const H = Math.max(1, Math.floor(depthUnits * TEXELS_PER_UNIT));
    const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d')!; x.imageSmoothingEnabled=false;
    // Subtle vertical normal stripes
    for(let y=0;y<H;y++){
      for(let w=0; w<W; w++){
        const stripe = (w%12)<6; const r = 128 + (stripe?10:-10); x.fillStyle=`rgb(${r},128,255)`; x.fillRect(w,y,1,1);
      }
    }
    const t=new THREE.CanvasTexture(c); t.minFilter=THREE.NearestFilter; t.magFilter=THREE.NearestFilter; t.generateMipmaps=false; return t;
  }
  function makeAOTexture(widthUnits:number, heightUnits:number, edgeDark=0.22){
    const W = Math.max(1, Math.floor(widthUnits * TEXELS_PER_UNIT));
    const H = Math.max(1, Math.floor(heightUnits * TEXELS_PER_UNIT));
    const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d')!; x.imageSmoothingEnabled=false;
    // Start flat light gray (AO white is 1.0, we paint darker near borders)
    x.fillStyle = 'rgb(255,255,255)'; x.fillRect(0,0,W,H);
    // Darken near top/bottom edges for slight cavity; left/right slightly less
    for(let y=0;y<H;y++){
      const ty = Math.min(1, y/Math.max(1,H*0.12));
      const by = Math.min(1, (H-1-y)/Math.max(1,H*0.18));
      const v = 1 - edgeDark * Math.max(ty, by);
      x.fillStyle = `rgb(${Math.floor(255*v)},${Math.floor(255*v)},${Math.floor(255*v)})`;
      x.fillRect(0,y,W,1);
    }
    const t=new THREE.CanvasTexture(c); t.minFilter=THREE.NearestFilter; t.magFilter=THREE.NearestFilter; t.generateMipmaps=false; t.wrapS=THREE.ClampToEdgeWrapping; t.wrapT=THREE.ClampToEdgeWrapping; return t;
  }
  function makePixelNormalMap(widthUnits: number, heightUnits: number, strength = 0.08, verticalStripes = true) {
    const W = Math.max(1, Math.floor(widthUnits * TEXELS_PER_UNIT));
    const H = Math.max(1, Math.floor(heightUnits * TEXELS_PER_UNIT));
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    // neutral normal is (128,128,255)
    const neutral = {r:128,g:128,b:255};
    const amp = Math.floor(128*strength);
    for (let y=0;y<H;y++){
      for (let x=0;x<W;x++){
        const stripe = verticalStripes ? (x%8<4) : (y%8<4);
        const r = Math.max(0, Math.min(255, neutral.r + (stripe? amp:-amp)));
        const g = neutral.g;
        const b = neutral.b;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x,y,1,1);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    return tex;
  }

  function addEnvironment() {
    // Back Wall — Plane(10,6) at (0,3,-0.05)
    const wallTex = makeWallPanelTexture(10, 6, 10, 6);
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 6),
  makeStandard('#3f5f51', { map: wallTex, roughness: 0.66, metalness: 0.0, side: THREE.DoubleSide })
    );
    wall.position.set(0, 3, -0.05);
    wall.castShadow = true; wall.receiveShadow = true; wall.layers.set(0);
    scene.add(wall);

    // Safety backdrop (unlit) in case lighting/post crushes values
    const wallBackdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(10.2, 6.2),
  new THREE.MeshBasicMaterial({ color: '#436b5c', toneMapped: false })
    );
    wallBackdrop.position.set(0, 3, -0.06);
    wallBackdrop.layers.set(0);
    scene.add(wallBackdrop);

    // Floor — Plane(10,8) at (0,0,4), rotation.x = -PI/2
    const floorTex = makeFloorPlanksTexture(10, 8, 32, 1);
    const floorRough = makeRoughnessMap(10, 8, 0.78);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 8),
  makeStandard('#A0522D', { map: floorTex, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide, roughnessMap: floorRough })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 4);
    floor.castShadow = true; floor.receiveShadow = true; floor.layers.set(0);
    scene.add(floor);

    // Main Counter — Box(8,1.5,2) at (0,0.75,2.5)
    const woodColor = makeCounterWoodTexture(8, 2);
    const woodNormal = makeCounterWoodNormal(8, 2);
    const counterAO = makeAOTexture(8, 1.5, 0.18);
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(8, 1.5, 2),
  makeStandard('#D2B48C', { map: woodColor, roughness: 0.7, metalness: 0.0, normalMap: woodNormal, normalScale: 0.65, aoMap: counterAO, aoMapIntensity: 0.6 })
    );
    counter.position.set(0, 0.75, 2.5);
    counter.castShadow = true; counter.receiveShadow = true; counter.layers.set(0);
    // AO requires uv2; copy uv to uv2 for simple mapping
    const g = counter.geometry as THREE.BufferGeometry;
    const uv = g.getAttribute('uv');
    if (uv) {
      g.setAttribute('uv2', new THREE.BufferAttribute((uv.array as Float32Array).slice(0), 2));
    }
    scene.add(counter);

    // Subtle countertop overhang lip to cast a small shadow and add contour
    const lip = new THREE.Mesh(new THREE.BoxGeometry(8.06, 0.05, 2.08), makeStandard('#D2B48C', { roughness: 0.75 }));
    lip.position.set(0, 0.75 + 0.78 + 0.02, 2.5);
    lip.castShadow = true; lip.receiveShadow = true; lip.layers.set(0);
    scene.add(lip);

    // Counter lip contact shadow strip
    const lipShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(8.05, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false })
    );
    lipShadow.rotation.x = -Math.PI/2;
    lipShadow.position.set(0, 0.002, 3.3);
    scene.add(lipShadow);

    // Engraved "hayden park" text veneer on the front face (left-aligned)
    const frontWood = makeCounterWoodTexture(8, 1.5);
    try {
      const cv = frontWood.image as HTMLCanvasElement; const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = false;
      const pad = Math.floor(0.22 * TEXELS_PER_UNIT); // a bit tighter left padding
      const centerY = Math.floor(cv.height * 0.38);   // higher on the counter face
      // Base engraved text style using elegant serif
      ctx.font = `${Math.floor(0.45 * TEXELS_PER_UNIT)}px "Georgia", "Times New Roman", serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  // Soft vertical darkening behind text to simulate recessed grain shadow
  const grd = ctx.createLinearGradient(0, centerY - Math.floor(0.22*TEXELS_PER_UNIT), 0, centerY + Math.floor(0.22*TEXELS_PER_UNIT));
  grd.addColorStop(0, 'rgba(0,0,0,0.05)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.08)');
  grd.addColorStop(1, 'rgba(0,0,0,0.05)');
  const textWidth = Math.floor(cv.width * 0.45);
  ctx.fillStyle = grd; ctx.fillRect(pad - 4, centerY - Math.floor(0.28*TEXELS_PER_UNIT), textWidth, Math.floor(0.56*TEXELS_PER_UNIT));
  // Light bevel (upper-left) then darker inner to simulate carved recess (subtler)
      ctx.fillStyle = 'rgba(255,240,210,0.10)'; ctx.fillText('hayden park', pad - 1, centerY - 1);
      ctx.fillStyle = 'rgba(40,26,14,0.55)';  ctx.fillText('hayden park', pad, centerY);
      // Soft inner shadow pass to deepen the carve
      ctx.fillStyle = 'rgba(0,0,0,0.07)';    ctx.fillText('hayden park', pad + 1, centerY + 1);
      (frontWood as any).needsUpdate = true;
    } catch {}
    const veneer = new THREE.Mesh(
      new THREE.PlaneGeometry(8.02, 1.52),
      makeStandard('#D2B48C', { map: frontWood, roughness: 0.68, metalness: 0.0 })
    );
    veneer.position.set(0, 0.75, 2.5 + 1.0 + 0.001); // flush to counter front with tiny epsilon to avoid z-fight
    veneer.castShadow = false; veneer.receiveShadow = true; veneer.layers.set(0);
    scene.add(veneer);

    // Subtle contact shadow plane under counter (multiply blend feel)
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(8.5, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(0, 0.001, 3.0);
    scene.add(contact);

    // Darker cozy strip in front of counter to reduce brightness spill on floor
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 0.8),
      new THREE.MeshBasicMaterial({ color: 0x1a1510, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false })
    );
    strip.rotation.x = -Math.PI/2;
    strip.position.set(0, 0.001, 4.0);
    scene.add(strip);

    // Small warm additive light strip accent for coziness (subtle colored glow)
    const cozyStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 0.22),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb07a'), transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    cozyStrip.rotation.x = -Math.PI/2;
    cozyStrip.position.set(0, 0.002, 3.78);
    scene.add(cozyStrip);

    // Hanging stars under the counter lip for cozy decor
    const starsGroup = new THREE.Group();
    const starMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#ffd28a'), emissive: new THREE.Color('#ffcc77'), emissiveIntensity: 0.8, roughness: 0.6, metalness: 0.0 });
  const makeStarShape = () => {
      // simple 2D star profile extruded by tiny depth
      const shape = new THREE.Shape();
      const r1 = 0.06, r2 = 0.025; const spikes = 5;
      for (let i=0;i<spikes*2;i++){
        const a = (i / (spikes*2)) * Math.PI * 2 - Math.PI/2;
        const r = (i % 2 === 0) ? r1 : r2;
        const x = Math.cos(a) * r; const y = Math.sin(a) * r;
        if (i===0) shape.moveTo(x,y); else shape.lineTo(x,y);
      }
      shape.closePath();
      return new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
    };
    const starGeo = makeStarShape();
    const cords: THREE.Mesh[] = [];
    const positions = [-0.6, 0.0, 0.6];
    positions.forEach((px, i) => {
      // cord
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,0.28 + i*0.06, 6), makeStandard('#3a2b1f', { roughness: 1.0 }));
      cord.position.set(px, 0.75 + 0.78 - (0.14 + i*0.03), 2.5 + 1.02);
      starsGroup.add(cord); cords.push(cord);
      // star
      const star = new THREE.Mesh(starGeo, starMat.clone());
      star.position.set(px, cord.position.y - (0.16 + i*0.06), 2.5 + 1.03);
      star.rotation.z = (i-1) * 0.12;
  star.castShadow = true; star.receiveShadow = false;
      starsGroup.add(star);
    });
    scene.add(starsGroup);
  }

  function addGarlandLights() {
    // Build a sagging curve across the wall top
    const left = new THREE.Vector3(snap(-5.0), snap(5.6), snap(0.05));
    const right = new THREE.Vector3(snap(5.0), snap(5.6), snap(0.05));
    const mid = new THREE.Vector3(0, snap(5.2), snap(0.05)); // more sag like ref
    const curve = new THREE.CatmullRomCurve3([left, mid, right]);
    // Wire as a thin tube
    const wireGeo = new THREE.TubeGeometry(curve, 64, 0.01, 6, false);
    const wireMat = makeStandard('#3a2a20', { roughness: 0.9, metalness: 0.0 });
    const wire = new THREE.Mesh(wireGeo, wireMat);
    wire.castShadow = false; wire.receiveShadow = false; wire.layers.set(0); scene.add(wire);

    // Place bulbs along the curve with point lights
    garlandBulbs = [];
    garlandSprites = []; // keep for animation compatibility
  const bulbGeom = new THREE.BoxGeometry(0.10, 0.10, 0.10);
  const bulbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#FFDDA1'), emissive: new THREE.Color('#FFDDA1'), emissiveIntensity: 1.0, roughness: 0.45, metalness: 0.0 });
  const bulbs = 16;
    for (let i = 0; i < bulbs; i++) {
      const t = i / (bulbs - 1);
      const p = curve.getPoint(t);
      snapV3(p);
      const bulb = new THREE.Mesh(bulbGeom, bulbMat.clone());
      bulb.position.copy(p);
      bulb.castShadow = false; bulb.receiveShadow = false; bulb.layers.set(0);
      scene.add(bulb);
  const light = new THREE.PointLight('#FFDDA1', 0.4, 3.0, 2.0);
  light.castShadow = false;
      light.position.copy(p).add(new THREE.Vector3(0, 0, 0.02));
      scene.add(light);
      garlandBulbs.push({ mesh: bulb, light, phase: Math.random() * Math.PI * 2 });
    }
  }

  // Lower garland string (mid height) for layered coziness
  function addLowerGarlandLights() {
    const left = new THREE.Vector3(-4.6, 3.1, 0.02);
    const right = new THREE.Vector3(4.6, 3.1, 0.02);
    const mid = new THREE.Vector3(0, 2.75, 0.02);
    const curve = new THREE.CatmullRomCurve3([left, mid, right]);
    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 64, 0.01, 6, false),
      makeStandard('#3a2a20', { roughness: 0.9, metalness: 0.0 })
    );
    wire.castShadow = false; wire.receiveShadow = false; scene.add(wire);
  const bulbGeom = new THREE.BoxGeometry(0.10, 0.10, 0.10);
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const p = curve.getPoint(t);
  const bulb = new THREE.Mesh(bulbGeom, new THREE.MeshStandardMaterial({ color: '#FFDDA1', emissive: '#FFDDA1', emissiveIntensity: 0.9, roughness: 0.45 }));
      bulb.position.copy(p); scene.add(bulb);
  const light = new THREE.PointLight('#FFDDA1', 0.38, 3.0, 2.0);
  light.castShadow = false;
      light.position.copy(p).add(new THREE.Vector3(0,0,0.02)); scene.add(light);
      garlandBulbs.push({ mesh: bulb, light, phase: Math.random()*Math.PI*2 });
    }
  }

  // Large warm additive plane to simulate left-side glow/haze
  function addLeftGlow() {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFDDA1'), transparent: true, opacity: 0.03, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat);
    plane.position.set(-5.6, 3.0, 1.6);
    plane.rotation.y = -Math.PI / 2.2; // face toward scene from the left
    plane.castShadow = false; plane.receiveShadow = false; plane.layers.set(0);
    scene.add(plane);
  }

  // Foreground tables for depth (placed at far left/right edges so they don't block the center)
  function addTablesForeground() {
    const makeBlockTable = (x: number, z: number) => {
      const g = new THREE.Group();
      const woodTop = makeStandard('#cdaA7d', { roughness: 0.82 });
      const woodDark = makeStandard('#8B5E3C', { roughness: 0.9 });
      // square top
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), woodTop);
      top.position.set(0, 1.02, 0);
      // four block legs
      const legGeo = new THREE.BoxGeometry(0.08, 0.96, 0.08);
      const legOffsets = [
        [ 0.36, 0,  0.36],
        [-0.36, 0,  0.36],
        [ 0.36, 0, -0.36],
        [-0.36, 0, -0.36]
      ];
      const legs = legOffsets.map(([lx, , lz]) => { const m = new THREE.Mesh(legGeo, woodDark); m.position.set(lx as number, 0.52, lz as number); return m; });
      // simple block chair on one side
      const chair = (cx: number, cz: number, facing: number) => {
        const c = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.5), woodTop); seat.position.set(0, 0.56, 0);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.06), woodDark); back.position.set(0, 0.86, -0.22);
        const legG = new THREE.BoxGeometry(0.06, 0.52, 0.06);
        const cl: THREE.Mesh[] = [
          new THREE.Mesh(legG, woodDark), new THREE.Mesh(legG, woodDark),
          new THREE.Mesh(legG, woodDark), new THREE.Mesh(legG, woodDark)
        ];
        cl[0]!.position.set( 0.26, 0.28,  0.2);
        cl[1]!.position.set(-0.26, 0.28,  0.2);
        cl[2]!.position.set( 0.26, 0.28, -0.2);
        cl[3]!.position.set(-0.26, 0.28, -0.2);
        c.add(seat, back, ...cl);
        c.position.set(cx, 0, cz);
        c.rotation.y = facing;
        return c;
      };
      const c1 = chair( 0, 0.65, Math.PI);
      const c2 = chair( 0, -0.65, 0);
      // laptop + mug
      const laptop = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.015, 0.18), makeStandard('#6e7680', { roughness: 0.6 })); laptop.position.set(-0.18, 1.05, -0.06);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 0.01), makeStandard('#99a3ad', { roughness: 0.9 })); screen.position.set(-0.18, 1.14, -0.16);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.13,8), makeStandard('#e7dfd6', { roughness: 0.9 })); mug.position.set(0.18, 1.095, 0.06);
  [top, laptop, screen, mug, ...legs, c1, c2].forEach(m => { (m as any).castShadow = true; (m as any).receiveShadow = false; });
      g.add(top, ...legs, c1, c2, laptop, screen, mug);
      g.position.set(x, 0, z);
      g.layers.set(0);
      scene.add(g);
    };

  makeBlockTable(-3.2, 5.4);
  makeBlockTable( 3.2, 5.2);
  }

  // Bar stools in front of the counter for depth and scale
  function addBarStools() {
    const seatMat = makeStandard('#c9a27a', { roughness: 0.8, metalness: 0.0 });
    const metalMat = makeStandard('#6b6870', { roughness: 0.4, metalness: 0.55 });
    const makeStool = (x: number, z: number) => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 18), seatMat);
      seat.position.set(0, 0.92, 0);
      const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8);
      const mkLeg = (lx: number, lz: number) => {
        const leg = new THREE.Mesh(legGeo, metalMat);
        leg.position.set(lx, 0.46, lz);
        return leg;
      };
      const l = 0.18;
      const leg1 = mkLeg( l, 0); const leg2 = mkLeg(-l, 0); const leg3 = mkLeg(0,  l); const leg4 = mkLeg(0, -l);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 8, 20), metalMat);
      ring.rotation.x = Math.PI/2; ring.position.set(0, 0.4, 0);
  ;[seat, leg1, leg2, leg3, leg4, ring].forEach(m => { m.castShadow = true; m.receiveShadow = false; });
      g.add(leg1, leg2, leg3, leg4, ring, seat);
      g.position.set(x, 0, z);
      g.layers.set(0);
      scene.add(g);
    };
    // Place 4 stools evenly spaced in front of the counter
    makeStool(-2.4, 3.15);
    makeStool(-0.8, 3.15);
    makeStool(0.8, 3.15);
    makeStool(2.4, 3.12);
  }

  // Small counter items (napkin holder, sugar jar, milk jug)
  function addCounterDetails() {
    const wood = makeStandard('#d2b48c', { roughness: 0.8 });
    const metal = makeStandard('#7a7f86', { roughness: 0.35, metalness: 0.6 });
    const white = makeStandard('#e7dfd6', { roughness: 0.9 });
    // Napkin holder
    const holder = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.08), wood);
    holder.position.set(-0.2, 0.86, 2.7);
    // A stack of napkins
    const nap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.07), white);
    nap.position.set(-0.2, 0.9, 2.7);
    // Sugar jar
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 12), white);
    jar.position.set(0.15, 0.88, 2.65);
    const lid = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.05, 12), metal);
    lid.position.set(0.15, 0.97, 2.65);
    // Milk jug
    const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 12), metal);
    jug.position.set(-0.55, 0.88, 2.6);
    ;[holder, nap, jar, lid, jug].forEach(m => { m.castShadow = false; m.receiveShadow = false; });
    scene.add(holder, nap, jar, lid, jug);

    // Cozy lava lamp
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.10,0.06,14), makeStandard('#6b6870', { roughness: 0.4, metalness: 0.5 }));
    const glass = new THREE.MeshPhysicalMaterial({ color: '#ffd1a6', roughness: 0.05, transmission: 0.9, thickness: 0.12, transparent: true, opacity: 1, ior: 1.45 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), new THREE.MeshStandardMaterial({ color: '#ffbe73', emissive: '#ffb15e', emissiveIntensity: 0.9, roughness: 0.6 }));
    const shell = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 16), glass);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.04,14), makeStandard('#6b6870', { roughness: 0.4, metalness: 0.5 }));
    const lamp = new THREE.Group();
    shell.position.y = 0.2; bulb.position.y = 0.16; cap.position.y = 0.38;
    lamp.add(base, shell, bulb, cap);
    lamp.position.set(1.1, 0.89, 2.55);
    lamp.traverse(o=>{ (o as any).castShadow = false; (o as any).receiveShadow = false; });
    ;(scene as any)._lavaLamp = bulb.material as THREE.MeshStandardMaterial;
    scene.add(lamp);
  }

  // Baseboard trim along the bottom of the wall
  function addBaseboard() {
    const base = new THREE.Mesh(new THREE.BoxGeometry(10.1, 0.08, 0.08), makeStandard('#bfa380', { roughness: 0.85 }));
    base.position.set(0, 0.04, 0.04);
    base.castShadow = false; base.receiveShadow = false; base.layers.set(0);
    scene.add(base);
  }

  // Foreground rug to add warmth and anchor the scene
  function addRug() {
    const W = 2.6, H = 1.2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(W * TEXELS_PER_UNIT); canvas.height = Math.floor(H * TEXELS_PER_UNIT);
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    // simple stripes pattern
    ctx.fillStyle = '#6e3b2a'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#a86d4f';
    for (let y=0; y<canvas.height; y+=8) ctx.fillRect(0, y, canvas.width, 4);
    const tex = new THREE.CanvasTexture(canvas); tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    rug.rotation.x = -Math.PI/2;
    rug.position.set(-2.2, 0.002, 5.6);
    rug.castShadow = false; rug.receiveShadow = false; rug.layers.set(0);
    scene.add(rug);
  }

  // Trailing plant on the top shelf for organic detail
  function addTrailingPlant() {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.14, 10), makeStandard('#d8c6b8', { roughness: 0.9 }));
    pot.position.set(1.8, 4.62, 0.52);
    const leafMat = makeStandard('#9fc388', { roughness: 0.85 });
    const chain: THREE.Mesh[] = [];
    let last = new THREE.Vector3(1.8, 4.72, 0.52);
    for (let i=0;i<10;i++){
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), leafMat);
      last = last.clone().add(new THREE.Vector3(0.1 * (Math.random()*0.8+0.6), -0.14 * (Math.random()*0.8+0.6), 0.02 * (Math.random()-0.5)));
      s.position.copy(last);
      chain.push(s);
    }
    chain.forEach(m => { (m as any).castShadow = false; (m as any).receiveShadow = false; });
    scene.add(pot, ...chain);
  }

  // Large right plant in a woven basket on the counter
  function addRightBigPlant() {
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.38, 18), makeStandard('#b9946a', { roughness: 0.9 }));
    basket.position.set(3.35, 0.95, 2.55);
    const leafMat = makeStandard('#aecd96', { roughness: 0.85 });
    const spheres: THREE.Mesh[] = [];
    const centers = [
      new THREE.Vector3(3.15, 1.25, 2.45),
      new THREE.Vector3(3.45, 1.35, 2.35),
      new THREE.Vector3(3.55, 1.15, 2.65),
      new THREE.Vector3(3.25, 1.05, 2.75)
    ];
    centers.forEach((c, i) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.3 + (i%2)*0.06, 12, 12), leafMat);
      s.position.copy(c); spheres.push(s);
    });
    ;[basket, ...spheres].forEach(o => { (o as any).castShadow = false; (o as any).receiveShadow = false; });
    scene.add(basket, ...spheres);
  }

  // A large leaning frame behind the top-right shelf
  function addLeaningFrameTopRight() {
    const w = 1.6, h = 1.9, d = 0.06;
    const border = makeStandard('#6b4a2f', { roughness: 0.85 });
    const tex = makeTexelTextureForPlane(w*16, h*16, '#e7d1b6', '#caa885');
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w*0.92, h*0.92), new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0 }));
  const outer = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), border);
  const g = new THREE.Group();
  art.position.set(0,0,0.031); // push art in front so it isn't occluded by border
  g.add(outer, art);
    g.position.set(4.0, 4.1, 0.35);
    g.rotation.z = -0.02; g.rotation.x = 0.04;
    scene.add(g);
  }

  // Small wall clock
  function addWallClock() {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), makeStandard('#6b4a2f', { roughness: 0.8 }));
    rim.position.set(-4.5, 4.6, 0.06);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24), makeStandard('#f5f0e6', { roughness: 1.0 }));
    face.position.set(-4.5, 4.6, 0.07);
    // hands
    const handMat = makeStandard('#3a2b1f', { roughness: 1.0 });
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.01), handMat);
    h.position.set(-4.5, 4.64, 0.08);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.16, 0.01), handMat);
    m.position.set(-4.5, 4.6, 0.08);
    ;[rim, face, h, m].forEach(o => { (o as any).castShadow = false; (o as any).receiveShadow = false; });
    scene.add(rim, face, h, m);
  }

  // Hanging plants on the left side
  function addHangingPlantsLeft() {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 8, 16, Math.PI*1.2), makeStandard('#2a2320', { roughness: 1.0 }));
    hook.position.set(-4.6, 5.3, 0.05);
    hook.rotation.z = Math.PI/2;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01,0.01,0.4,8), makeStandard('#2a2320', { roughness: 1.0 }));
    cord.position.set(-4.6, 5.0, 0.05);
    const pot = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.2, 12), makeStandard('#b08a66', { roughness: 0.85 }));
    pot.position.set(-4.6, 4.82, 0.05);
    const leafMat = makeStandard('#8fbe78', { roughness: 0.85 });
    const leaves: THREE.Mesh[] = [];
    let p = new THREE.Vector3(-4.6, 4.78, 0.05);
    for (let i=0;i<8;i++){
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), leafMat);
      p = p.clone().add(new THREE.Vector3(0.08*(Math.random()*0.8+0.6), -0.12*(Math.random()*0.8+0.6), 0.02*(Math.random()-0.5)));
      s.position.copy(p);
      leaves.push(s);
    }
    ;[hook, cord, pot, ...leaves].forEach(o => { (o as any).castShadow = false; (o as any).receiveShadow = false; });
    scene.add(hook, cord, pot, ...leaves);
  }

  // Barista tools near the espresso machine: kettle, tamper, portafilter
  function addBaristaTools() {
    const metal = makeStandard('#8e96a1', { roughness: 0.4, metalness: 0.6 });
    const wood = makeStandard('#8b5e3c', { roughness: 0.8 });
    // kettle
    const kettle = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 16), metal);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 10), metal); spout.rotation.z = Math.PI/6; spout.position.set(0.13, 0.02, 0.06);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 16), wood); handle.rotation.x = Math.PI/2; handle.position.set(-0.12, 0.02, 0);
    kettle.add(body, spout, handle); kettle.position.set(-2.0, 0.88, 2.6);
    ;[body, spout, handle].forEach(o => { (o as any).castShadow = false; (o as any).receiveShadow = false; });
    // tamper
    const tamper = new THREE.Group();
    const tHead = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), metal);
    const tHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.08, 12), wood); tHandle.position.y = 0.05;
    tamper.add(tHead, tHandle); tamper.position.set(-1.75, 0.88, 2.55);
    ;[tHead, tHandle].forEach(o => { (o as any).castShadow = false; (o as any).receiveShadow = false; });
    // portafilter
    const pf = new THREE.Group();
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), metal);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.05, 8), metal); neck.position.z = 0.04;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 12), wood); grip.position.z = 0.12;
    pf.add(basket, neck, grip); pf.position.set(-1.55, 0.88, 2.58);
    ;[basket, neck, grip].forEach(o => { (o as any).castShadow = false; (o as any).receiveShadow = false; });
    scene.add(kettle, tamper, pf);
  }

  // Pastry price card next to the case
  function addPastryPriceCard() {
    const W = 240, H = 160;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#23150f'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#f9e8c2'; ctx.font = '28px "Press Start 2P"';
    ctx.fillText('Cookie $2', 14, 42); ctx.fillText('Croiss $3', 14, 88);
    const tex = new THREE.CanvasTexture(canvas); tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), mat);
    card.position.set(1.55, 1.05, 2.45);
    scene.add(card);
  }

  // Coasters on tables
  function addTableCoasters() {
    const mat = makeStandard('#d9c6b5', { roughness: 0.9 });
    const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.01, 16), mat);
    c1.position.set(-3.8, 1.03, 6.15);
    const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.01, 16), mat);
    c2.position.set(3.8, 1.03, 5.95);
    ;[c1, c2].forEach(o => { (o as any).castShadow = false; (o as any).receiveShadow = false; });
    scene.add(c1, c2);
  }

  // Right-side warm glow to balance the left
  function addRightGlow() {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFEDC4'), transparent: true, opacity: 0.025, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), mat);
    plane.position.set(5.4, 3.0, 1.2);
    plane.rotation.y = Math.PI / 2.4;
    scene.add(plane);
  }

  // Pendant lamp with a soft rect-area light (no shadows) for cozy highlight
  function addPendantLamp() {
    const lamp = new THREE.Group();
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.7, 8), makeStandard('#2a2320', { roughness: 1.0 }));
    cord.position.set(0, 5.2, 1.4);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.3, 18), makeStandard('#3d2b1f', { roughness: 0.7 }));
    shade.position.set(0, 4.95, 1.4);
    shade.rotation.x = Math.PI; // open bottom
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 14), new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: new THREE.Color('#ffdca7'), emissiveIntensity: 1.2, roughness: 0.5 }));
    bulb.position.set(0, 4.88, 1.4);
    ;[cord, shade, bulb].forEach(m => { (m as any).castShadow = false; (m as any).receiveShadow = false; });
    lamp.add(cord, shade, bulb);
    // RectAreaLight for soft spread on the counter
  const area = new (THREE as any).RectAreaLight('#ffecc2', 0.9, 1.2, 0.6);
    if (area) {
      area.position.set(0.0, 4.8, 1.4);
      area.lookAt(0, 1.2, 2.6);
      area.layers.set(0);
      (area as any).castShadow = false;
      lamp.add(area);
    }
    scene.add(lamp);
  }

  // Back-bar shelf with simple bottles
  function addBackBarShelfAndBottles() {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.08, 0.25), makeStandard('#b99267', { roughness: 0.85 }));
    shelf.position.set(0, 2.25, 0.45);
    shelf.castShadow = false; shelf.receiveShadow = false; shelf.layers.set(0);
    scene.add(shelf);
    // Populate naturally with mugs, mini frames, books, and a small plant cluster
    const shelfTopY = shelf.position.y + 0.04; // top surface of the shelf
    // Helper: proper mug with rim, handle, and inner disk illusion
    const makeMug = (x:number, z:number, color:string, scale=1.0) => {
      const g = new THREE.Group();
      const h = 0.15 * scale; const r = 0.085 * scale;
      const mat = makeStandard(color, { roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18), mat);
      // rim and inner
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r*0.96, 0.008*scale, 8, 16), mat);
      rim.rotation.x = Math.PI/2; rim.position.y = h/2 - 0.002;
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(r*0.86, r*0.86, 0.004, 16), makeStandard('#3a2b1f', { roughness: 1.0 }));
      inner.position.y = h/2 - 0.006;
      const handle = new THREE.Mesh(new THREE.TorusGeometry(r*0.85, 0.012*scale, 8, 14, Math.PI*1.15), mat);
      handle.rotation.y = Math.PI/2; handle.position.set(r*0.95, 0, 0);
      g.add(body, rim, inner, handle);
      g.position.set(x, shelfTopY + h/2, z + (Math.random()*0.02-0.01));
      g.traverse(o => { (o as any).castShadow = true; (o as any).receiveShadow = false; (o as any).layers?.set?.(0); });
      scene.add(g);
    };

    // Helper: mini leaning frame that sits on shelf
    const makeMiniFrame = (x:number, w=0.46, h=0.34) => {
      const depth = 0.04;
      const borderMat = makeStandard('#6b4a2f', { roughness: 0.85 });
      const artTex = makeTexelTextureForPlane(w*16, h*16, '#d8e7f0', '#a2bfd3');
      const art = new THREE.Mesh(new THREE.PlaneGeometry(w*0.9, h*0.9), new THREE.MeshStandardMaterial({ map: artTex, roughness: 1.0 }));
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), borderMat);
      const g = new THREE.Group(); art.position.set(0,0,0.021); g.add(frame, art);
      g.position.set(x, shelfTopY + h/2 + 0.005, 0.49);
      g.rotation.x = -0.12; // lean against the wall
      g.rotation.z = (Math.random()*0.08 - 0.04);
      g.traverse(o => { (o as any).castShadow = true; (o as any).receiveShadow = false; });
      scene.add(g);
    };

    // Helper: thin books cluster, slightly leaning
    const makeBook = (x:number, height:number, color:string, tilt=0) => {
      const w = 0.10, d = 0.08; const h = height;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeStandard(color, { roughness: 0.9 }));
      b.position.set(x, shelfTopY + h/2, 0.45);
      b.rotation.z = tilt;
      b.castShadow = true; b.receiveShadow = false; scene.add(b);
    };

    // Helper: tiny terracotta pot plant
    const makeTinyPlant = (x:number, s=1.0) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07*s, 0.09*s, 0.10*s, 10), makeStandard('#b4845a', { roughness: 0.9 }));
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.11*s, 12, 12), makeStandard('#9fc388', { roughness: 0.85 }));
      pot.position.set(x, shelfTopY + 0.05*s, 0.45);
      top.position.set(x, shelfTopY + 0.16*s, 0.45);
      ;[pot, top].forEach(m => { m.castShadow = true; m.receiveShadow = false; });
      scene.add(pot, top);
    };

    // Row of mugs with natural jitter and varied colors/sizes
    const xs = [-3.2, -2.55, -1.85, -1.1, -0.4, 0.3, 1.05, 1.85, 2.55, 3.25];
    const mugColors = ['#e7dfd6','#d9c6b5','#c7d6b3','#a9c7e4','#f0c2c2','#f5e1a8','#cbb7e8','#bcd8ee'];
    xs.forEach((x,i)=>{
      const px = x + (Math.random()*0.08-0.04);
      makeMug(px, 0.45, mugColors[i % mugColors.length]!, 0.92 + Math.random()*0.15);
      const decal = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }));
      decal.rotation.x = -Math.PI/2; decal.position.set(px, shelfTopY + 0.001, 0.45); scene.add(decal);
    });

    // Leaning frames tucked between mugs
    makeMiniFrame(-1.55, 0.44, 0.32);
    makeMiniFrame( 0.95, 0.40, 0.30);

    // Small leaning book trio
    makeBook(-0.75, 0.22, '#48a0d1',  0.08);
    makeBook(-0.62, 0.26, '#ffd871', -0.04);
    makeBook(-0.49, 0.24, '#e37d5a',  0.02);

    // Plant cluster of three on the right
    [2.35,2.55,2.78].forEach((px,idx)=>{
      const s = idx === 1 ? 1.05 : (idx===0?0.95:0.9);
      makeTinyPlant(px, s);
      const decal = new THREE.Mesh(new THREE.CircleGeometry(0.1*s, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }));
      decal.rotation.x = -Math.PI/2; decal.position.set(px, shelfTopY + 0.001, 0.45); scene.add(decal);
    });
  }

  // Extra frames cluster for richness
  function addExtraFrames() {
    const makeFrame = (px: number, py: number, w=0.8, h=0.8, a='#e4d4bd', b='#baa78e') => {
      const depth = 0.05;
      const borderMat = makeStandard('#6b4a2f', { roughness: 0.85 });
      const artTex = makeTexelTextureForPlane(w*16, h*16, a, b);
      const art = new THREE.Mesh(new THREE.PlaneGeometry(w*0.9, h*0.9), new THREE.MeshStandardMaterial({ map: artTex, roughness: 1.0 }));
      const outer = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), borderMat);
      const g = new THREE.Group();
      art.position.set(0,0,0.001); g.add(outer, art);
      g.position.set(snap(px), snap(py), snap(0.042));
      g.rotation.z = (Math.random()*0.06 - 0.03);
      scene.add(g);
    };
    // Lift frames so they sit between shelves rather than intersecting them
    const cluster = [
      {x:-3.1,y:4.15,w:0.85,h:0.85,a:'#d8e7f0',b:'#a2bfd3'},
      {x:-2.6,y:3.85,w:0.72,h:0.72,a:'#f2e2cf',b:'#d1bfa7'},
      {x:-1.0,y:4.05,w:0.78,h:0.78,a:'#e3f0e6',b:'#b7cfbe'},
      {x: 2.6,y:3.85,w:0.72,h:0.72,a:'#f0d9d1',b:'#caa6a1'},
    ];
    cluster.forEach(f => makeFrame(f.x, f.y, f.w, f.h, f.a, f.b));
  }

  // Faint contact shadow quads under stools and tables
  function addContactShadows() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false });
    const drop = (x:number,z:number, r=0.6, s=1.0) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), mat);
      m.rotation.x = -Math.PI/2; m.position.set(x, 0.001, z); m.scale.setScalar(s);
      scene.add(m);
    };
    // Under bar stools
    drop(-2.4, 3.15, 0.35, 1.0);
    drop(-0.8, 3.15, 0.35, 1.0);
    drop( 0.8, 3.15, 0.35, 1.0);
    drop( 2.4, 3.12, 0.35, 1.0);
    // Under foreground tables
    drop(-3.9, 6.2, 0.45, 1.1);
    drop( 3.9, 6.0, 0.45, 1.1);
  }

  // Small chalk doodle near the menu board
  function addChalkDoodle() {
    const W = 220, H = 160;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = '#f9e8c2'; ctx.lineWidth = 6;
    // simple latte mug + swirl
    ctx.beginPath(); ctx.arc(80, 90, 38, Math.PI*0.1, Math.PI*1.8); ctx.stroke();
    ctx.beginPath(); ctx.arc(120, 90, 22, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(78, 88, 18, Math.PI*0.1, Math.PI*1.7); ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas); tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), mat);
    plane.position.set(3.0, 1.2, 0.08);
    scene.add(plane);
  }

  function addShelvesAndDecor() {
  const shelfMat = new THREE.MeshStandardMaterial({ color: '#D2B48C', roughness: 0.85, metalness: 0.0 });
    const topShelf = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 1), shelfMat);
    topShelf.position.set(0, 4.5, 0.5); topShelf.castShadow = true; topShelf.receiveShadow = true; topShelf.layers.set(0); scene.add(topShelf);
    const bottomShelf = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 1), shelfMat);
    bottomShelf.position.set(0, 3.5, 0.5); bottomShelf.castShadow = true; bottomShelf.receiveShadow = true; bottomShelf.layers.set(0); scene.add(bottomShelf);

    // Brackets and wall shadow strips to anchor shelves
    const bracketMat = makeStandard('#5a4632', { roughness: 0.9 });
    const addBrackets = (y:number) => {
      const xs = [-3.6,-1.2,1.2,3.6];
      xs.forEach(px => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.12), bracketMat);
        b.position.set(px, y - 0.18, 0.44);
        b.castShadow = false; b.receiveShadow = false; scene.add(b);
      });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(7.9, 0.16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false }));
  strip.position.set(0, y - 0.13, 0.42); strip.rotation.z = 0; scene.add(strip);
    };
    addBrackets(topShelf.position.y);
    addBrackets(bottomShelf.position.y);

    // Minimal decor on shelves
    const book = (x:number,y:number,h:number,c:string, tilt=0)=>{
      // y is shelf y; place book resting on top
      const height = h; const width = 0.09 + (Math.random()*0.05 - 0.02); const depth = 0.08 + (Math.random()*0.03 - 0.01);
      const mat = makeStandard(c, { roughness: 0.9, metalness: 0.0 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
      b.position.set(x, y + 0.05 + height/2, 0.45);
      b.rotation.z = tilt;
      b.castShadow = true; b.receiveShadow = true; b.layers.set(0); scene.add(b);
      // subtle spine highlight strip
      const spine = new THREE.Mesh(new THREE.BoxGeometry(width*0.92, 0.02, depth*0.98), makeStandard('#e7dfd6', { roughness: 1.0 }));
      spine.position.set(x, y + 0.05 + height - 0.01, 0.451);
      scene.add(spine);
    };
    const tinyCactus = (x:number,y:number)=>{
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(snap(0.08), snap(0.1), snap(0.12), 8), makeStandard(PALETTE.chalk, { roughness: 0.9 }));
      const a = new THREE.Mesh(new THREE.SphereGeometry(snap(0.13), 10, 10), makeStandard('#9fc388', { roughness: 0.85 }));
      pot.position.set(snap(x), snap(y + 0.14), snap(0.02));
      a.position.set(snap(x), snap(y + 0.32), snap(0.02));
      pot.castShadow = true; pot.receiveShadow = true; (a as any).castShadow = true; (a as any).receiveShadow = true; pot.layers.set(0); (a as any).layers.set(0); scene.add(pot, a);
    };
    book(-2.8, 4.5, 0.6, '#4fb5d9', 0.03); book(-2.6, 4.5, 0.54, '#ffe05e', -0.02); tinyCactus(-1.9, 4.5);
    book(-2.8, 3.5, 0.5, '#7a5bd9', -0.01); tinyCactus(-1.9, 3.5);
    // Extra items to match reference density
    book(-0.2, 4.5, 0.62, '#e37d5a', 0.04); book(0.0, 4.5, 0.58, '#48a0d1', -0.03); book(0.2, 4.5, 0.66, '#ffd871', 0.02);
    tinyCactus(0.6, 4.5);
    book(0.4, 3.5, 0.52, '#9b6bd9', -0.02); book(0.6, 3.5, 0.56, '#67d9a4', 0.03); tinyCactus(1.0, 3.5);

    // Under-shelf cubbies with supports to avoid floating look (beneath bottom shelf)
    const addCubbies = () => {
      const yTop = bottomShelf.position.y - 0.05; // underside of shelf
      const cubies: Array<{x:number; w:number; h:number; d:number;}> = [
        { x: -1.2, w: 0.9, h: 0.5, d: 0.4 },
        { x:  0.0, w: 0.9, h: 0.6, d: 0.4 },
        { x:  1.6, w: 1.2, h: 0.5, d: 0.4 },
      ];
      const cubMat = makeStandard('#6b4a2f', { roughness: 0.85 });
      cubies.forEach((c)=>{
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), cubMat);
        box.position.set(0, -c.h/2 - 0.15, 0);
        const support = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.08), cubMat);
        support.position.set(-c.w/2 + 0.12, -0.05, 0.18);
        const support2 = support.clone(); support2.position.x = c.w/2 - 0.12;
        g.add(box, support, support2);
        g.position.set(c.x, yTop, 0.45);
        scene.add(g);
      });
    };
    addCubbies();
    // Small cozy extras
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,0.14,12), makeStandard('#d8d3c8', { roughness: 0.92 })); jar.position.set(-0.8, 4.58, 0.5); scene.add(jar);
    const cameraBox = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.16,0.18), makeStandard('#2f2a28', { roughness: 0.7 })); cameraBox.position.set(1.6, 4.56, 0.5); scene.add(cameraBox);
    const smallPlantPot = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.12,0.12,10), makeStandard('#c4ad8c', { roughness: 0.88 }));
    const smallPlantTop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), makeStandard('#a9c88a', { roughness: 0.86 }));
    smallPlantPot.position.set(2.0, 4.54, 0.5); smallPlantTop.position.set(2.0, 4.7, 0.5); scene.add(smallPlantPot, smallPlantTop);
  }

  function addFramesAndMenu() {
    // Menu board per spec
    const cx = 3, cy = 2, cz = 0;
    const menuBox = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.1), new THREE.MeshStandardMaterial({ color: '#36454F', roughness: 0.85 }));
    menuBox.position.set(cx, cy, cz);
    menuBox.castShadow = true; menuBox.receiveShadow = true; scene.add(menuBox);

    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640;
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#23150f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f9e8c2'; ctx.font = '40px "Press Start 2P"'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('Caffu', 40, 36);
  ctx.font = '28px "Press Start 2P"';
  const lines = ['Latte   4$', 'Crepe   4$', 'Capfle  4$', 'Mentorn 4$', 'Chai    4$', 'Cookie  2$'];
  lines.forEach((t, i) => { const jx = Math.floor(Math.random()*2-1), jy = Math.floor(Math.random()*2-1); ctx.fillText(t, 40 + jx, 120 + i * 64 + jy); });
    const tex = new THREE.CanvasTexture(canvas); tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false;

  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  front.position.set(cx, cy, cz + 0.06);
    scene.add(front);
  // Removed glow/area light to strictly match spec

    // Framed pictures set: two small frames to the left of the menu
    function addFrame(px: number, py: number, w=0.9, h=0.9, artA='#e6d7bd', artB='#cdb389'){
      const depth = 0.05;
      const frame = new THREE.Group();
      const borderMat = makeStandard(PALETTE.oakDark, { roughness: 0.85 });
      const artTex = makeTexelTextureForPlane(w*16, h*16, artA, artB);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w*0.9, h*0.9), new THREE.MeshStandardMaterial({ map: artTex, roughness: 1.0, metalness: 0.0 }));
  art.position.set(0,0,0.03); // ensure art sits in front of frame borders
      const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), borderMat);
      frame.add(frameOuter);
      frame.add(art);
      frame.position.set(snap(px), snap(py), snap(0.04));
      frame.rotation.z = (Math.random()*0.06 - 0.03);
      scene.add(frame);
    }
    addFrame(0.8, 3.8, 1.0, 1.0);
    addFrame(1.5, 2.8, 0.9, 0.9, '#dfeee3', '#b2cbbf');
    const framesR = [
      {x: -0.6, y: 3.9, w: 0.9, h: 0.9, a: '#e7d1b6', b:'#caa885'},
      {x: -1.2, y: 2.8, w: 0.85, h: 0.85, a: '#cfe3d7', b:'#9fbeb0'},
      {x: -2.1, y: 3.2, w: 0.9, h: 0.9, a: '#f0d6c2', b:'#c5a186'},
      {x: 2.1, y: 3.2, w: 0.9, h: 0.9, a: '#d3e2f7', b:'#a6c1e3'},
    ];
    framesR.forEach(f=> addFrame(f.x, f.y, f.w, f.h, f.a, f.b));
  }

  function addCoffeeStation() {
    // Mug with steam at (-1.0, 1.5625, 2.8)
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 12), makeStandard('#e7dfd6', { roughness: 0.85 }));
    mug.position.set(snap(-1.0), snap(1.5625), snap(2.8));
    mug.castShadow = true; mug.layers.set(0); scene.add(mug);

    const steamFrames: THREE.CanvasTexture[] = [];
    const makeSteamFrame = (w=8,h=16)=>{
      const c=document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d')!; x.imageSmoothingEnabled=false;
      x.clearRect(0,0,w,h);
      x.fillStyle='rgba(255,255,255,0.9)';
      const cols = 2 + Math.floor(Math.random()*2);
      for(let i=0;i<cols;i++){
        const ox = i*3 + Math.floor(Math.random()*2-1);
        for(let y=0;y<h;y+=2){
          const dx = Math.sin((y/8)+i)*1.0;
          x.fillRect(Math.max(0,Math.min(w-1, Math.floor(ox+dx))), h-1-y, 1, 1);
        }
      }
      const t=new THREE.CanvasTexture(c); t.minFilter=THREE.NearestFilter; t.magFilter=THREE.NearestFilter; t.generateMipmaps=false; return t;
    };
    for(let i=0;i<6;i++) steamFrames.push(makeSteamFrame());
  const steamMat = new THREE.SpriteMaterial({ map: steamFrames[0], transparent: true, depthWrite: false, opacity: 0.55, color: 0xffffff });
    const steam = new THREE.Sprite(steamMat);
  steam.scale.set(0.25, 0.52, 1);
  steam.position.set(mug.position.x, mug.position.y + 0.26, mug.position.z);
    scene.add(steam);
    (mug as any)._steam = { sprite: steam, frames: steamFrames, t: 0 };

    // Plant at (2.5, 1.625, 2.7)
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.24, 10), makeStandard('#d8c6b8', { roughness: 0.9 }));
    pot.position.set(snap(2.5), snap(1.625), snap(2.7));
  const leafMat = makeStandard('#bdd7c0', { roughness: 0.85 });
    const l1 = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), leafMat);
    const l2 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), leafMat);
    l1.position.set(pot.position.x + 0.0, pot.position.y + 0.22, pot.position.z);
    l2.position.set(pot.position.x + 0.16, pot.position.y + 0.32, pot.position.z - 0.06);
    pot.castShadow = true; (l1 as any).castShadow = true; (l2 as any).castShadow = true;
    scene.add(pot, l1, l2);

    // Espresso machine (reference-matched): matte-black, low profile, two amber indicators, shallow front tray
    const emGroup = new THREE.Group();
    const matteBlack = new THREE.MeshStandardMaterial({ color: 0x191817, metalness: 0.04, roughness: 0.95 });
    const darkPanel = new THREE.MeshStandardMaterial({ color: 0x22201e, metalness: 0.06, roughness: 0.92 });
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x2a2826, metalness: 0.1, roughness: 0.85 });

    // main block
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.28, 0.46), matteBlack);
    body.castShadow = true; body.receiveShadow = true; emGroup.add(body);
    // top lip for a subtle silhouette
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.03, 0.48), darkPanel);
    top.position.y = 0.155; top.castShadow = true; emGroup.add(top);
    // slightly inset front panel
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.02), darkPanel);
    face.position.set(0, 0.0, 0.225); emGroup.add(face);
    // two small indicator squares
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x332a24, emissive: new THREE.Color('#ffcd88'), emissiveIntensity: 2.2, roughness: 1.0, metalness: 0.0 });
    const ledL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), ledMat);
    ledL.position.set(-0.085, -0.02, 0.235); emGroup.add(ledL);
    const ledR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), ledMat);
    ledR.position.set( 0.085, -0.02, 0.235); emGroup.add(ledR);
    // tiny service slot on the left (dark rectangle)
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.01), new THREE.MeshStandardMaterial({ color: 0x0f0e0d, roughness: 1.0 }));
    slot.position.set(-0.32, -0.06, 0.235); emGroup.add(slot);
    // shallow drip tray protruding
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.14), trayMat);
    tray.position.set(0.0, -0.12, 0.19); emGroup.add(tray);

    // placement: sit on the counter with low profile
    // counter top is at y=1.5; body height is 0.28, so center at 1.5 + 0.14 = 1.64 rests on top
    emGroup.position.set(-2.5, 1.64, 2.2);
    emGroup.layers.set(0); scene.add(emGroup);

  // Pastry case (glass) on the right side of counter with inner shelves and more items
    const caseGroup = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.06, transmission: 0.98, thickness: 0.08, transparent: true, opacity: 1.0, ior: 1.45 });
  const cx = 1.0, cy = 1.5, cz = 2.2;
    const w = 1.2, h = 0.5, d = 0.6;
  // glass box (six planes) with visible frame
    const paneMat = glass;
    const mkPane = (sx:number, sy:number, sz:number, rx:number, ry:number, rz:number, px:number, py:number, pz:number, wx:number, wy:number)=>{
      const g = new THREE.PlaneGeometry(wx, wy);
      const m = new THREE.Mesh(g, paneMat);
      m.position.set(px, py, pz); m.rotation.set(rx, ry, rz);
      m.scale.set(sx, sy, sz); m.castShadow = false; m.receiveShadow = false; caseGroup.add(m);
    };
    // front/back/left/right/top
    mkPane(1,1,1, 0, 0, 0, 0, 0,  d/2, w, h);
    mkPane(1,1,1, 0, Math.PI, 0, 0, 0, -d/2, w, h);
    mkPane(1,1,1, 0, Math.PI/2, 0, -w/2, 0, 0, d, h);
    mkPane(1,1,1, 0,-Math.PI/2, 0,  w/2, 0, 0, d, h);
    mkPane(1,1,1,-Math.PI/2, 0, 0, 0,  h/2, 0, w, d);
    // base (wood) and top/border frame
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), makeStandard(PALETTE.oakLight, { roughness: 0.8 }));
    base.position.set(0, -h/2 - 0.02, 0); base.castShadow = true; base.receiveShadow = true; caseGroup.add(base);
    const frameMat = makeStandard('#bcb8b0', { roughness: 0.45, metalness: 0.3 });
    const bar = (bx:number,by:number,bz:number,bw:number,bh:number,bd:number)=>{
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd), frameMat); m.position.set(bx,by,bz); caseGroup.add(m);
    };
    // edges around glass
    bar( 0,  h/2-0.01, 0, w, 0.02, d);
    bar( 0, -h/2+0.01, 0, w, 0.02, d);
    bar(-w/2+0.01, 0, 0, 0.02, h, d);
    bar( w/2-0.01, 0, 0, 0.02, h, d);
    // inner shelves
    const shelf1 = new THREE.Mesh(new THREE.BoxGeometry(w*0.92, 0.02, d*0.9), makeStandard('#cbb497', { roughness: 0.9 }));
    shelf1.position.set(0, -0.12, 0); caseGroup.add(shelf1);
    const shelf2 = new THREE.Mesh(new THREE.BoxGeometry(w*0.92, 0.02, d*0.9), makeStandard('#cbb497', { roughness: 0.9 }));
    shelf2.position.set(0,  0.10, 0); caseGroup.add(shelf2);
    // pastries inside
    const donut = (x:number,y:number,c:string)=>{ const t=new THREE.Mesh(new THREE.TorusGeometry(0.09,0.035,8,16), makeStandard(c,{roughness:0.7})); t.position.set(x,y,0); t.castShadow = false; t.receiveShadow=false; caseGroup.add(t); };
    const cake = (x:number,y:number,c:string)=>{ const t=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.08,0.16), makeStandard(c,{roughness:0.8})); t.position.set(x,y,0); caseGroup.add(t); };
    const slice = (x:number,y:number,c:string)=>{ const t=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.06,0.12), makeStandard(c,{roughness:0.85})); t.position.set(x,y,0); caseGroup.add(t); };
    donut(-0.35, -0.20,'#d98566'); donut(-0.10, -0.20,'#c96f5b'); donut(0.15,-0.20,'#e3c59d'); donut(0.40,-0.20,'#9fc388');
    cake(-0.35, 0.02,'#f2a2b0'); slice(-0.05,0.02,'#ffd661'); cake(0.25,0.02,'#c9a27a'); slice(0.45,0.02,'#9fc388');
    donut(-0.35, 0.24,'#e3c59d'); slice(-0.05,0.24,'#d98566'); donut(0.25,0.24,'#c96f5b'); slice(0.45,0.24,'#ffd661');
    // a top cupcake
    const cupcakeBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.07,0.08,10), makeStandard('#d6a87a',{roughness:0.85})); cupcakeBase.position.set(-0.52, h/2-0.09, 0.0); caseGroup.add(cupcakeBase);
    const frosting = new THREE.Mesh(new THREE.SphereGeometry(0.07,12,12), makeStandard('#ff88a0',{roughness:0.7})); frosting.position.set(-0.52, h/2 - 0.01, 0.0); caseGroup.add(frosting);
  const interior = new THREE.PointLight('#ffe9b9', 0.5, 1.2, 1.8); interior.position.set(0, h/2 - 0.05, 0); interior.castShadow = false; caseGroup.add(interior);
    caseGroup.position.set(snap(cx), snap(cy), snap(cz));
    caseGroup.layers.set(0); scene.add(caseGroup);

    // Utensils and cups next to pastry case
    const cupMat = makeStandard('#e7dfd6', { roughness: 0.88 });
    const holderMat = makeStandard('#c9b39b', { roughness: 0.92 });
    for (let i=0;i<3;i++){
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.12,12), cupMat);
      cup.position.set(2.2 + i*0.14, 0.88, 2.4); cup.castShadow = true; scene.add(cup);
    }
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,0.25,16), holderMat); holder.position.set(2.6, 0.88, 2.4); holder.castShadow = true; scene.add(holder);
    for (let i=0;i<12;i++){
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.01,0.01,0.22,6), makeStandard('#9c7e5c', { roughness: 0.9 }));
      stick.position.set(2.6 + (Math.random()-0.5)*0.12, 1.0 + Math.random()*0.05, 2.4 + (Math.random()-0.5)*0.12);
      scene.add(stick);
    }
  }

  // Dust motes
  const dustGeometry = new THREE.BufferGeometry();
  const dustCount = 120;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustColors = new Float32Array(dustCount * 3);
  dustPhases = new Float32Array(dustCount);
  let sd = 12345; const rand = () => (sd = (sd * 1664525 + 1013904223) >>> 0, (sd & 0xffff) / 0xffff);
  for (let i = 0; i < dustCount * 3; i += 3) {
    dustPositions[i] = (rand() - 0.5) * 14;
    dustPositions[i + 1] = (rand() - 0.5) * 10;
    dustPositions[i + 2] = (rand() - 0.5) * 8;
  }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  // initialize colors and phases
  for (let i=0;i<dustCount;i++){ dustColors[i*3]=1; dustColors[i*3+1]=1; dustColors[i*3+2]=1; dustPhases[i]=Math.random()*Math.PI*2; }
  dustGeometry.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));
  const dustMaterial = new THREE.PointsMaterial({ color: 0xfffae1, size: 0.02, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, sizeAttenuation: true, vertexColors: true });
  dustParticles = new THREE.Points(dustGeometry, dustMaterial);
  dustParticles.layers.set(0); scene.add(dustParticles);

  // Helper: create a crisp pixel canvas texture card (front/back)
  function createPixelCardTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const scale = 2; // high DPI
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.scale(scale, scale);
    draw(ctx);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return { canvas, ctx, tex } as const;
  }

  // Neon sign built from canvas: crisp front + blurred glow back (additive)
  function makeNeonSign(text: string, opts?: { color?: string; glow?: string; width?: number; height?: number }) {
    const color = opts?.color ?? '#ff86b1';
    const glow = opts?.glow ?? '#ff5fa0';
    const logicalW = 1400, logicalH = 300;
    const canvas = document.createElement('canvas');
    canvas.width = logicalW; canvas.height = logicalH;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // draw crisp text
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0,0,logicalW,logicalH);
    ctx.font = '180px "Press Start 2P"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // outline
    ctx.lineWidth = 10; ctx.strokeStyle = '#2a1e34';
    ctx.strokeText(text, logicalW/2, logicalH/2 + 10);
    // neon body
    ctx.fillStyle = color;
    ctx.fillText(text, logicalW/2, logicalH/2 + 10);
    const frontTex = new THREE.CanvasTexture(canvas);
    frontTex.minFilter = THREE.LinearFilter; frontTex.magFilter = THREE.LinearFilter; frontTex.generateMipmaps = false;

    // glow canvas
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = logicalW; glowCanvas.height = logicalH;
    const gctx = glowCanvas.getContext('2d')!;
    gctx.imageSmoothingEnabled = true;
    gctx.filter = 'blur(12px)';
    gctx.drawImage(canvas, 0, 0);
    // tint glow
    gctx.globalCompositeOperation = 'source-in';
    gctx.fillStyle = glow; gctx.fillRect(0,0,logicalW,logicalH);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.minFilter = THREE.LinearFilter; glowTex.magFilter = THREE.LinearFilter; glowTex.generateMipmaps = false;

    const width = opts?.width ?? 6.5;
    const height = opts?.height ?? (width * logicalH / logicalW);
    const planeGeo = new THREE.PlaneGeometry(width, height);
    const frontMat = new THREE.MeshBasicMaterial({ map: frontTex, transparent: true, toneMapped: false });
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const front = new THREE.Mesh(planeGeo, frontMat);
    const back = new THREE.Mesh(planeGeo, glowMat);
    back.position.z = -0.02;
    const group = new THREE.Group();
    group.add(back);
    group.add(front);
    scene.add(group);
    return { group, width, height, frontMat, glowMat };
  }

  // Sprite vignette removed in favor of post-processing vignette

  function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Redraw the card's front canvas with current typed character count
  function redrawTypewriter(card: PixelCard, W: number, H: number) {
    const ctx = card.frontCtx;
    const pad = card.pad;
    // clear area below divider only (preserve background/title/border)
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad, card.textStartY - 4, W - pad * 2, H - card.textStartY - pad);
    ctx.clip();
    ctx.clearRect(pad, card.textStartY - 4, W - pad * 2, H - card.textStartY - pad);
    ctx.restore();

    ctx.font = '18px "Press Start 2P"';
    ctx.fillStyle = '#fff3fe';
    ctx.lineWidth = 2; ctx.strokeStyle = '#1d1524';

    // Construct a single string composed of lines separated by \n for typing per character
    const full = card.textLines.join('\n');
    const partial = full.slice(0, card.typedCount);
    const lines = partial.split('\n');

    // Determine visible window and starting index (auto-follow unless manually scrolled)
    const visible = card.linesVisible;
    const maxStart = Math.max(0, lines.length - visible);
    const start = card.scrollIndex < 0 ? maxStart : Math.min(Math.max(0, card.scrollIndex), maxStart);

    let y = card.textStartY;
    for (let i = 0; i < visible; i++) {
      const idx = start + i;
      const l = lines[idx];
      if (l === undefined) break;
      ctx.strokeText(l, pad, y);
      ctx.fillText(l, pad, y);
      y += card.lineH;
      if (y > H - pad) break;
    }

    // Tiny scroll indicator on the right edge
    if (lines.length > visible) {
      const trackX = W - pad - 6;
      const trackY = card.textStartY;
      const trackH = H - pad - trackY;
      ctx.fillStyle = '#3a2e47';
      ctx.fillRect(trackX, trackY, 3, trackH);
      const ratio = (start) / Math.max(1, lines.length - visible);
      const barH = Math.max(10, trackH * (visible / lines.length));
      const barY = trackY + (trackH - barH) * ratio;
      ctx.fillStyle = '#ffd28a';
      ctx.fillRect(trackX, barY, 3, barH);
    }

    card.front.needsUpdate = true;
  }

  // Wrap a long paragraph into pixel lines
  function wrapParagraph(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const next = current ? current + ' ' + w : w;
      if (ctx.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function makeCard(title: string, paragraph: string, accent: string, subAccent: string): PixelCard {
    const W = 560, H = 360;
    const pad = 16;
    // FRONT
    const frontGen = createPixelCardTexture(W, H, (ctx) => {
      // white bubble with soft shadow and speech-tail (bottom-left)
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 6;
      roundedRect(ctx, 0, 0, W, H, 22);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      // tail
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(pad * 2.2, H - pad * 0.9);
      ctx.lineTo(pad * 2.8, H - pad * 0.3);
      ctx.lineTo(pad * 3.0, H - pad * 1.1);
      ctx.closePath();
      ctx.fill();
      // border accent
      ctx.lineWidth = 6;
      ctx.strokeStyle = accent;
      roundedRect(ctx, 3, 3, W - 6, H - 6, 20);
      ctx.stroke();
      // title
      ctx.font = '28px "Press Start 2P"';
      ctx.fillStyle = '#3b2b20';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(title, pad, pad + 2);
      // divider
      ctx.fillStyle = subAccent;
      ctx.fillRect(pad, pad + 40, W - pad * 2, 4);
      // body drawn incrementally by typewriter
    });
    const front = frontGen.tex;

    // BACK
    const backGen = createPixelCardTexture(W, H, (ctx) => {
      ctx.fillStyle = '#ffffff';
      roundedRect(ctx, 0, 0, W, H, 22);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#e9cda3';
      roundedRect(ctx, 2, 2, W - 4, H - 4, 20);
      ctx.stroke();
      ctx.font = '18px "Press Start 2P"';
      ctx.fillStyle = '#7a5b3a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('click', W / 2, H / 2);
    });
    const back = backGen.tex;

    // Mesh as a shallow box for real 3D thickness
  const ratio = W / H;
  const HEIGHT = 1.9; // world units
  const WIDTH = HEIGHT * ratio;
  const DEPTH = 0.08;
  const geom = new THREE.BoxGeometry(WIDTH, HEIGHT, DEPTH);
  // 6-face materials: +X, -X, +Y, -Y, +Z (front), -Z (back)
  const sideMat = makeToon(0x6d5a7a, 4, 0x1b1224);
  const frontMat = new THREE.MeshBasicMaterial({ map: front, transparent: true, toneMapped: false });
  const backMat = new THREE.MeshBasicMaterial({ map: back, transparent: true, toneMapped: false });
  front.minFilter = THREE.NearestFilter; front.magFilter = THREE.NearestFilter; front.generateMipmaps = false;
  back.minFilter = THREE.NearestFilter; back.magFilter = THREE.NearestFilter; back.generateMipmaps = false;
  const mesh = new THREE.Mesh(geom, [sideMat, sideMat, sideMat, sideMat, frontMat, backMat]);

    const group = new THREE.Group();
    group.add(mesh);
  scene.add(group);
  // Put the card on overlay layer if enabled; otherwise keep on world layer
  if (useOverlayLayers) {
    group.traverse(o => { o.layers.set(1); });
  } else {
    group.traverse(o => { o.layers.set(0); });
  }

    // Floating stickers: orbiting sprites around the card in 3D space
    const loader = new THREE.TextureLoader();
    const stickers = ['/image.png','/image3.png','/image4.png'];
    const orbit = new THREE.Group();
    group.add(orbit);
    const stickerData: Array<{ sprite: THREE.Sprite; r: number; speed: number; phase: number; z: number; bob: number; }> = [];
    const baseR = Math.min(WIDTH, HEIGHT) * 0.65;
    stickers.forEach((p, i) => {
      const tex = loader.load(p, (t) => { t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; });
      const smat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const s = new THREE.Sprite(smat);
      s.center.set(0.5, 0.5);
      const sc = 0.35 + 0.1 * (i % 3);
      s.scale.set(sc, sc, 1);
      orbit.add(s);
      stickerData.push({ sprite: s, r: baseR * (0.9 + 0.2 * Math.random()), speed: 0.3 + 0.15 * i, phase: Math.random() * Math.PI * 2, z: (i - 1) * 0.25, bob: 0.04 + 0.03 * Math.random() });
    });

    const card: PixelCard = {
      group,
      mesh,
      targetScale: 1,
      baseScale: 1,
      baseY: 0,
      hover: false,
      rotatePhase: Math.random() * Math.PI * 2,
      front,
      back,
      showingFront: true,
      floatOffset: Math.random() * Math.PI * 2,
      frontCanvas: frontGen.canvas,
      frontCtx: frontGen.ctx,
      textLines: [],
      paragraph,
      typedCount: 0,
      lastTypeUpdate: 0,
      typewriterSpeed: 30,
      textStartY: pad + 58,
      lineH: 24,
      pad,
      title,
      accent,
      subAccent,
      W,
      H,
      linesVisible: Math.floor((H - (pad + 58) - pad) / 24),
      scrollIndex: -1,
      stickerOrbit: orbit,
      stickers: stickerData,
    };
    cards.push(card);

    // Prepare wrapped lines now
    const ctx = card.frontCtx;
    ctx.font = '18px "Press Start 2P"';
    card.textLines = wrapParagraph(ctx, paragraph, W - pad * 2);
    card.front.needsUpdate = true;
    return card;
  }

  // Create a true 3D voxel-style title built from cubes to match the pixel font vibe
  function makeVoxelText(text: string, options?: { pixelSize?: number; cube?: number; depth?: number; color?: number; emissive?: number }) {
    const pixelSize = options?.pixelSize ?? 6; // canvas sampling grid in px
    const cube = options?.cube ?? 0.06;       // size of each cube in world units
    const depth = options?.depth ?? 0.12;     // Z size of cubes
    const color = options?.color ?? 0xffe2f0;
    const emissive = options?.emissive ?? 0x6b3455;

    // draw text to canvas with pixel font
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const fontSize = 120; // px in canvas space
    ctx.font = `${fontSize}px "Press Start 2P"`;
    const metrics = ctx.measureText(text);
    const W = Math.ceil(metrics.width + 40);
    const H = Math.ceil(fontSize + 60);
    canvas.width = W; canvas.height = H;
    ctx.font = `${fontSize}px "Press Start 2P"`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(text, 20, 20);

    const img = ctx.getImageData(0, 0, W, H).data;
    const cols = Math.floor(W / pixelSize);
    const rows = Math.floor(H / pixelSize);
    const positions: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * pixelSize + (pixelSize >> 1);
        const y = r * pixelSize + (pixelSize >> 1);
        const xi = Math.max(0, Math.min(W - 1, Math.floor(x)));
        const yi = Math.max(0, Math.min(H - 1, Math.floor(y)));
        const idx = (yi * W + xi) * 4;
        const a = img[idx + 3] ?? 0;
        if (a > 64) positions.push({ x: xi, y: yi });
      }
    }

    const instCount = positions.length;
    const geom = new THREE.BoxGeometry(cube, cube, depth);
    const mat = makeToon(color, 4, 0x2a1c30);
  const inst = new THREE.InstancedMesh(geom, mat, instCount);
    const dummy = new THREE.Object3D();

    // center and map to world units
    const centerX = W / 2; const centerY = H / 2;
    const scale = cube / pixelSize; // world per px horizontally
    positions.forEach((p, i) => {
      dummy.position.set((p.x - centerX) * scale, (centerY - p.y) * scale, 0);
      dummy.rotation.z = 0;
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;

    const group = new THREE.Group();
    group.add(inst);
  scene.add(group);
  console.log('Voxel title cubes:', instCount, 'size:', { W, H, pixelSize });
    // approximate width/height in world units
    return { group, width: W * scale, height: H * scale };
  }

  async function buildContent() {
    // Wait for pixel font to be loaded before rasterizing voxels
    try {
      const anyDoc: any = document as any;
      if (anyDoc.fonts && anyDoc.fonts.ready) {
        await anyDoc.fonts.ready;
        console.log('Fonts ready');
      }
    } catch (e) {
      console.warn('Font loading API unavailable, proceeding');
    }

    // Hide BIO card for now to focus on cafe interior composition
    // const bioText = `...`;
    // const bioCard = makeCard('BIO', bioText, '#e9cda3', '#d7a46b');
    // bioCard.group.position.set(2.35, 0.15, 0.2);
    // bioCard.baseY = bioCard.group.position.y;

    // Build scene (decorated version)
      addEnvironment();
      addGarlandLights();
      addLowerGarlandLights();
      addShelvesAndDecor();
      addFramesAndMenu();
      addCoffeeStation();
      addLeftGlow();
      addTablesForeground();
      addBarStools();
      addCounterDetails();
      addBaseboard();
      addRug();
      addTrailingPlant();
      addPendantLamp();
      addBackBarShelfAndBottles();
      addExtraFrames();
      addContactShadows();
      addChalkDoodle();
      addRightBigPlant();
      addLeaningFrameTopRight();
      addWallClock();
      addHangingPlantsLeft();
      addBaristaTools();
      addPastryPriceCard();
      addTableCoasters();
      addRightGlow();

    // Load Toro Inoue model (head peeking above counter)
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/toro/scene.gltf');
      const toro = gltf.scene;
      toro.traverse((o:any)=>{ if (o.isMesh){ o.castShadow=false; o.receiveShadow=false; if (o.material) { o.material.roughness = 0.6; o.material.metalness = 0.0; }}});
      toro.scale.setScalar(0.5);
      toro.position.set(-1.15, 0.38, 2.28);
      toro.rotation.y = Math.PI * 0.06;
      scene.add(toro);
      const toroFill = new THREE.PointLight('#ffe6c5', 0.28, 1.2, 1.6);
      toroFill.position.set(toro.position.x + 0.1, 1.35, toro.position.z - 0.18);
      toroFill.castShadow = false; scene.add(toroFill);
    } catch (e) {
      console.warn('Toro load failed. Ensure the toro folder is placed at public/toro so /toro/scene.gltf is accessible.', e);
    }

    // Ensure layers are correct: everything on world layer (no overlay needed while card hidden)
    scene.traverse((o) => o.layers.set(0));
  }

  // Build content now
  buildContent();

  // Pointer events
  if (container.value) {
    container.value.addEventListener('pointermove', onPointerMove);
    container.value.addEventListener('click', onClick);
  }
  // Mouse wheel to scroll text when hovering the card
  const onWheel = (e: WheelEvent) => {
    if (!cards.length) return;
    const hovered = cards.find(c => c.hover);
    if (!hovered) return;
    e.preventDefault();
    const partial = hovered.textLines.join('\n').slice(0, hovered.typedCount).split('\n');
    const maxStart = Math.max(0, partial.length - hovered.linesVisible);
    if (maxStart <= 0) return;
    // Scroll by about half a line per wheel notch for fine control
    const delta = Math.sign(e.deltaY) * 1;
    if (hovered.scrollIndex < 0) hovered.scrollIndex = maxStart; // start from bottom if first manual scroll
    hovered.scrollIndex = Math.min(Math.max(0, hovered.scrollIndex + delta), maxStart);
    redrawTypewriter(hovered, hovered.W, hovered.H);
  };
  if (container.value) {
    container.value.addEventListener('wheel', onWheel, { passive: false });
  }
  wheelHandler = onWheel;

  // Animation loop
  const animate = () => {
    // Pixel-perfect camera snapping (orthographic)
    const anyCam: any = camera as any;
    if (anyCam && anyCam.isOrthographicCamera && container.value) {
      const cw = container.value.clientWidth || window.innerWidth;
      const ch = container.value.clientHeight || window.innerHeight;
      const aspect = cw / ch;
  const viewHeight = 8; // matches our ortho setup
      const viewWidth = viewHeight * aspect;
      const worldPerPixelX = viewWidth / cw;
      const worldPerPixelY = viewHeight / ch;
      anyCam.position.x = Math.round(anyCam.position.x / worldPerPixelX) * worldPerPixelX;
      anyCam.position.y = Math.round(anyCam.position.y / worldPerPixelY) * worldPerPixelY;
      anyCam.updateMatrixWorld();
    }
    animationId = requestAnimationFrame(animate);
    time += 0.016;

    // Gentle key light pulse for life
    const dls = scene.children.filter((o) => o.type === 'DirectionalLight') as THREE.DirectionalLight[];
    if (dls.length > 0 && dls[0]) {
      if (SPEC_MODE) {
        dls[0]!.intensity = 1.5; // keep to spec
      } else {
        const base = 0.9;
        dls[0]!.intensity = base + Math.sin(time * 0.6) * 0.02;
      }
    }

    // Dust float upward with gentle twinkle
    if (dustParticles) {
      const posAttr = dustParticles.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      const colAttr = dustParticles.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (posAttr && colAttr && dustPhases) {
        const arr = posAttr.array as Float32Array;
        const carr = colAttr.array as Float32Array;
        for (let i = 0, j=0, k=0; i < arr.length; i += 3, j+=3, k++) {
          // motion
          arr[i]!   += Math.sin(time*0.2 + k)*0.0003;
          arr[i+1]! += 0.002 + Math.sin(time * 0.5 + i) * 0.0005;
          arr[i+2]! += Math.cos(time*0.17 + k)*0.00025;
          if (arr[i + 1]! > dustBounds.maxY) arr[i + 1]! = dustBounds.minY;
          // twinkle
          const tw = 0.6 + 0.4 * Math.sin(time*4 + dustPhases[k]!);
          carr[j] = tw; carr[j+1] = tw; carr[j+2] = tw;
        }
        posAttr.needsUpdate = true; colAttr.needsUpdate = true;
      }
    }

    // Light garland twinkle (bulbs + lights)
    if (garlandBulbs.length) {
      for (let i = 0; i < garlandBulbs.length; i++) {
        const b = garlandBulbs[i]!;
        b.phase += 0.03 + 0.01 * Math.sin(time * 0.5 + i);
  const pulse = 0.6 + 0.24 * (0.5 + 0.5 * Math.sin(time * 3 + b.phase + i * 0.8));
  const m = b.mesh.material as THREE.MeshStandardMaterial;
  m.emissiveIntensity = 0.4 + 0.5 * pulse;
  b.light.intensity = 0.3 + 0.6 * pulse;
      }
    } else if (garlandSprites.length) {
      // fallback for sprite-only garland
      const f = (Math.sin(time * 3.7) + 1) * 0.5;
      garlandSprites.forEach((s, i) => {
        const k = 0.6 + 0.4 * Math.sin(time * 5 + i * 0.9);
        (s.material as THREE.SpriteMaterial).opacity = 0.7 * (0.7 * k + 0.3 * f);
      });
    }

    // Steam animation
    const mug2 = scene.children.find(o => (o as any)._steam) as any;
    if (mug2 && mug2._steam) {
      const s = mug2._steam as { sprite: THREE.Sprite; frames: THREE.CanvasTexture[]; t: number };
      s.t += 0.15;
      const idx = Math.floor(s.t) % s.frames.length;
      if ((s.sprite.material as THREE.SpriteMaterial).map !== s.frames[idx]!) {
        (s.sprite.material as THREE.SpriteMaterial).map = s.frames[idx]!;
        (s.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
      }
      // gentle rise and fade
      s.sprite.position.y += 0.0025;
      if (s.sprite.position.y > (mug2.position.y + 0.65)) s.sprite.position.y = mug2.position.y + 0.24;
  (s.sprite.material as THREE.SpriteMaterial).opacity = 0.45 + 0.15 * Math.sin(time * 2.0);
  s.sprite.scale.x = 0.25 + 0.03 * Math.sin(time*1.7);
  s.sprite.scale.y = 0.5 + 0.04 * Math.cos(time*1.3);
  s.sprite.position.x = mug2.position.x + 0.02*Math.sin(time*1.6);
    }

    // Lava lamp emissive pulse
    const lavaMat = (scene as any)._lavaLamp as THREE.MeshStandardMaterial | undefined;
    if (lavaMat) {
      lavaMat.emissiveIntensity = 0.7 + 0.25 * (0.5 + 0.5 * Math.sin(time * 1.1));
    }

  // Raycast for hover
  raycaster.setFromCamera(mouse, camera as THREE.PerspectiveCamera | THREE.OrthographicCamera);
  const hits = cards.length ? raycaster.intersectObjects(cards.map(c => c.mesh)) : [];
    cards.forEach(c => (c.hover = false));
    for (const h of hits) {
      const target = cards.find(c => c.mesh === h.object);
      if (target) target.hover = true;
    }
    // cursor
    if (container.value) container.value.style.cursor = hits.length ? 'pointer' : 'default';

    // Card animations
    // Swinging pivot (pendulum) for the hanging card
    if (cards[0]?.pivot) {
      const swing = Math.sin(time * 0.8) * 0.12 + Math.sin(time * 1.9) * 0.025;
      cards[0].pivot!.rotation.z = swing;
    }

    for (const c of cards) {
      const t = time * 0.4 + c.floatOffset;
      const bob = Math.sin(t) * 0.04;
      c.mesh.position.y = bob; // minor local bob while whole card swings

      // hover scale
      const targetScale = c.hover ? c.baseScale * 1.08 : c.baseScale * 1.0;
      c.targetScale += (targetScale - c.targetScale) * 0.15;
      c.group.scale.setScalar(c.targetScale);

      const rotTarget = c.hover ? 0.08 : 0.01;
      c.mesh.rotation.x += (rotTarget * Math.sin(t * 1.4) - c.mesh.rotation.x) * 0.08;
      c.mesh.rotation.z += (0.02 * Math.sin(t * 1.2 + 1.7) - c.mesh.rotation.z) * 0.06;

      // Animate floating stickers around card (orbit + bob) and billboard to camera
      if (c.stickers && c.stickerOrbit) {
        for (const s of c.stickers) {
          const ang = s.phase + time * s.speed;
          const x = Math.cos(ang) * s.r;
          const y = Math.sin(ang * 0.9) * (0.2 + s.bob) + 0.2;
          s.sprite.position.set(x, y, s.z);
          // billboard
          s.sprite.lookAt(camera.position);
        }
      }

      // Typewriter advance
      const now = performance.now();
      if (!c.lastTypeUpdate) c.lastTypeUpdate = now;
      if (now - c.lastTypeUpdate > c.typewriterSpeed) {
        c.lastTypeUpdate = now;
        const full = c.textLines.join('\n');
        if (c.typedCount < full.length) {
          c.typedCount++;
          redrawTypewriter(c, c.W, c.H);
          // typewriter sound (throttled)
          if (now - lastTypeSound > 18) {
            const ch = full[c.typedCount - 1];
            if (ch && ch.trim().length) {
              try {
                if (audioCtx && typeBuffer && typeGain) {
                  const src = audioCtx.createBufferSource();
                  src.buffer = typeBuffer;
                  src.connect(typeGain);
                  src.start(0);
                } else if (htmlTypePool.length) {
                  const idx = htmlTypeIdx++ % htmlTypePool.length;
                  const a = htmlTypePool[idx]!;
                  a.currentTime = 0; a.play().catch(() => {});
                }
              } catch {}
              lastTypeSound = now;
            }
          }
        }
      }
    }

    // Pixel pipeline render
  if (usePixelPipeline && target && screenScene && screenCam) {
      // Keep offscreen target in sync with current canvas size
      renderer.getSize(_tmpSize);
      const tw = Math.max(1, Math.floor(_tmpSize.x / pixelScale));
      const th = Math.max(1, Math.floor(_tmpSize.y / pixelScale));
      if ((target.width !== tw) || (target.height !== th)) target.setSize(tw, th);
      // 1) world (layer 0) to low-res target using worldCam
      if (worldCam) {
        worldCam.position.copy(camera.position);
        worldCam.quaternion.copy(camera.quaternion);
        worldCam.projectionMatrix.copy(camera.projectionMatrix);
        worldCam.updateMatrixWorld();
      }
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, worldCam ?? camera);
      // 2) upscale to screen
      renderer.setRenderTarget(null);
      renderer.clear();
      // draw the upscaled quad directly (no post in pixel path)
      if (screenScene && screenCam) {
        renderer.render(screenScene, screenCam);
      }
      // Ensure crisp overlay ignores previous depth
      renderer.clearDepth();
      // 3) crisp overlay (layer 1) directly to screen (e.g., text card)
      if (overlayCam) {
        overlayCam.position.copy(camera.position);
        overlayCam.quaternion.copy(camera.quaternion);
        overlayCam.projectionMatrix.copy(camera.projectionMatrix);
        overlayCam.updateMatrixWorld();
        renderer.render(scene, overlayCam);
      }
    } else {
      // Render world directly first, then crisp overlay
      if (useOverlayLayers && worldCam) {
        worldCam.position.copy(camera.position);
        worldCam.quaternion.copy(camera.quaternion);
        worldCam.projectionMatrix.copy(camera.projectionMatrix);
        worldCam.updateMatrixWorld();
        renderer.render(scene, worldCam);
        renderer.clearDepth();
        if (overlayCam) {
          overlayCam.position.copy(camera.position);
          overlayCam.quaternion.copy(camera.quaternion);
          overlayCam.projectionMatrix.copy(camera.projectionMatrix);
          overlayCam.updateMatrixWorld();
          renderer.render(scene, overlayCam);
        }
      } else {
        if (composer) {
          if (noisePass) (noisePass as any).uniforms.time.value = time;
          composer.render();
        } else {
          renderer.render(scene, camera as any);
        }
      }
    }
  };

  animate();

  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  if (animationId) cancelAnimationFrame(animationId);
  if (renderer) renderer.dispose();
  if (container.value) {
    container.value.removeEventListener('pointermove', onPointerMove);
    container.value.removeEventListener('click', onClick);
    if (wheelHandler) container.value.removeEventListener('wheel', wheelHandler);
  }
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped>
.three-container {
  width: 100vw;
  height: 100vh;
  position: fixed;
  inset: 0;
  z-index: 0;
}
</style>
