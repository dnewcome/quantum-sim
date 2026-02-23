// main.js — Scene, camera, post-processing, GUI, fixed-timestep loop

import * as THREE from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { QuantumField }    from './QuantumField.js';
import { ParticleSystem }  from './ParticleSystem.js';
import { Consciousness }   from './Consciousness.js';
import { QuantumRenderer } from './QuantumRenderer.js';
import { ShapeConstraint } from './ShapeConstraint.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const SIM_DT    = 0.004;   // 250 Hz internal
const MAX_STEPS = 4;
const MAX_WALL_DT = 0.05;  // cap wall time at 50ms

// ─── Renderer & Scene ────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x000008);

// ─── Camera ──────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 0, 45);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance   = 5;
controls.maxDistance   = 120;

// ─── Post-processing ─────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.8,  // strength
  0.6,  // radius
  0.1   // threshold
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ─── Simulation objects ──────────────────────────────────────────────────────
const field       = new QuantumField();
const particles   = new ParticleSystem();
particles.field   = field;
const consciousness = new Consciousness(field);
const qRenderer   = new QuantumRenderer(scene, field, particles);

// Shape constraint — loaded from STL file via GUI
const shapeConstraint = new ShapeConstraint();
shapeConstraint._onGeometryChange = (worldVerts, triCount) => {
  qRenderer.setShapeGeometry(worldVerts, triCount);
};

// ─── GUI State ───────────────────────────────────────────────────────────────
const guiState = {
  // Simulation
  mode:           'loop',
  fieldSpeed:     1.0,
  injectionRate:  4.0,

  // Fields
  higgsVEV:       0.8,
  yukawaCoupling: 0.3,
  damping:        0.05,

  // Consciousness
  orchThreshold:  0.95,
  orchGrowthRate: 0.8,
  iitUpdateRate:  0.15,
  consciousnessEnabled: true,

  // Heart attractor
  heartStrength: 0.0,
  showHeart:     true,

  // Rendering
  bloomStrength:  1.8,
  bloomRadius:    0.6,
  bloomThreshold: 0.1,
  fieldLayout:         'cubic',
  showField:           true,
  showParticles:       true,
  showEntanglement:    true,
  showFlashes:         true,
  showConsciousness:   true,

  // Shape constraint
  shapeEnabled:      false,
  shapeFuzziness:    1.0,
  shapeScale:        1.0,
  shapeShowWireframe: false,

  // Camera
  autoRotate:     false,
  autoRotateSpeed: 0.5,

  // Actions
  applyMode() {
    field.init(guiState.mode);
    particles.active.clear();
    particles._freeList.length = 0;
    for (let i = MAX_PARTICLES - 1; i >= 0; i--) {
      particles.type[i] = 0;
      particles._freeList.push(i);
    }
    simRunning = true;
    console.log(`[quantum-sim] mode → ${guiState.mode}`);
  },
};

// Max from ParticleSystem
const MAX_PARTICLES = 300;

// ─── GUI Setup ───────────────────────────────────────────────────────────────
const gui = new GUI({ title: 'Quantum Consciousness' });

// Simulation folder
const simF = gui.addFolder('Simulation');
simF.add(guiState, 'mode', ['loop', 'bigbang', 'higgs', 'consciousness', 'antimatter'])
    .name('Mode');
simF.add(guiState, 'fieldSpeed',    0.1, 5.0, 0.1).name('Field Speed');
simF.add(guiState, 'injectionRate', 0.0, 20.0, 0.5).name('Injection Rate')
    .onChange(v => { particles.injectionRate = v; });
simF.add(guiState, 'applyMode').name('Apply Mode');

// Fields folder
const fieldsF = gui.addFolder('Fields');
fieldsF.add(guiState, 'higgsVEV', 0.1, 2.0, 0.05).name('Higgs VEV')
       .onChange(v => { /* live update is complex — log */ console.log('Higgs VEV:', v); });
fieldsF.add(guiState, 'yukawaCoupling', 0.0, 1.0, 0.05).name('Yukawa Coupling');
fieldsF.add(guiState, 'damping',        0.0, 0.2, 0.005).name('Photon Damping');

// Consciousness folder
const consF = gui.addFolder('Consciousness');
consF.add(guiState, 'consciousnessEnabled').name('Enabled')
     .onChange(v => { consciousness.enabled = v; });
consF.add(guiState, 'orchThreshold',  0.1, 1.0, 0.01).name('Orch-OR Threshold')
     .onChange(v => { consciousness.orchThreshold = v; });
consF.add(guiState, 'orchGrowthRate', 0.1, 3.0, 0.05).name('Growth Rate')
     .onChange(v => { consciousness.orchGrowthRate = v; });
consF.add(guiState, 'iitUpdateRate',  0.01, 0.5, 0.01).name('IIT Smoothing')
     .onChange(v => { consciousness.iitUpdateRate = v; });

// Heart Attractor folder
const heartF = gui.addFolder('Heart Attractor');
heartF.add(guiState, 'heartStrength', 0.0, 1.0, 0.01).name('Probability / Strength')
      .onChange(v => { field.heartStrength = v; });
heartF.add(guiState, 'showHeart').name('Show Heart Glow')
      .onChange(v => { qRenderer.showHeart = v; });

// Shape Constraint folder
const shapeF = gui.addFolder('Shape Constraint');
shapeF.add({ loadSTL: () => document.getElementById('stl-input').click() }, 'loadSTL')
      .name('Load STL…');
shapeF.add(guiState, 'shapeEnabled').name('Enabled')
      .onChange(v => {
        shapeConstraint.enabled = v;
        field.shapeMask = (v && shapeConstraint._rawVerts) ? shapeConstraint.fuzzMask : null;
      });
shapeF.add(guiState, 'shapeFuzziness', 0.0, 6.0, 0.1).name('Fuzziness (world units)')
      .onChange(v => { shapeConstraint.setFuzziness(v); });
shapeF.add(guiState, 'shapeScale', 0.1, 3.0, 0.05).name('Scale')
      .onChange(v => { shapeConstraint.setScale(v); });
shapeF.add(guiState, 'shapeShowWireframe').name('Show Wireframe')
      .onChange(v => { qRenderer.showShapeWireframe = v; });
shapeF.close();

// STL file input handler
document.getElementById('stl-input').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    shapeConstraint.loadSTL(e.target.result);
    if (shapeConstraint.enabled) {
      field.shapeMask = shapeConstraint.fuzzMask;
    }
  };
  reader.readAsArrayBuffer(file);
  ev.target.value = ''; // allow re-loading the same file
});

// Rendering folder
const renderF = gui.addFolder('Rendering');
renderF.add(guiState, 'fieldLayout', ['cubic', 'octahedral']).name('Field Layout')
       .onChange(v => { qRenderer.fieldLayout = v; });
renderF.add(guiState, 'bloomStrength', 0.0, 5.0, 0.1).name('Bloom Strength')
       .onChange(v => { bloomPass.strength = v; });
renderF.add(guiState, 'bloomRadius',    0.0, 1.5, 0.05).name('Bloom Radius')
       .onChange(v => { bloomPass.radius = v; });
renderF.add(guiState, 'bloomThreshold', 0.0, 1.0, 0.01).name('Bloom Threshold')
       .onChange(v => { bloomPass.threshold = v; });
renderF.add(guiState, 'showField').name('Field Volume')
       .onChange(v => { qRenderer.showField = v; });
renderF.add(guiState, 'showParticles').name('Particles')
       .onChange(v => { qRenderer.showParticles = v; });
renderF.add(guiState, 'showEntanglement').name('Entanglement Threads')
       .onChange(v => { qRenderer.showEntanglement = v; });
renderF.add(guiState, 'showFlashes').name('Annihilation Flashes')
       .onChange(v => { qRenderer.showFlashes = v; });
renderF.add(guiState, 'showConsciousness').name('Consciousness Overlay')
       .onChange(v => { qRenderer.showConsciousness = v; });

// Camera folder
const camF = gui.addFolder('Camera');
camF.add(guiState, 'autoRotate').name('Auto Rotate')
    .onChange(v => { controls.autoRotate = v; });
camF.add(guiState, 'autoRotateSpeed', 0.1, 5.0, 0.1).name('Rotation Speed')
    .onChange(v => { controls.autoRotateSpeed = v; });

// ─── Resize handling ─────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

// ─── Fixed-Timestep Loop ─────────────────────────────────────────────────────
let lastTime = performance.now();
let accumDt  = 0;
let frameCount = 0;
let simRunning = true;
let consFrameAcc = 0; // count sim steps for consciousness (every 4th)

function animate(now) {
  requestAnimationFrame(animate);

  const wallDt = Math.min((now - lastTime) * 0.001, MAX_WALL_DT);
  lastTime = now;

  controls.autoRotate = guiState.autoRotate;
  controls.autoRotateSpeed = guiState.autoRotateSpeed;
  controls.update();

  if (simRunning) {
    accumDt += wallDt;
    let steps = 0;
    const scaledDT = SIM_DT * guiState.fieldSpeed;

    while (accumDt >= SIM_DT && steps < MAX_STEPS) {
      field.update(scaledDT);
      particles.update(scaledDT);

      consFrameAcc++;
      if (consFrameAcc >= 4) {
        consciousness.update(scaledDT * 4);
        consFrameAcc = 0;
      }

      accumDt -= SIM_DT;
      steps++;
      frameCount++;
    }

    // Check "initial" mode completion
    if (guiState.mode !== 'loop' && particles.allDead() && field.isQuiescent()) {
      simRunning = false;
      console.log('[quantum-sim] Simulation quiesced.');
    }
  }

  // Renderer update
  qRenderer.billboardFlashes(camera);
  qRenderer.update(frameCount);

  composer.render();
}

requestAnimationFrame(animate);
console.log('[quantum-sim] Started. Open GUI to explore.');
