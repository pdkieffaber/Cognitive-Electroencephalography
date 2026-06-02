import * as THREE from '../third_party/three.module.js';

const container = document.getElementById('scene');
const depthReadout = document.getElementById('depthReadout');
const positiveReadout = document.getElementById('positiveReadout');
const negativeReadout = document.getElementById('negativeReadout');
const gainReadout = document.getElementById('gainReadout');
const mapMaxReadout = document.getElementById('mapMaxReadout');
const mapMinReadout = document.getElementById('mapMinReadout');
const topomapCanvas = document.getElementById('topomapCanvas');
const topomapContext = topomapCanvas.getContext('2d');
const traceCanvas = document.getElementById('traceCanvas');
const traceContext = traceCanvas.getContext('2d');
const gainInput = document.getElementById('gainInput');
const opacityInput = document.getElementById('opacityInput');
const resetButton = document.getElementById('resetButton');
const animationButton = document.getElementById('animationButton');
const modeButtons = Array.from(document.querySelectorAll('[data-mode]'));
const gainStepButtons = Array.from(document.querySelectorAll('[data-gain-step]'));
const referenceButtons = Array.from(document.querySelectorAll('[data-reference-mode]'));
const sourceModeButtons = Array.from(document.querySelectorAll('[data-source-mode]'));

const sphereRadius = 1.65;
const dipoleLength = 0.62;
const maxDipoleRadius = sphereRadius - dipoleLength * 0.62;
const fieldReferenceScale = 0.72;
const electrodeRadius = 0.052;
const yAxis = new THREE.Vector3(0, 1, 0);
const zAxis = new THREE.Vector3(0, 0, 1);
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();

const state = {
  mode: 'move',
  referenceMode: 'average',
  sourceMode: 'single',
  oscillating: false,
  animationPhase: Math.PI / 3,
  fieldGain: Number(gainInput.value),
  shellOpacity: Number(opacityInput.value),
  dipolePosition: new THREE.Vector3(0.28, 0.02, 0.04),
  dipoleDirection: new THREE.Vector3(0.84, 0.36, 0.22).normalize(),
};

const defaultState = {
  fieldGain: state.fieldGain,
  shellOpacity: state.shellOpacity,
  dipolePosition: state.dipolePosition.clone(),
  dipoleDirection: state.dipoleDirection.clone(),
};

const traceLabels = ['Fz', 'Cz', 'Pz'];
const traceColors = {
  Fz: '#bd6f3b',
  Cz: '#0b8071',
  Pz: '#6f62c9',
};
const traceHistoryLength = 180;
const traceHistory = new Map(traceLabels.map((label) => [label, new Array(traceHistoryLength).fill(0)]));
let traceAccumulator = 0;
let lastAnimationTime = performance.now();
let lastReferenceOffset = 0;
let activeSources = [];

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xf4f1e8, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const cameraSpherical = new THREE.Spherical(5.25, 1.18, 0.78);
const cameraTarget = new THREE.Vector3(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d1cb, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
keyLight.position.set(3.6, 5.2, 4.2);
scene.add(keyLight);

const root = new THREE.Group();
scene.add(root);

const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 104, 72);
const positionAttribute = sphereGeometry.getAttribute('position');
const colorAttribute = new THREE.BufferAttribute(new Float32Array(positionAttribute.count * 3), 3);
sphereGeometry.setAttribute('color', colorAttribute);

const sphereMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  transparent: true,
  opacity: state.shellOpacity,
  roughness: 0.74,
  metalness: 0.02,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
sphere.renderOrder = 1;
root.add(sphere);

const shellGrid = new THREE.Mesh(
  sphereGeometry,
  new THREE.MeshBasicMaterial({
    color: 0x23332e,
    wireframe: true,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  }),
);
shellGrid.renderOrder = 2;
root.add(shellGrid);

const equatorMaterial = new THREE.LineBasicMaterial({
  color: 0x22352f,
  transparent: true,
  opacity: 0.24,
});
root.add(makeRing('xy', sphereRadius, equatorMaterial));
root.add(makeRing('yz', sphereRadius, equatorMaterial));
root.add(makeRing('xz', sphereRadius, equatorMaterial));

const neutralColor = new THREE.Color(0xe7eee8);
const positiveColor = new THREE.Color(0xe8475d);
const negativeColor = new THREE.Color(0x2368cc);
const highPositiveColor = new THREE.Color(0xff6f45);
const highNegativeColor = new THREE.Color(0x315ee8);

const electrodeSpecs = [
  { label: 'Fp1', x: -0.35, y: 0.82 },
  { label: 'Fp2', x: 0.35, y: 0.82 },
  { label: 'F7', x: -0.8, y: 0.45 },
  { label: 'F3', x: -0.4, y: 0.45 },
  { label: 'Fz', x: 0, y: 0.52 },
  { label: 'F4', x: 0.4, y: 0.45 },
  { label: 'F8', x: 0.8, y: 0.45 },
  { label: 'T7', x: -0.94, y: 0 },
  { label: 'C3', x: -0.45, y: 0 },
  { label: 'Cz', x: 0, y: 0 },
  { label: 'C4', x: 0.45, y: 0 },
  { label: 'T8', x: 0.94, y: 0 },
  { label: 'P7', x: -0.78, y: -0.45 },
  { label: 'P3', x: -0.4, y: -0.45 },
  { label: 'Pz', x: 0, y: -0.52 },
  { label: 'P4', x: 0.4, y: -0.45 },
  { label: 'P8', x: 0.78, y: -0.45 },
  { label: 'O1', x: -0.35, y: -0.84 },
  { label: 'Oz', x: 0, y: -0.9 },
  { label: 'O2', x: 0.35, y: -0.84 },
];

const mastoidReferencePoints = [
  mapCoordinateToSurface(-0.96, -0.2, sphereRadius),
  mapCoordinateToSurface(0.96, -0.2, sphereRadius),
];

const secondarySourceSpecs = [
  {
    position: new THREE.Vector3(-0.44, -0.22, 0.18),
    direction: new THREE.Vector3(-0.34, 0.74, 0.58).normalize(),
    weight: 0.68,
    phase: 1.35,
    frequency: 1.18,
  },
  {
    position: new THREE.Vector3(0.02, 0.44, -0.16),
    direction: new THREE.Vector3(0.76, -0.24, 0.6).normalize(),
    weight: 0.54,
    phase: 2.72,
    frequency: 0.76,
  },
  {
    position: new THREE.Vector3(0.52, -0.28, 0.05),
    direction: new THREE.Vector3(-0.46, 0.12, 0.88).normalize(),
    weight: 0.46,
    phase: 4.05,
    frequency: 1.42,
  },
];

const shaftMaterial = new THREE.MeshStandardMaterial({
  color: 0x17201c,
  roughness: 0.45,
  metalness: 0.1,
});
const positiveMaterial = new THREE.MeshStandardMaterial({
  color: 0xe8475d,
  emissive: 0x4e0710,
  emissiveIntensity: 0.22,
  roughness: 0.32,
});
const negativeMaterial = new THREE.MeshStandardMaterial({
  color: 0x2368cc,
  emissive: 0x06143d,
  emissiveIntensity: 0.22,
  roughness: 0.34,
});
const handleMaterial = new THREE.MeshStandardMaterial({
  color: 0xd6952a,
  emissive: 0x2f1b02,
  emissiveIntensity: 0.18,
  roughness: 0.36,
});

const shaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.028, 0.028, dipoleLength, 24, 1),
  shaftMaterial,
);
shaft.userData.dragAction = 'move';
root.add(shaft);

const positiveCap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 28, 18), positiveMaterial);
positiveCap.userData.dragAction = 'orient';
root.add(positiveCap);

const negativeCap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 28, 18), negativeMaterial);
negativeCap.userData.dragAction = 'orient';
root.add(negativeCap);

const positiveCone = new THREE.Mesh(new THREE.ConeGeometry(0.078, 0.19, 28), positiveMaterial);
positiveCone.userData.dragAction = 'orient';
root.add(positiveCone);

const centerHandle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 16), handleMaterial);
centerHandle.userData.dragAction = 'move';
root.add(centerHandle);

const primarySource = {
  position: state.dipolePosition,
  direction: state.dipoleDirection,
  weight: 1,
  phase: 0,
  frequency: 1,
  amplitude: 1,
};
const secondarySources = secondarySourceSpecs.map(makeSecondarySource);
root.add(...secondarySources.map((source) => source.group));

const electrodes = electrodeSpecs.map(makeElectrode);
root.add(...electrodes.flatMap((electrode) => [electrode.mesh, electrode.rim, electrode.labelSprite]));

const surfacePositive = makeSurfaceMarker(positiveMaterial, positiveColor);
const surfaceNegative = makeSurfaceMarker(negativeMaterial, negativeColor);
root.add(surfacePositive.group, surfaceNegative.group);

const propagationPositive = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xe8475d, transparent: true, opacity: 0.74 }),
);
const propagationNegative = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0x2368cc, transparent: true, opacity: 0.74 }),
);
root.add(propagationPositive, propagationNegative);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const interactables = [positiveCap, negativeCap, positiveCone, centerHandle, shaft];
let dragState = null;
let lastFieldStats = { max: 0, min: 0 };

function makeRing(plane, radius, material) {
  const points = [];
  for (let i = 0; i <= 160; i += 1) {
    const angle = (i / 160) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (plane === 'xy') points.push(new THREE.Vector3(x, y, 0));
    if (plane === 'yz') points.push(new THREE.Vector3(0, x, y));
    if (plane === 'xz') points.push(new THREE.Vector3(x, 0, y));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

function makeSurfaceMarker(material, color) {
  const group = new THREE.Group();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.072, 28, 18), material);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.132, 0.008, 12, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
  );
  const label = makeLabelSprite(color === positiveColor ? '+' : '-', color.getStyle());
  group.add(dot, ring, label);
  return { group, dot, ring, label };
}

function makeElectrode(spec) {
  const position = mapCoordinateToSurface(spec.x, spec.y, sphereRadius * 1.026);
  const normal = position.clone().normalize();
  const labelPosition = mapCoordinateToSurface(spec.x, spec.y, sphereRadius * 1.11);
  const material = new THREE.MeshStandardMaterial({
    color: 0xfffaf1,
    emissive: 0x000000,
    emissiveIntensity: 0.36,
    roughness: 0.24,
    metalness: 0.02,
  });
  const rimMaterial = new THREE.MeshBasicMaterial({
    color: 0xfffaf1,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(electrodeRadius, 26, 18), material);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(electrodeRadius * 1.5, 0.007, 10, 36), rimMaterial);
  mesh.position.copy(position);
  rim.position.copy(position).addScaledVector(normal, electrodeRadius * 0.14);
  rim.quaternion.setFromUnitVectors(zAxis, normal);
  mesh.renderOrder = 4;
  rim.renderOrder = 5;
  const labelSprite = makeElectrodeLabelSprite(spec.label);
  labelSprite.position.copy(labelPosition);
  labelSprite.renderOrder = 6;
  return {
    ...spec,
    mesh,
    rim,
    material,
    rimMaterial,
    labelSprite,
    surfacePosition: mapCoordinateToSurface(spec.x, spec.y, sphereRadius),
  };
}

function makeElectrodeLabelSprite(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255, 250, 241, 0.84)';
  roundRect(context, 18, 16, 92, 30, 11);
  context.fill();
  context.strokeStyle = 'rgba(22, 32, 28, 0.16)';
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = '#16201c';
  context.font = '800 24px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 64, 31);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(0.18, 0.09, 1);
  return sprite;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function makeSecondarySource(spec) {
  const group = new THREE.Group();
  const shaftMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.019, 0.019, dipoleLength * 0.82, 18, 1),
    cloneTransparentMaterial(shaftMaterial, 0.62),
  );
  const positiveMesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), cloneTransparentMaterial(positiveMaterial, 0.68));
  const negativeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), cloneTransparentMaterial(negativeMaterial, 0.68));
  const coneMesh = new THREE.Mesh(new THREE.ConeGeometry(0.056, 0.14, 20), cloneTransparentMaterial(positiveMaterial, 0.68));

  group.add(shaftMesh, positiveMesh, negativeMesh, coneMesh);
  const source = {
    ...spec,
    amplitude: spec.weight,
    group,
    shaft: shaftMesh,
    positiveCap: positiveMesh,
    negativeCap: negativeMesh,
    positiveCone: coneMesh,
  };
  updateDipoleVisual(source, dipoleLength * 0.82);
  group.visible = false;
  return source;
}

function cloneTransparentMaterial(material, opacity) {
  const clone = material.clone();
  clone.transparent = true;
  clone.opacity = opacity;
  clone.depthWrite = false;
  return clone;
}

function makeLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255, 250, 241, 0.9)';
  context.beginPath();
  context.arc(64, 64, 38, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = color;
  context.font = '800 78px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 64, 60);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(0.22, 0.22, 1);
  return sprite;
}

function mapCoordinateToSurface(x, y, radius) {
  const planarRadiusSq = Math.min(0.998, x * x + y * y);
  const z = Math.sqrt(Math.max(0, 1 - planarRadiusSq));
  document.documentElement.dataset.sensorSurface = 'sphere';
  return new THREE.Vector3(x * radius, y * radius, z * radius);
}

function updateActiveSources() {
  const sources = state.sourceMode === 'many'
    ? [primarySource, ...secondarySources]
    : [primarySource];

  sources.forEach((source) => {
    source.amplitude = state.oscillating
      ? source.weight * Math.sin(state.animationPhase * source.frequency + source.phase)
      : source.weight;
  });

  activeSources = sources;
}

function rawPotentialAtSurface(surfacePoint) {
  let potential = 0;
  activeSources.forEach((source) => {
    scratchB.subVectors(surfacePoint, source.position);
    const distanceSq = Math.max(scratchB.lengthSq(), 0.045);
    potential += state.fieldGain * source.amplitude * source.direction.dot(scratchB) / Math.pow(distanceSq, 1.5);
  });
  return potential;
}

function computeReferenceOffset() {
  if (state.referenceMode === 'cz') {
    const cz = electrodes.find((electrode) => electrode.label === 'Cz');
    return rawPotentialAtSurface(cz.surfacePosition);
  }

  if (state.referenceMode === 'mastoids') {
    return mastoidReferencePoints.reduce((sum, point) => sum + rawPotentialAtSurface(point), 0) / mastoidReferencePoints.length;
  }

  return electrodes.reduce((sum, electrode) => sum + rawPotentialAtSurface(electrode.surfacePosition), 0) / electrodes.length;
}

function sensorPotentialAtSurface(surfacePoint) {
  return rawPotentialAtSurface(surfacePoint) - lastReferenceOffset;
}

function setColorFromPotential(color, potential, scale) {
  const normalized = THREE.MathUtils.clamp(potential / scale, -1, 1);
  const strength = Math.pow(Math.abs(normalized), 0.72);
  color.copy(neutralColor);
  if (normalized > 0) {
    color.lerp(positiveColor, Math.min(1, strength * 1.08));
    color.lerp(highPositiveColor, Math.max(0, strength - 0.72));
  } else if (normalized < 0) {
    color.lerp(negativeColor, Math.min(1, strength * 1.08));
    color.lerp(highNegativeColor, Math.max(0, strength - 0.72));
  }
  return color;
}

function colorToCss(color) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function updateCamera() {
  camera.position.setFromSpherical(cameraSpherical);
  camera.lookAt(cameraTarget);
}

function resize() {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function updateDipoleVisual(source, length) {
  const half = length * 0.5;
  scratchA.copy(source.direction).multiplyScalar(half).add(source.position);
  scratchB.copy(source.direction).multiplyScalar(-half).add(source.position);

  source.shaft.position.copy(source.position);
  source.shaft.quaternion.setFromUnitVectors(yAxis, source.direction);
  source.positiveCap.position.copy(scratchA);
  source.negativeCap.position.copy(scratchB);
  source.positiveCone.position.copy(source.direction).multiplyScalar(half + length * 0.16).add(source.position);
  source.positiveCone.quaternion.setFromUnitVectors(yAxis, source.direction);
}

function updateDipoleMeshes() {
  const direction = state.dipoleDirection;
  const center = state.dipolePosition;
  const half = dipoleLength * 0.5;

  scratchA.copy(direction).multiplyScalar(half).add(center);
  scratchB.copy(direction).multiplyScalar(-half).add(center);

  shaft.position.copy(center);
  shaft.quaternion.setFromUnitVectors(yAxis, direction);

  positiveCap.position.copy(scratchA);
  negativeCap.position.copy(scratchB);
  centerHandle.position.copy(center);

  positiveCone.position.copy(direction).multiplyScalar(half + 0.098).add(center);
  positiveCone.quaternion.setFromUnitVectors(yAxis, direction);

  secondarySources.forEach((source) => {
    updateDipoleVisual(source, dipoleLength * 0.82);
    source.group.visible = state.sourceMode === 'many';
    const scale = state.oscillating ? 0.82 + Math.abs(source.amplitude) * 0.34 : 1;
    source.group.scale.setScalar(scale);
  });
}

function updateSurfaceField() {
  lastReferenceOffset = computeReferenceOffset();

  const potentials = new Float32Array(positionAttribute.count);
  let maxValue = -Infinity;
  let minValue = Infinity;
  let maxPosition = new THREE.Vector3();
  let minPosition = new THREE.Vector3();

  for (let i = 0; i < positionAttribute.count; i += 1) {
    scratchA.fromBufferAttribute(positionAttribute, i);
    const potential = rawPotentialAtSurface(scratchA);
    potentials[i] = potential;
    if (potential > maxValue) {
      maxValue = potential;
      maxPosition.copy(scratchA);
    }
    if (potential < minValue) {
      minValue = potential;
      minPosition.copy(scratchA);
    }
  }

  const scale = fieldReferenceScale;
  const color = new THREE.Color();
  for (let i = 0; i < positionAttribute.count; i += 1) {
    setColorFromPotential(color, potentials[i], scale);
    colorAttribute.setXYZ(i, color.r, color.g, color.b);
  }
  colorAttribute.needsUpdate = true;

  lastFieldStats = { max: maxValue, min: minValue };
  updateSurfaceMarker(surfacePositive, maxPosition);
  updateSurfaceMarker(surfaceNegative, minPosition);
  updatePropagationLines(maxPosition, minPosition);
  updateElectrodes(scale);
  drawTopomap(scale);
  updateReadouts(scale);
}

function updateSurfaceMarker(marker, surfacePosition) {
  const normal = scratchC.copy(surfacePosition).normalize();
  marker.group.position.copy(normal).multiplyScalar(sphereRadius * 1.034);
  marker.ring.quaternion.setFromUnitVectors(zAxis, normal);
  marker.label.position.copy(normal).multiplyScalar(0.2);
}

function updatePropagationLines(maxPosition, minPosition) {
  const positiveStart = scratchA.copy(state.dipoleDirection).multiplyScalar(dipoleLength * 0.5).add(state.dipolePosition);
  const negativeStart = scratchB.copy(state.dipoleDirection).multiplyScalar(-dipoleLength * 0.5).add(state.dipolePosition);

  setLineCurve(propagationPositive, positiveStart, maxPosition);
  setLineCurve(propagationNegative, negativeStart, minPosition);
}

function setLineCurve(line, start, end) {
  const endPoint = end.clone().setLength(sphereRadius * 1.018);
  const middle = start.clone().lerp(endPoint, 0.52);
  middle.add(endPoint.clone().normalize().multiplyScalar(0.18));
  const curve = new THREE.CatmullRomCurve3([start.clone(), middle, endPoint]);
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(34));
}

function updateElectrodes(scale) {
  const color = new THREE.Color();
  let maxNormalizedMagnitude = 0;
  electrodes.forEach((electrode) => {
    electrode.value = sensorPotentialAtSurface(electrode.surfacePosition);
    setColorFromPotential(color, electrode.value, scale);
    const normalizedMagnitude = Math.min(1, Math.abs(electrode.value / scale));
    maxNormalizedMagnitude = Math.max(maxNormalizedMagnitude, normalizedMagnitude);
    electrode.material.color.copy(color);
    electrode.material.emissive.copy(color).multiplyScalar(0.42);
    electrode.rimMaterial.color.copy(color);
    electrode.rimMaterial.opacity = 0.66 + normalizedMagnitude * 0.3;
    electrode.mesh.scale.setScalar(1 + normalizedMagnitude * 0.22);
    electrode.rim.scale.setScalar(1 + normalizedMagnitude * 0.34);
  });
  document.documentElement.dataset.voltageColoredElectrodeCount = String(electrodes.length);
  document.documentElement.dataset.electrodeMarkerRadius = electrodeRadius.toFixed(3);
  document.documentElement.dataset.maxElectrodeMagnitude = maxNormalizedMagnitude.toFixed(3);
}

function drawTopomap(scale) {
  const ctx = topomapContext;
  const width = topomapCanvas.width;
  const height = topomapCanvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.405;
  const color = new THREE.Color();
  const block = 3;
  let maxValue = -Infinity;
  let minValue = Infinity;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 250, 241, 0.94)';
  ctx.fillRect(0, 0, width, height);

  for (let py = 0; py < height; py += block) {
    for (let px = 0; px < width; px += block) {
      const x = (px + block / 2 - centerX) / radius;
      const y = -(py + block / 2 - centerY) / radius;
      if (x * x + y * y > 1) continue;

      const potential = interpolateElectrodePotential(x, y);
      maxValue = Math.max(maxValue, potential);
      minValue = Math.min(minValue, potential);
      setColorFromPotential(color, potential, scale);
      ctx.fillStyle = colorToCss(color);
      ctx.fillRect(px, py, block + 0.5, block + 0.5);
    }
  }

  drawHeadOutline(ctx, centerX, centerY, radius);
  drawTopomapElectrodes(ctx, centerX, centerY, radius, scale);

  mapMaxReadout.textContent = (maxValue / scale).toFixed(2);
  mapMinReadout.textContent = (minValue / scale).toFixed(2);
  document.documentElement.dataset.topomapMax = (maxValue / scale).toFixed(3);
  document.documentElement.dataset.topomapMin = (minValue / scale).toFixed(3);
  document.documentElement.dataset.topomapSource = 'electrode-interpolation';
  document.documentElement.dataset.topomapElectrodeCount = String(electrodes.length);
}

function interpolateElectrodePotential(x, y) {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const electrode of electrodes) {
    const dx = x - electrode.x;
    const dy = y - electrode.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < 0.0001) {
      return electrode.value;
    }
    const weight = 1 / Math.pow(distanceSq + 0.012, 1.18);
    weightedSum += electrode.value * weight;
    weightTotal += weight;
  }

  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

function drawHeadOutline(ctx, centerX, centerY, radius) {
  ctx.save();
  ctx.strokeStyle = 'rgba(22, 32, 28, 0.72)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX - radius * 0.13, centerY - radius * 0.98);
  ctx.lineTo(centerX, centerY - radius * 1.12);
  ctx.lineTo(centerX + radius * 0.13, centerY - radius * 0.98);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(centerX - radius * 1.04, centerY, radius * 0.075, radius * 0.19, 0, 0, Math.PI * 2);
  ctx.ellipse(centerX + radius * 1.04, centerY, radius * 0.075, radius * 0.19, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTopomapElectrodes(ctx, centerX, centerY, radius, scale) {
  const color = new THREE.Color();
  ctx.save();
  ctx.font = '700 8px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  electrodes.forEach((electrode) => {
    const x = centerX + electrode.x * radius;
    const y = centerY - electrode.y * radius;
    setColorFromPotential(color, electrode.value, scale);

    ctx.beginPath();
    ctx.fillStyle = colorToCss(color);
    ctx.strokeStyle = 'rgba(22, 32, 28, 0.76)';
    ctx.lineWidth = 1.25;
    ctx.arc(x, y, 5.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(22, 32, 28, 0.78)';
    ctx.fillText(electrode.label, x, y + 11);
  });

  ctx.restore();
}

function getTraceValues() {
  return traceLabels.map((label) => {
    const electrode = electrodes.find((candidate) => candidate.label === label);
    return sensorPotentialAtSurface(electrode.surfacePosition);
  });
}

function seedTraceHistory() {
  const values = getTraceValues();
  traceLabels.forEach((label, index) => {
    traceHistory.set(label, new Array(traceHistoryLength).fill(values[index]));
  });
}

function pushTraceSample() {
  const values = getTraceValues();
  traceLabels.forEach((label, index) => {
    const history = traceHistory.get(label);
    history.push(values[index]);
    while (history.length > traceHistoryLength) {
      history.shift();
    }
  });
  document.documentElement.dataset.traceSampleCount = String(traceHistory.get(traceLabels[0]).length);
}

function drawTracePanel() {
  const ctx = traceContext;
  const width = traceCanvas.width;
  const height = traceCanvas.height;
  const padding = 18;
  const plotLeft = padding;
  const plotRight = width - padding;
  const plotTop = 14;
  const plotBottom = height - 20;
  const plotHeight = plotBottom - plotTop;
  const zeroY = (plotTop + plotBottom) / 2;
  const maxAbs = Math.max(
    fieldReferenceScale * 1.15,
    ...traceLabels.flatMap((label) => traceHistory.get(label).map((value) => Math.abs(value))),
  );

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 250, 241, 0.94)';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(22, 32, 28, 0.11)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = plotTop + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 6; i += 1) {
    const x = plotLeft + ((plotRight - plotLeft) * i) / 6;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(22, 32, 28, 0.4)';
  ctx.beginPath();
  ctx.moveTo(plotLeft, zeroY);
  ctx.lineTo(plotRight, zeroY);
  ctx.stroke();

  traceLabels.forEach((label) => {
    const history = traceHistory.get(label);
    ctx.strokeStyle = traceColors[label];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    history.forEach((value, index) => {
      const x = plotLeft + (index / (traceHistoryLength - 1)) * (plotRight - plotLeft);
      const y = zeroY - (value / maxAbs) * (plotHeight * 0.44);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  });

  ctx.fillStyle = 'rgba(22, 32, 28, 0.66)';
  ctx.font = '700 10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${maxAbs.toFixed(2)}`, width - 7, plotTop + 8);
  ctx.fillText(`${(-maxAbs).toFixed(2)}`, width - 7, plotBottom);
  document.documentElement.dataset.traceScale = maxAbs.toFixed(3);
}

function updateReadouts(scale) {
  depthReadout.textContent = `${(state.dipolePosition.length() / sphereRadius).toFixed(2)} R`;
  positiveReadout.textContent = (lastFieldStats.max / scale).toFixed(2);
  negativeReadout.textContent = (lastFieldStats.min / scale).toFixed(2);
  gainReadout.textContent = `${state.fieldGain.toFixed(2)}x`;
  document.documentElement.dataset.mode = state.mode;
  document.documentElement.dataset.referenceMode = state.referenceMode;
  document.documentElement.dataset.sourceMode = state.sourceMode;
  document.documentElement.dataset.oscillating = String(state.oscillating);
  document.documentElement.dataset.activeSourceCount = String(activeSources.length);
  document.documentElement.dataset.referenceOffset = lastReferenceOffset.toFixed(3);
  document.documentElement.dataset.fieldGain = state.fieldGain.toFixed(2);
  document.documentElement.dataset.peakPositive = (lastFieldStats.max / scale).toFixed(3);
  document.documentElement.dataset.peakNegative = (lastFieldStats.min / scale).toFixed(3);
  document.documentElement.dataset.electrodeCount = String(electrodes.length);
  document.documentElement.dataset.sensorLabelCount = String(electrodes.filter((electrode) => electrode.labelSprite).length);
  document.documentElement.dataset.dipolePosition = state.dipolePosition.toArray().map((value) => value.toFixed(4)).join(',');
  document.documentElement.dataset.dipoleDirection = state.dipoleDirection.toArray().map((value) => value.toFixed(4)).join(',');
  document.documentElement.dataset.positiveSurface = surfacePositive.group.position.toArray().map((value) => value.toFixed(4)).join(',');
  document.documentElement.dataset.negativeSurface = surfaceNegative.group.position.toArray().map((value) => value.toFixed(4)).join(',');
}

function updateAll(options = {}) {
  sphereMaterial.opacity = state.shellOpacity;
  updateActiveSources();
  updateDipoleMeshes();
  updateSurfaceField();
  if (options.recordTrace) {
    pushTraceSample();
  }
  drawTracePanel();
}

function setFieldGain(value) {
  const min = Number(gainInput.min);
  const max = Number(gainInput.max);
  const step = Number(gainInput.step);
  const stepped = Math.round(value / step) * step;
  state.fieldGain = THREE.MathUtils.clamp(stepped, min, max);
  gainInput.value = state.fieldGain.toFixed(2);
  updateAll();
}

function setMode(mode) {
  state.mode = mode;
  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setReferenceMode(referenceMode) {
  state.referenceMode = referenceMode;
  referenceButtons.forEach((button) => {
    const active = button.dataset.referenceMode === referenceMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateAll();
  seedTraceHistory();
  drawTracePanel();
}

function setSourceMode(sourceMode) {
  state.sourceMode = sourceMode;
  sourceModeButtons.forEach((button) => {
    const active = button.dataset.sourceMode === sourceMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateAll();
  seedTraceHistory();
  drawTracePanel();
}

function setOscillation(active) {
  state.oscillating = active;
  animationButton.classList.toggle('is-active', active);
  animationButton.setAttribute('aria-pressed', String(active));
  animationButton.textContent = active ? 'Pause oscillation' : 'Start oscillation';
  if (active) {
    traceAccumulator = 0;
    lastAnimationTime = performance.now();
  } else {
    updateAll();
  }
}

function resetDemo() {
  setOscillation(false);
  state.fieldGain = defaultState.fieldGain;
  state.shellOpacity = defaultState.shellOpacity;
  state.referenceMode = 'average';
  state.sourceMode = 'single';
  state.animationPhase = Math.PI / 3;
  state.dipolePosition.copy(defaultState.dipolePosition);
  state.dipoleDirection.copy(defaultState.dipoleDirection);
  gainInput.value = String(defaultState.fieldGain);
  opacityInput.value = String(defaultState.shellOpacity);
  setMode('move');
  setReferenceMode('average');
  setSourceMode('single');
  updateAll();
  seedTraceHistory();
  drawTracePanel();
}

function setPointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
}

function getPlaneHit(event, plane) {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}

function getPointerAction(event) {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactables, false);
  if (hits.length > 0 && hits[0].object.userData.dragAction) {
    return hits[0].object.userData.dragAction;
  }
  return state.mode;
}

function beginDrag(event) {
  const action = getPointerAction(event);
  dragState = {
    action,
    lastX: event.clientX,
    lastY: event.clientY,
    plane: new THREE.Plane(),
    offset: new THREE.Vector3(),
  };

  if (action === 'move' || action === 'orient') {
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    dragState.plane.setFromNormalAndCoplanarPoint(cameraDirection, state.dipolePosition);
    const hit = getPlaneHit(event, dragState.plane);
    if (hit && action === 'move') {
      dragState.offset.copy(state.dipolePosition).sub(hit);
    }
  }

  renderer.domElement.setPointerCapture(event.pointerId);
}

function drag(event) {
  if (!dragState) return;

  if (dragState.action === 'view') {
    const deltaX = event.clientX - dragState.lastX;
    const deltaY = event.clientY - dragState.lastY;
    cameraSpherical.theta -= deltaX * 0.006;
    cameraSpherical.phi = THREE.MathUtils.clamp(cameraSpherical.phi - deltaY * 0.005, 0.35, Math.PI - 0.32);
    updateCamera();
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    return;
  }

  const hit = getPlaneHit(event, dragState.plane);
  if (!hit) return;

  if (dragState.action === 'move') {
    const nextPosition = hit.add(dragState.offset);
    if (nextPosition.length() > maxDipoleRadius) {
      nextPosition.setLength(maxDipoleRadius);
    }
    state.dipolePosition.copy(nextPosition);
  }

  if (dragState.action === 'orient') {
    const nextDirection = hit.sub(state.dipolePosition);
    if (nextDirection.length() > 0.06) {
      state.dipoleDirection.copy(nextDirection.normalize());
    }
  }

  updateAll();
}

function endDrag(event) {
  if (dragState && renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
  dragState = null;
}

function zoom(event) {
  cameraSpherical.radius = THREE.MathUtils.clamp(
    cameraSpherical.radius * (1 + event.deltaY * 0.0008),
    3.7,
    7.2,
  );
  updateCamera();
}

function pulseMarkers(elapsedSeconds) {
  const scale = 1 + Math.sin(elapsedSeconds * 3.2) * 0.055;
  surfacePositive.ring.scale.setScalar(scale);
  surfaceNegative.ring.scale.setScalar(scale);
  positiveCap.scale.setScalar(1 + Math.sin(elapsedSeconds * 3.6) * 0.035);
  negativeCap.scale.setScalar(1 + Math.sin(elapsedSeconds * 3.6 + Math.PI) * 0.035);
}

function animate(now = performance.now()) {
  const elapsedSeconds = now * 0.001;
  const deltaSeconds = Math.min(0.08, (now - lastAnimationTime) * 0.001);
  lastAnimationTime = now;

  if (state.oscillating) {
    state.animationPhase += deltaSeconds * Math.PI * 2 * 1.6;
    traceAccumulator += deltaSeconds;
    if (traceAccumulator >= 1 / 30) {
      updateAll({ recordTrace: true });
      traceAccumulator = 0;
    }
  }

  pulseMarkers(elapsedSeconds);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function getDebugState() {
  return {
    mode: state.mode,
    referenceMode: state.referenceMode,
    sourceMode: state.sourceMode,
    oscillating: state.oscillating,
    activeSourceCount: activeSources.length,
    fieldGain: state.fieldGain,
    shellOpacity: state.shellOpacity,
    dipolePosition: state.dipolePosition.toArray().map((value) => Number(value.toFixed(4))),
    dipoleDirection: state.dipoleDirection.toArray().map((value) => Number(value.toFixed(4))),
    positiveSurface: surfacePositive.group.position.toArray().map((value) => Number(value.toFixed(4))),
    negativeSurface: surfaceNegative.group.position.toArray().map((value) => Number(value.toFixed(4))),
    canvasSize: [renderer.domElement.width, renderer.domElement.height],
  };
}

function sampleCanvasPixels() {
  const gl = renderer.getContext();
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  const pixel = new Uint8Array(4);
  const samples = [];
  const columns = 9;
  const rows = 7;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.floor(width * (0.2 + (column / (columns - 1)) * 0.6));
      const y = Math.floor(height * (0.2 + (row / (rows - 1)) * 0.6));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      samples.push([pixel[0], pixel[1], pixel[2], pixel[3]]);
    }
  }

  const luminance = samples.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const mean = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
  const variance = luminance.reduce((sum, value) => sum + (value - mean) ** 2, 0) / luminance.length;
  const polaritySamples = samples.filter(([r, , b]) => Math.abs(r - b) > 24).length;
  return {
    samples: samples.length,
    luminanceVariance: Number(variance.toFixed(2)),
    polaritySamples,
    centerPixel: samples[Math.floor(samples.length / 2)],
  };
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

referenceButtons.forEach((button) => {
  button.addEventListener('click', () => setReferenceMode(button.dataset.referenceMode));
});

sourceModeButtons.forEach((button) => {
  button.addEventListener('click', () => setSourceMode(button.dataset.sourceMode));
});

gainInput.addEventListener('input', () => {
  setFieldGain(Number(gainInput.value));
});

gainStepButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setFieldGain(state.fieldGain + Number(button.dataset.gainStep));
  });
});

opacityInput.addEventListener('input', () => {
  state.shellOpacity = Number(opacityInput.value);
  updateAll();
});

animationButton.addEventListener('click', () => setOscillation(!state.oscillating));
resetButton.addEventListener('click', resetDemo);
renderer.domElement.addEventListener('pointerdown', beginDrag);
renderer.domElement.addEventListener('pointermove', drag);
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);
renderer.domElement.addEventListener('wheel', zoom, { passive: true });
window.addEventListener('resize', () => {
  resize();
  updateCamera();
});

window.fieldDemo = {
  getState: getDebugState,
  sampleCanvasPixels,
  setMode,
  moveDipoleForTest() {
    state.dipolePosition.set(0.62, -0.22, 0.18);
    state.dipoleDirection.set(-0.24, 0.84, 0.48).normalize();
    updateAll();
    return getDebugState();
  },
};

resize();
updateCamera();
updateAll();
seedTraceHistory();
drawTracePanel();
animate();
