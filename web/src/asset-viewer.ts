import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './asset-viewer.css';

type ManifestAnimation = {
  index: number;
  name: string;
  frames: number;
  seconds: number;
  endBehavior: 'wrap' | 'clamp';
  contexts?: string[];
  moves?: string[];
};

type ManifestModel = {
  species: number;
  name: string;
  slug: string;
  group: 'pokemon' | 'extra';
  sourceFile: string;
  glb: string;
  triangles: number;
  vertices: number;
  bones: number;
  textures: number;
  animations: ManifestAnimation[];
};

type StadiumManifest = {
  source: string;
  romMd5: string;
  pokemon: ManifestModel[];
  extra: ManifestModel[];
};

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>('asset-canvas');
const assetList = byId<HTMLDivElement>('asset-list');
const assetSearch = byId<HTMLInputElement>('asset-search');
const assetCount = byId<HTMLSpanElement>('asset-count');
const loadingState = byId<HTMLDivElement>('loading-state');
const stageName = byId<HTMLSpanElement>('stage-name');
const stageSlot = byId<HTMLElement>('stage-slot');
const metadata = byId<HTMLDListElement>('model-metadata');
const animationSelect = byId<HTMLSelectElement>('animation-select');
const toggleAnimation = byId<HTMLButtonElement>('toggle-animation');
const restartAnimation = byId<HTMLButtonElement>('restart-animation');
const loopAnimation = byId<HTMLInputElement>('loop-animation');
const animationTime = byId<HTMLInputElement>('animation-time');
const currentTime = byId<HTMLSpanElement>('current-time');
const durationTime = byId<HTMLSpanElement>('duration-time');
const animationSpeed = byId<HTMLInputElement>('animation-speed');
const speedValue = byId<HTMLOutputElement>('speed-value');
const autoRotate = byId<HTMLInputElement>('auto-rotate');
const wireframe = byId<HTMLInputElement>('wireframe');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071322);
scene.fog = new THREE.Fog(0x071322, 14, 28);

const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 18;

scene.add(new THREE.HemisphereLight(0xaed8ff, 0x182411, 2.5));
const keyLight = new THREE.DirectionalLight(0xffe5b5, 3.4);
keyLight.position.set(5, 8, 6);
keyLight.castShadow = true;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x59a9ff, 2.2);
rimLight.position.set(-6, 3, -5);
scene.add(rimLight);

const grid = new THREE.GridHelper(18, 36, 0x3a86b8, 0x17354b);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.42;
scene.add(grid);
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(8.5, 64),
  new THREE.MeshStandardMaterial({ color: 0x0b2231, roughness: 0.9, metalness: 0.05 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.015;
floor.receiveShadow = true;
scene.add(floor);

const modelRoot = new THREE.Group();
scene.add(modelRoot);
const loader = new GLTFLoader();
const clock = new THREE.Clock();
let manifest: StadiumManifest | null = null;
let models: ManifestModel[] = [];
let selected: ManifestModel | null = null;
let mixer: THREE.AnimationMixer | null = null;
let action: THREE.AnimationAction | null = null;
let clips: THREE.AnimationClip[] = [];
let playing = true;
let selectedGroup: 'extra' | 'pokemon' | 'all' = 'extra';
let loadSequence = 0;

function prepareModel(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const textured = material as THREE.MeshStandardMaterial;
      if (!textured.map) continue;
      textured.map.magFilter = THREE.NearestFilter;
      textured.map.minFilter = THREE.NearestFilter;
      textured.map.generateMipmaps = false;
      textured.map.needsUpdate = true;
    }
  });
}

function clearModel(): void {
  mixer?.stopAllAction();
  modelRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      const textured = material as THREE.MeshStandardMaterial;
      textured.map?.dispose();
      material.dispose();
    });
  });
  mixer = null;
  action = null;
  clips = [];
  modelRoot.clear();
}

function resetCamera(): void {
  camera.position.set(4.6, 3.1, 6.2);
  controls.target.set(0, 1.25, 0);
  controls.update();
}

function frameModel(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 3.2 / Math.max(size.x, size.y, size.z, 0.001);
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(model);
  const framed = bounds.getSize(new THREE.Vector3());
  const height = Math.max(framed.y, 0.5);
  const radius = Math.max(framed.x, framed.y, framed.z) * 0.72;
  controls.target.set(0, height * 0.48, 0);
  camera.position.set(radius * 1.65, height * 0.78 + radius * 0.45, radius * 2.35);
  controls.update();
}

function setWireframe(enabled: boolean): void {
  modelRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if ('wireframe' in material) (material as THREE.MeshStandardMaterial).wireframe = enabled;
    });
  });
}

function animationLabel(animation: ManifestAnimation): string {
  const roles = animation.contexts?.filter((role) => !role.startsWith('reaction_')) ?? [];
  const suffix = roles.length ? ` · ${roles.join(', ')}` : '';
  return `${String(animation.index).padStart(2, '0')} — ${animation.name}${suffix} (${animation.seconds.toFixed(2)}s)`;
}

function selectAnimation(index: number): void {
  mixer?.stopAllAction();
  action = null;
  const info = selected?.animations.find((animation) => animation.index === index);
  const clip = clips[index];
  if (!mixer || !info || !clip) {
    animationTime.max = '1';
    animationTime.value = '0';
    durationTime.textContent = 'NO CLIP';
    toggleAnimation.disabled = true;
    restartAnimation.disabled = true;
    return;
  }
  action = mixer.clipAction(clip);
  loopAnimation.checked = info.endBehavior === 'wrap';
  action.setLoop(loopAnimation.checked ? THREE.LoopRepeat : THREE.LoopOnce, loopAnimation.checked ? Infinity : 1);
  action.clampWhenFinished = !loopAnimation.checked;
  action.reset().play();
  action.paused = !playing;
  animationTime.max = String(Math.max(clip.duration, 0.001));
  animationTime.value = '0';
  currentTime.textContent = '0.00';
  durationTime.textContent = `${clip.duration.toFixed(2)} SEC`;
  toggleAnimation.disabled = false;
  restartAnimation.disabled = false;
  toggleAnimation.textContent = playing ? 'PAUSE' : 'PLAY';
}

function modelRows(model: ManifestModel): string {
  const rows: Array<[string, string | number]> = [
    ['GROUP', model.group.toUpperCase()],
    ['SOURCE SLOT', model.sourceFile],
    ['SPECIES FIELD', model.species],
    ['TRIANGLES', model.triangles.toLocaleString()],
    ['VERTICES', model.vertices.toLocaleString()],
    ['BONES', model.bones],
    ['TEXTURES', model.textures],
    ['CLIPS', model.animations.length],
  ];
  return rows.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join('');
}

async function loadModel(model: ManifestModel): Promise<void> {
  const sequence = ++loadSequence;
  selected = model;
  document.querySelectorAll<HTMLButtonElement>('.asset-entry').forEach((button) => button.classList.toggle('selected', button.dataset.slug === model.slug));
  loadingState.hidden = false;
  loadingState.textContent = `LOADING ${model.name.toUpperCase()}…`;
  stageName.textContent = model.name;
  stageSlot.textContent = `${model.slug} · ${model.sourceFile}`;
  metadata.innerHTML = modelRows(model);
  animationSelect.innerHTML = model.animations.length
    ? model.animations.map((animation) => `<option value="${animation.index}">${animationLabel(animation)}</option>`).join('')
    : '<option value="">NO ANIMATIONS</option>';
  animationSelect.disabled = model.animations.length === 0;
  history.replaceState(null, '', `${location.pathname}?model=${encodeURIComponent(model.slug)}`);
  try {
    const gltf = await loader.loadAsync(`/generated/stadium/${model.glb}`);
    if (sequence !== loadSequence) return;
    clearModel();
    prepareModel(gltf.scene);
    modelRoot.add(gltf.scene);
    clips = gltf.animations;
    mixer = new THREE.AnimationMixer(gltf.scene);
    frameModel(gltf.scene);
    setWireframe(wireframe.checked);
    loadingState.hidden = true;
    const preferred = model.animations.find((animation) => animation.contexts?.includes('idle'))
      ?? model.animations.find((animation) => animation.endBehavior === 'wrap' && animation.seconds >= 0.25)
      ?? [...model.animations].sort((a, b) => b.seconds - a.seconds)[0];
    if (preferred) animationSelect.value = String(preferred.index);
    selectAnimation(preferred?.index ?? -1);
  } catch (error) {
    if (sequence !== loadSequence) return;
    clearModel();
    loadingState.hidden = false;
    loadingState.textContent = `COULD NOT LOAD ${model.glb}\n${String(error)}`;
  }
}

function visibleModels(): ManifestModel[] {
  const query = assetSearch.value.trim().toLowerCase();
  return models.filter((model) => {
    if (selectedGroup !== 'all' && model.group !== selectedGroup) return false;
    return !query || `${model.name} ${model.slug} ${model.sourceFile} ${model.species}`.toLowerCase().includes(query);
  });
}

function renderList(): void {
  const visible = visibleModels();
  assetCount.textContent = `${visible.length} / ${models.length} MODELS`;
  assetList.innerHTML = visible.map((model) => `
    <button type="button" class="asset-entry${selected?.slug === model.slug ? ' selected' : ''}" data-slug="${model.slug}">
      <span class="entry-slot">${model.sourceFile.replace('.bin', '')}</span>
      <span class="entry-copy"><strong>${model.name}</strong><small>${model.triangles.toLocaleString()} TRI · ${model.animations.length} CLIP${model.animations.length === 1 ? '' : 'S'}</small></span>
    </button>`).join('') || '<p class="empty-list">NO MATCHING MODELS</p>';
  assetList.querySelectorAll<HTMLButtonElement>('.asset-entry').forEach((button) => {
    button.addEventListener('click', () => {
      const model = models.find((candidate) => candidate.slug === button.dataset.slug);
      if (model) void loadModel(model);
    });
  });
}

async function loadManifest(): Promise<void> {
  try {
    const response = await fetch('/generated/stadium/manifest.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json() as StadiumManifest;
    models = [...manifest.extra, ...manifest.pokemon];
    if (!manifest.extra.length) throw new Error('The manifest contains no extra models. Run npm run extract:stadium again.');
    renderList();
    const requested = new URLSearchParams(location.search).get('model');
    const initial = models.find((model) => model.slug === requested) ?? manifest.extra[0] ?? manifest.pokemon[0];
    if (initial) void loadModel(initial);
  } catch (error) {
    loadingState.hidden = false;
    loadingState.textContent = `ASSET MANIFEST UNAVAILABLE\n${String(error)}\n\nPlace the supported ROM under baseroms/ and run npm run extract:stadium.`;
    assetCount.textContent = 'NO MANIFEST';
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((button) => {
  button.addEventListener('click', () => {
    selectedGroup = button.dataset.group as typeof selectedGroup;
    document.querySelectorAll('[data-group]').forEach((tab) => tab.classList.toggle('active', tab === button));
    renderList();
  });
});
assetSearch.addEventListener('input', renderList);
animationSelect.addEventListener('change', () => selectAnimation(Number(animationSelect.value)));
toggleAnimation.addEventListener('click', () => {
  playing = !playing;
  if (action) action.paused = !playing;
  toggleAnimation.textContent = playing ? 'PAUSE' : 'PLAY';
});
restartAnimation.addEventListener('click', () => {
  if (!action) return;
  action.reset().play();
  action.paused = !playing;
});
loopAnimation.addEventListener('change', () => {
  if (!action) return;
  action.setLoop(loopAnimation.checked ? THREE.LoopRepeat : THREE.LoopOnce, loopAnimation.checked ? Infinity : 1);
  action.clampWhenFinished = !loopAnimation.checked;
  action.reset().play();
  action.paused = !playing;
});
animationTime.addEventListener('input', () => {
  if (!action) return;
  action.time = Number(animationTime.value);
  mixer?.update(0);
  currentTime.textContent = action.time.toFixed(2);
});
animationSpeed.addEventListener('input', () => {
  const speed = Number(animationSpeed.value);
  if (mixer) mixer.timeScale = speed;
  speedValue.value = `${speed.toFixed(1)}×`;
});
wireframe.addEventListener('change', () => setWireframe(wireframe.checked));
byId<HTMLButtonElement>('reset-camera').addEventListener('click', resetCamera);
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  event.preventDefault();
  toggleAnimation.click();
});

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resetCamera();

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mixer && playing) mixer.update(dt);
  if (action) {
    animationTime.value = String(action.time);
    currentTime.textContent = action.time.toFixed(2);
  }
  controls.autoRotate = autoRotate.checked;
  controls.autoRotateSpeed = 1.2;
  controls.update();
  renderer.render(scene, camera);
}
animate();
void loadManifest();
