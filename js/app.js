import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { CONFIG } from './config.js';
import {
  computeMeshStats,
  estimateFDM,
  estimateResin,
  sizeTierForVolume,
  sizeTierForDimension,
  machineCostPerHour,
} from './geometry.js';
import { efficiencyFactorForColors, calculateQuote, customerBreakdownForTier } from './pricing.js';

// ----------------------------------------------------------------------
// STATE
// ----------------------------------------------------------------------
let nextPartId = 1;
const state = {
  parts: [],             // { id, name, geometry }
  printerId: 'p1s',
  laborTouchedByUser: false,
  postageTouchedByUser: false,
  unitSystem: 'mm',       // 'mm' | 'in'
  activeAddonIds: new Set(),
  activeShippingOverrideId: null,
  resinTier: 'small',     // auto-calculated, no longer user-editable
  lastQuote: null,
  lastAgg: null,          // aggregated estimate across all parts
};

// ----------------------------------------------------------------------
// DOM refs
// ----------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const dropzone = el('dropzone');
const fileInput = el('fileInput');
const fileStatus = el('fileStatus');
const partsList = el('partsList');
const resetBtn = el('resetBtn');
const sizeOnlyToggle = el('sizeOnlyToggle');
const sizeOnlyForm = el('sizeOnlyForm');
const sizeOnlyX = el('sizeOnlyX');
const sizeOnlyY = el('sizeOnlyY');
const sizeOnlyZ = el('sizeOnlyZ');
const sizeOnlyUnit = el('sizeOnlyUnit');
const addSizeOnlyBtn = el('addSizeOnlyBtn');

const panelPreview = el('panel-preview');
const panelSetup = el('panel-setup');
const panelExtras = el('panel-extras');
const panelPackaging = el('panel-packaging');
const panelAddons = el('panel-addons');
const panelResults = el('panel-results');

const printerSelect = el('printerSelect');
const materialSelect = el('materialSelect');
const customMaterialRow = el('customMaterialRow');
const customCostInput = el('customCostInput');
const customCostHint = el('customCostHint');
const colorsRow = el('colorsRow');
const colorsInput = el('colorsInput');
const efficiencyHint = el('efficiencyHint');
const quantityInput = el('quantityInput');
const laborInput = el('laborInput');
const laborHint = el('laborHint');
const unitSelect = el('unitSelect');

const materialsTableBody = document.querySelector('#materialsTable tbody');
const packagingTableBody = document.querySelector('#packagingTable tbody');
const addMaterialRowBtn = el('addMaterialRow');
const addPackagingRowBtn = el('addPackagingRow');
const addonsListEl = el('addonsList');

const fitWarning = el('fitWarning');
const outDimensions = el('outDimensions');
const outMaterial = el('outMaterial');
const outTime = el('outTime');
const outParts = el('outOrientation');
const bdMaterial = el('bdMaterial');
const bdExtras = el('bdExtras');
const bdLabor = el('bdLabor');
const bdMachine = el('bdMachine');
const bdPackaging = el('bdPackaging');
const bdAddOnsRow = el('bdAddOnsRow');
const bdAddOns = el('bdAddOns');
const bdLanded = el('bdLanded');
const marginTiersEl = el('marginTiers');

const viewerCanvas = el('viewerCanvas');
const customerModal = el('customerModal');
const modalClose = el('modalClose');
const modalViewerCanvas = el('modalViewerCanvas');
const modalTitle = el('modalTitle');
const modalDims = el('modalDims');
const modalMaterial = el('modalMaterial');
const modalTime = el('modalTime');
const modalBreakdown = el('modalBreakdown');
const modalCopyBtn = el('modalCopyBtn');

// ----------------------------------------------------------------------
// FORMATTERS
// ----------------------------------------------------------------------
const fmtMoney = (n) => `$${n.toFixed(2)}`;
const fmtWhole = (n) => `$${Math.round(n)}`;
const fmtGrams = (n, unit) => `${n.toFixed(1)} ${unit}`;
const fmtHours = (h) => {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
};
const fmtLen = (mm) => (state.unitSystem === 'in' ? `${(mm / 25.4).toFixed(2)}"` : `${mm.toFixed(0)}mm`);
const fmtDims = (x, y, z) => `${fmtLen(x)} \u00D7 ${fmtLen(y)} \u00D7 ${fmtLen(z)}`;

// ----------------------------------------------------------------------
// 3D VIEWER (used for both the inline preview and the customer modal)
// ----------------------------------------------------------------------
function createViewer(canvas, { autoRotate = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 2.4;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;

  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(1, 2, 1.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-1.2, -0.4, -1);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0x404040, 1.3));

  const material = new THREE.MeshStandardMaterial({ color: 0xff7a30, roughness: 0.55, metalness: 0.05 });
  let meshGroup = new THREE.Group();
  scene.add(meshGroup);
  let animId = null;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frameToGroup() {
    const box = new THREE.Box3().setFromObject(meshGroup);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 2.1;
    camera.position.set(center.x + dist * 0.55, center.y + dist * 0.5, center.z + dist * 0.6);
    camera.near = Math.max(maxDim * 0.01, 0.1);
    camera.far = maxDim * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  function setGeometries(geometries) {
    scene.remove(meshGroup);
    meshGroup = new THREE.Group();
    let xOffset = 0;
    geometries.forEach((geom) => {
      geom.computeBoundingBox();
      const size = new THREE.Vector3();
      geom.boundingBox.getSize(size);
      const mesh = new THREE.Mesh(geom, material);
      mesh.position.x = xOffset - geom.boundingBox.min.x;
      xOffset += size.x + Math.max(5, size.x * 0.15);
      meshGroup.add(mesh);
    });
    const box = new THREE.Box3().setFromObject(meshGroup);
    if (!box.isEmpty()) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      meshGroup.position.sub(center);
    }
    scene.add(meshGroup);
    resize();
    frameToGroup();
  }

  function start() {
    resize();
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      animId = requestAnimationFrame(loop);
    };
    if (!animId) loop();
  }

  function stop() {
    if (animId) cancelAnimationFrame(animId);
    animId = null;
  }

  window.addEventListener('resize', resize);

  return { setGeometries, start, stop, resize };
}

const mainViewer = createViewer(viewerCanvas);
const modalViewer = createViewer(modalViewerCanvas, { autoRotate: false });

function refreshViewer() {
  if (state.parts.length === 0) {
    panelPreview.hidden = true;
    mainViewer.stop();
    return;
  }
  panelPreview.hidden = false;
  mainViewer.setGeometries(state.parts.map((p) => p.geometry.clone()));
  mainViewer.start();
  requestAnimationFrame(() => mainViewer.resize());
}

// ----------------------------------------------------------------------
// FILE LOADING
// ----------------------------------------------------------------------
function readFileAs(file, mode) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (mode === 'text') reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

function mergeToSingleGeometry(root) {
  root.updateMatrixWorld(true);
  const positions = [];
  const v = new THREE.Vector3();

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const geom = child.geometry;
    const posAttr = geom.attributes.position;
    if (!posAttr) return;
    const index = geom.index;
    const pushVertex = (idx) => {
      v.fromBufferAttribute(posAttr, idx);
      v.applyMatrix4(child.matrixWorld);
      positions.push(v.x, v.y, v.z);
    };
    if (index) {
      for (let i = 0; i < index.count; i++) pushVertex(index.getX(i));
    } else {
      for (let i = 0; i < posAttr.count; i++) pushVertex(i);
    }
  });

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.computeVertexNormals();
  return merged;
}

async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'stl') {
    const buffer = await readFileAs(file, 'arraybuffer');
    const geometry = new STLLoader().parse(buffer);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry));
    return mergeToSingleGeometry(group);
  }
  if (ext === 'obj') {
    const text = await readFileAs(file, 'text');
    const group = new OBJLoader().parse(text);
    return mergeToSingleGeometry(group);
  }
  if (ext === '3mf') {
    const buffer = await readFileAs(file, 'arraybuffer');
    const group = new ThreeMFLoader().parse(buffer);
    return mergeToSingleGeometry(group);
  }

  throw new Error(
    ext === 'step' || ext === 'stp'
      ? 'STEP files aren\u2019t supported \u2014 this app only reads mesh formats (STL/OBJ/3MF). Quote this one manually.'
      : `Unsupported file type ".${ext}". Use STL, OBJ, or 3MF.`
  );
}

function renderPartsList() {
  partsList.innerHTML = '';
  state.parts.forEach((part) => {
    const li = document.createElement('li');
    const meta = part.isSizeOnly
      ? 'size-only estimate'
      : `${(part.geometry.attributes.position.count / 3).toLocaleString()} tri`;
    li.innerHTML = `
      <span class="part-name">${part.name}</span>
      <span class="part-meta">${meta}</span>
      <button type="button" class="part-remove" title="Remove">\u2715</button>
    `;
    li.querySelector('.part-remove').addEventListener('click', () => {
      state.parts = state.parts.filter((p) => p.id !== part.id);
      renderPartsList();
      afterPartsChanged();
    });
    partsList.appendChild(li);
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  fileStatus.textContent = `Analyzing ${files.length > 1 ? files.length + ' files' : files[0].name}\u2026`;
  fileStatus.className = 'file-status busy';

  const errors = [];
  for (const file of files) {
    try {
      const geometry = await parseFile(file);
      const { volumeMm3 } = computeMeshStats(geometry);
      if (!isFinite(volumeMm3) || volumeMm3 <= 0) {
        errors.push(`${file.name}: couldn\u2019t get a reliable volume (mesh may not be watertight)`);
      }
      state.parts.push({ id: nextPartId++, name: file.name, geometry });
    } catch (err) {
      errors.push(`${file.name}: ${err.message || 'could not be read'}`);
    }
  }

  if (errors.length > 0) {
    fileStatus.textContent = errors.join(' \u2014 ');
    fileStatus.className = 'file-status warn';
  } else {
    fileStatus.textContent = `${state.parts.length} part${state.parts.length === 1 ? '' : 's'} loaded`;
    fileStatus.className = 'file-status ok';
  }

  renderPartsList();
  afterPartsChanged();
}

function afterPartsChanged() {
  const hasParts = state.parts.length > 0;
  [panelSetup, panelExtras, panelPackaging, panelAddons, panelResults].forEach((p) => (p.hidden = !hasParts));
  refreshViewer();
  if (hasParts) {
    updateDerivedDefaults();
    recalculate();
  } else {
    panelResults.hidden = true;
  }
}

// ----------------------------------------------------------------------
// SIZE-ONLY QUOTING (no file — just customer-given dimensions)
// ----------------------------------------------------------------------
sizeOnlyToggle.addEventListener('click', () => {
  sizeOnlyForm.hidden = !sizeOnlyForm.hidden;
});

sizeOnlyUnit.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    sizeOnlyUnit.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

function addSizeOnlyPart() {
  const unit = sizeOnlyUnit.querySelector('.seg-btn.active').dataset.unit;
  const toMm = (v) => (unit === 'in' ? v * 25.4 : v);
  const x = toMm(parseFloat(sizeOnlyX.value) || 0);
  const y = toMm(parseFloat(sizeOnlyY.value) || 0);
  const z = toMm(parseFloat(sizeOnlyZ.value) || 0);

  if (x <= 0 || y <= 0 || z <= 0) {
    fileStatus.textContent = 'Enter all three dimensions (greater than 0).';
    fileStatus.className = 'file-status warn';
    return;
  }

  // Treated as a solid block of that size — the max possible volume for
  // that envelope, so it's a deliberately conservative (high) stand-in for
  // not having the actual file. Runs through the exact same shell/infill/
  // support math as a real mesh.
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(x, y, z)));
  const geometry = mergeToSingleGeometry(group);

  const dimLabel = unit === 'in'
    ? `${(x / 25.4).toFixed(2)}" \u00D7 ${(y / 25.4).toFixed(2)}" \u00D7 ${(z / 25.4).toFixed(2)}"`
    : `${x.toFixed(0)}mm \u00D7 ${y.toFixed(0)}mm \u00D7 ${z.toFixed(0)}mm`;

  state.parts.push({ id: nextPartId++, name: `Size-only block (${dimLabel})`, geometry, isSizeOnly: true });

  // Keep the displayed unit system in sync with whichever the user just
  // used to enter dimensions.
  state.unitSystem = unit;
  unitSelect.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.unit === unit));

  sizeOnlyX.value = '';
  sizeOnlyY.value = '';
  sizeOnlyZ.value = '';

  fileStatus.textContent = `${state.parts.length} part${state.parts.length === 1 ? '' : 's'} loaded`;
  fileStatus.className = 'file-status ok';

  renderPartsList();
  afterPartsChanged();
}

addSizeOnlyBtn.addEventListener('click', addSizeOnlyPart);

// ----------------------------------------------------------------------
// DROPZONE
// ----------------------------------------------------------------------
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFiles(fileInput.files);
  fileInput.value = '';
});
['dragover', 'dragenter'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  })
);
dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// ----------------------------------------------------------------------
// RESET
// ----------------------------------------------------------------------
resetBtn.addEventListener('click', () => {
  state.parts = [];
  state.printerId = 'p1s';
  state.laborTouchedByUser = false;
  state.postageTouchedByUser = false;
  state.activeAddonIds = new Set();
  state.activeShippingOverrideId = null;

  printerSelect.querySelectorAll('.seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  colorsInput.value = 1;
  quantityInput.value = 1;
  materialsTableBody.innerHTML = '';
  packagingTableBody.innerHTML = '';
  createLineRow(packagingTableBody, { name: 'Postage', qty: 1, unitCost: 0 });

  fileStatus.textContent = '';
  fileStatus.className = 'file-status';
  partsList.innerHTML = '';

  sizeOnlyForm.hidden = true;
  sizeOnlyX.value = '';
  sizeOnlyY.value = '';
  sizeOnlyZ.value = '';
  sizeOnlyUnit.querySelectorAll('.seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  state.unitSystem = 'mm';
  unitSelect.querySelectorAll('.seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));

  refreshAddonToggleStyles();
  populateMaterialsForPrinter();
  applyLaborDefault();
  afterPartsChanged();
});

// ----------------------------------------------------------------------
// PRINTER / MATERIAL SELECTION
// ----------------------------------------------------------------------
printerSelect.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    printerSelect.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.printerId = btn.dataset.printer;
    populateMaterialsForPrinter();
    toggleRowsForPrinterType();
    if (state.parts.length) {
      updateDerivedDefaults();
      recalculate();
    }
  });
});

function currentPrinterCfg() {
  return CONFIG.printers[state.printerId];
}

function toggleRowsForPrinterType() {
  const isFdm = currentPrinterCfg().type === 'fdm';
  colorsRow.hidden = !isFdm;
  updateCustomMaterialVisibility();
}

function updateCustomMaterialVisibility() {
  const isFdm = currentPrinterCfg().type === 'fdm';
  const isCustom = materialSelect.value === '__custom__';
  customMaterialRow.hidden = !isCustom;
  customCostHint.textContent = isFdm ? '$/kg' : '$/Liter';
}

function populateMaterialsForPrinter() {
  const printerCfg = currentPrinterCfg();
  const prevValue = materialSelect.value;
  materialSelect.innerHTML = '';
  Object.keys(printerCfg.materials).forEach((key) => {
    const mat = printerCfg.materials[key];
    const opt = document.createElement('option');
    opt.value = key;
    const costLabel = printerCfg.type === 'fdm' ? `$${mat.costPerKg}/kg` : `$${mat.costPerLiter}/L`;
    opt.textContent = `${key} (${costLabel})`;
    materialSelect.appendChild(opt);
  });
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Custom\u2026';
  materialSelect.appendChild(customOpt);

  materialSelect.value = prevValue && [...materialSelect.options].some((o) => o.value === prevValue)
    ? prevValue
    : printerCfg.defaultMaterial;
  updateCustomMaterialVisibility();
}

function applyLaborDefault() {
  const printerCfg = currentPrinterCfg();
  if (printerCfg.type === 'fdm') {
    laborInput.value = printerCfg.baseLaborMinutes;
    laborHint.textContent = `Default for ${printerCfg.name}`;
  } else {
    const tier = state.resinTier;
    laborInput.value = printerCfg.laborBySizeTier[tier];
    laborHint.textContent = `${tier[0].toUpperCase()}${tier.slice(1)} resin part default (wash/cure/support setup)`;
  }
}

function applyPostageDefault(tier) {
  const row = Array.from(packagingTableBody.querySelectorAll('tr')).find(
    (tr) => tr.querySelector('.row-name').value.trim().toLowerCase() === 'postage'
  );
  if (!row) return;
  row.querySelector('.row-cost').value = CONFIG.postageBySizeTier[tier];
}

/** Recomputes both the resin (volume-based) and FDM (dimension-based) size
 *  tiers across ALL loaded parts, and refreshes labor/postage defaults. */
function updateDerivedDefaults() {
  if (state.parts.length === 0) return;

  let resinTotalVolumeMm3 = 0;
  let maxDimMm = 0;
  let anyFail = false;

  state.parts.forEach((part) => {
    try {
      const resinEst = estimateResin(part.geometry, CONFIG.printers.photon, CONFIG.resinEstimate);
      resinTotalVolumeMm3 += resinEst.totalVolumeMm3;
      const fdmEst = estimateFDM(part.geometry, CONFIG.printers.p1s, CONFIG.fdmEstimate);
      maxDimMm = Math.max(maxDimMm, fdmEst.bbox.x, fdmEst.bbox.y, fdmEst.bbox.z);
    } catch {
      anyFail = true;
    }
  });
  if (anyFail) return;

  const resinTier = sizeTierForVolume(resinTotalVolumeMm3 / 1000, CONFIG.sizeTiers);
  state.resinTier = resinTier;

  const fdmTier = sizeTierForDimension(maxDimMm, CONFIG.sizeTiersFdm);
  const activeTier = currentPrinterCfg().type === 'fdm' ? fdmTier : resinTier;

  if (!state.laborTouchedByUser) applyLaborDefault();
  if (!state.postageTouchedByUser) applyPostageDefault(activeTier);
}

colorsInput.addEventListener('input', () => {
  const n = Math.max(1, parseInt(colorsInput.value || '1', 10));
  const factor = efficiencyFactorForColors(
    currentPrinterCfg().baseEfficiencyFactor,
    currentPrinterCfg().amsColorStep,
    n
  );
  efficiencyHint.textContent = `Efficiency multiplier: ${factor.toFixed(2)}x`;
  recalculate();
});

laborInput.addEventListener('input', () => {
  state.laborTouchedByUser = true;
  recalculate();
});

materialSelect.addEventListener('change', () => {
  updateCustomMaterialVisibility();
  recalculate();
});
customCostInput.addEventListener('input', recalculate);
quantityInput.addEventListener('input', recalculate);

unitSelect.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    unitSelect.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.unitSystem = btn.dataset.unit;
    if (state.lastAgg) renderResults(state.lastAgg, state.lastQuote);
  });
});

// ----------------------------------------------------------------------
// LINE-ITEM TABLES
// ----------------------------------------------------------------------
function createLineRow(tbody, defaults = { name: '', qty: 1, unitCost: 0 }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="row-name" placeholder="Item" value="${defaults.name}" /></td>
    <td><input type="number" class="row-qty" min="0" step="1" value="${defaults.qty}" /></td>
    <td><input type="number" class="row-cost" min="0" step="0.01" value="${defaults.unitCost}" /></td>
    <td><button type="button" class="row-remove" title="Remove">\u2715</button></td>
  `;
  const costInput = tr.querySelector('.row-cost');
  const nameInput = tr.querySelector('.row-name');
  tr.querySelectorAll('input').forEach((input) => input.addEventListener('input', recalculate));
  if (tbody === packagingTableBody) {
    costInput.addEventListener('input', () => {
      if (nameInput.value.trim().toLowerCase() === 'postage') state.postageTouchedByUser = true;
    });
  }
  tr.querySelector('.row-remove').addEventListener('click', () => {
    tr.remove();
    recalculate();
  });
  tbody.appendChild(tr);
  return tr;
}

function readLineItems(tbody) {
  return Array.from(tbody.querySelectorAll('tr')).map((tr) => ({
    name: tr.querySelector('.row-name').value || 'Item',
    qty: parseFloat(tr.querySelector('.row-qty').value) || 0,
    unitCost: parseFloat(tr.querySelector('.row-cost').value) || 0,
  }));
}

addMaterialRowBtn.addEventListener('click', () => createLineRow(materialsTableBody));
addPackagingRowBtn.addEventListener('click', () => createLineRow(packagingTableBody));
createLineRow(packagingTableBody, { name: 'Postage', qty: 1, unitCost: 0 });

// ----------------------------------------------------------------------
// ADD-ONS
// ----------------------------------------------------------------------
function createAddonToggle(extraCfg) {
  const div = document.createElement('div');
  div.className = 'addon-toggle';
  div.dataset.id = extraCfg.id;
  div.innerHTML = `<span class="addon-name">${extraCfg.label}</span><span class="addon-price">$${extraCfg.amount}</span>`;
  div.addEventListener('click', () => {
    if (extraCfg.type === 'shipping-override') {
      state.activeShippingOverrideId = state.activeShippingOverrideId === extraCfg.id ? null : extraCfg.id;
    } else {
      if (state.activeAddonIds.has(extraCfg.id)) state.activeAddonIds.delete(extraCfg.id);
      else state.activeAddonIds.add(extraCfg.id);
    }
    refreshAddonToggleStyles();
    recalculate();
  });
  return div;
}

function refreshAddonToggleStyles() {
  addonsListEl.querySelectorAll('.addon-toggle').forEach((elToggle) => {
    const id = elToggle.dataset.id;
    const isActive = state.activeAddonIds.has(id) || state.activeShippingOverrideId === id;
    elToggle.classList.toggle('active', isActive);
  });
}

function buildAddonsUI() {
  addonsListEl.innerHTML = '';
  const addonLabel = document.createElement('div');
  addonLabel.className = 'addon-group-label';
  addonLabel.textContent = 'Add-ons';
  addonsListEl.appendChild(addonLabel);
  CONFIG.extras.filter((e) => e.type === 'addon').forEach((a) => addonsListEl.appendChild(createAddonToggle(a)));

  const shipLabel = document.createElement('div');
  shipLabel.className = 'addon-group-label';
  shipLabel.textContent = 'Shipping upgrade (replaces postage)';
  addonsListEl.appendChild(shipLabel);
  CONFIG.extras.filter((e) => e.type === 'shipping-override').forEach((a) => addonsListEl.appendChild(createAddonToggle(a)));
}
buildAddonsUI();

// ----------------------------------------------------------------------
// MAIN CALCULATION
// ----------------------------------------------------------------------
function currentMaterialCfg() {
  const printerCfg = currentPrinterCfg();
  const isFdm = printerCfg.type === 'fdm';
  if (materialSelect.value === '__custom__') {
    const cost = parseFloat(customCostInput.value) || 0;
    // Density isn't asked for — custom FDM materials are assumed to be a
    // standard ~1kg spool at typical filament density (config-tunable, not
    // shown in the UI since $/kg is what people actually think in).
    return isFdm
      ? { costPerKg: cost, densityGcm3: CONFIG.customMaterialDefaults.densityGcm3 }
      : { costPerLiter: cost };
  }
  return printerCfg.materials[materialSelect.value];
}

function recalculate() {
  if (state.parts.length === 0) return;

  const printerCfg = currentPrinterCfg();
  const materialCfg = currentMaterialCfg();
  const isFdm = printerCfg.type === 'fdm';

  let totalVolumeMm3 = 0;
  let totalHours = 0;
  let anyMisfit = false;
  let maxDim = { x: 0, y: 0, z: 0 };
  const perPart = [];

  state.parts.forEach((part) => {
    const est = isFdm
      ? estimateFDM(part.geometry, printerCfg, CONFIG.fdmEstimate)
      : estimateResin(part.geometry, printerCfg, CONFIG.resinEstimate, state.resinTier);
    totalVolumeMm3 += est.totalVolumeMm3;
    totalHours += est.hours;
    if (!est.fits) anyMisfit = true;
    if (Math.max(est.bbox.x, est.bbox.y, est.bbox.z) > Math.max(maxDim.x, maxDim.y, maxDim.z)) {
      maxDim = est.bbox;
    }
    perPart.push({ name: part.name, bbox: est.bbox, fits: est.fits });
  });

  const volumeCm3 = totalVolumeMm3 / 1000;
  const gramsOrMl = volumeCm3 * (isFdm ? materialCfg.densityGcm3 : 1);
  const unitLabel = isFdm ? 'g' : 'mL';

  const efficiencyFactor = isFdm
    ? efficiencyFactorForColors(
        printerCfg.baseEfficiencyFactor,
        printerCfg.amsColorStep,
        Math.max(1, parseInt(colorsInput.value || '1', 10))
      )
    : printerCfg.baseEfficiencyFactor;

  const costPerKgOrLiter = isFdm ? materialCfg.costPerKg : materialCfg.costPerLiter;

  const addOns = CONFIG.extras
    .filter((e) => e.type === 'addon' && state.activeAddonIds.has(e.id))
    .map((e) => ({ name: e.label, amount: e.amount }));
  const shippingOverrideAmount = state.activeShippingOverrideId
    ? CONFIG.extras.find((e) => e.id === state.activeShippingOverrideId).amount
    : null;

  const quote = calculateQuote({
    gramsOrMl,
    costPerKgOrLiter,
    efficiencyFactor,
    quantity: Math.max(1, parseInt(quantityInput.value || '1', 10)),
    printHours: totalHours,
    machineCostPerHour: machineCostPerHour(printerCfg),
    laborMinutes: Math.max(0, parseFloat(laborInput.value || '0')),
    laborRatePerHour: CONFIG.pricing.laborRatePerHour,
    materialsExtra: readLineItems(materialsTableBody),
    packaging: readLineItems(packagingTableBody),
    shippingOverrideAmount,
    addOns,
    repeatUnitEfficiency: CONFIG.pricing.repeatUnitEfficiency,
    safetyMargin: CONFIG.estimateSafetyMargin,
    marginTiers: CONFIG.pricing.marginTiers,
    fiverrFeePercent: CONFIG.pricing.fiverrFeePercent,
  });

  const agg = { gramsOrMl, unitLabel, totalHours, maxDim, anyMisfit, perPart };
  state.lastQuote = quote;
  state.lastAgg = agg;
  renderResults(agg, quote);
}

function renderResults(agg, quote) {
  fitWarning.hidden = !agg.anyMisfit;

  if (agg.perPart.length === 1) {
    outDimensions.textContent = fmtDims(agg.maxDim.x, agg.maxDim.y, agg.maxDim.z);
  } else {
    outDimensions.textContent = `${agg.perPart.length} parts, largest ${fmtDims(agg.maxDim.x, agg.maxDim.y, agg.maxDim.z)}`;
  }
  outMaterial.textContent = fmtGrams(agg.gramsOrMl, agg.unitLabel);
  outTime.textContent = fmtHours(agg.totalHours);
  const misfitCount = agg.perPart.filter((p) => !p.fits).length;
  outParts.textContent = misfitCount > 0
    ? `${agg.perPart.length} \u2014 ${misfitCount} won't fit`
    : `${agg.perPart.length} \u2014 all fit`;

  bdMaterial.textContent = fmtMoney(quote.printedPartTotalCost);
  bdExtras.textContent = fmtMoney(quote.extraMaterialsCost);
  bdLabor.textContent = fmtMoney(quote.totalLaborCost);
  bdMachine.textContent = fmtMoney(quote.machineCost);
  bdPackaging.textContent = fmtMoney(quote.totalPackagingCost);
  bdAddOnsRow.hidden = quote.addOnsCost <= 0;
  bdAddOns.textContent = fmtMoney(quote.addOnsCost);
  bdLanded.textContent = fmtMoney(quote.landedCost);

  marginTiersEl.innerHTML = '';
  quote.prices.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'margin-card';
    card.innerHTML = `
      <div class="margin-pct">${p.marginPercent.toFixed(0)}%</div>
      <div class="margin-price">${fmtWhole(p.price)}</div>
      <div class="margin-sub">Fiverr \u2212${fmtMoney(p.fiverrFee)}</div>
      <div class="margin-profit">${fmtMoney(p.profit)} profit</div>
    `;
    card.addEventListener('click', () => openCustomerModal(i));
    marginTiersEl.appendChild(card);
  });
}

// ----------------------------------------------------------------------
// CUSTOMER SHARE MODAL
// ----------------------------------------------------------------------
function openCustomerModal(tierIndex) {
  if (!state.lastQuote || !state.lastAgg) return;
  const cb = customerBreakdownForTier(state.lastQuote, tierIndex);
  const agg = state.lastAgg;

  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  modalTitle.textContent = `Quote \u2014 ${today}`;
  modalDims.textContent = agg.perPart.length === 1
    ? fmtDims(agg.maxDim.x, agg.maxDim.y, agg.maxDim.z)
    : `${agg.perPart.length} parts`;
  modalMaterial.textContent = fmtGrams(agg.gramsOrMl, agg.unitLabel);
  modalTime.textContent = fmtHours(agg.totalHours);

  modalBreakdown.innerHTML = `
    <div class="breakdown-row"><span>Materials</span><span>${fmtMoney(cb.materials)}</span></div>
    <div class="breakdown-row"><span>Labor</span><span>${fmtMoney(cb.labor)}</span></div>
    <div class="breakdown-row"><span>Printing</span><span>${fmtMoney(cb.machine)}</span></div>
    <div class="breakdown-row"><span>Packaging &amp; shipping</span><span>${fmtMoney(cb.packaging)}</span></div>
    ${cb.addOns > 0 ? `<div class="breakdown-row"><span>Extras</span><span>${fmtMoney(cb.addOns)}</span></div>` : ''}
    <div class="breakdown-row total"><span>Total</span><span>${fmtWhole(cb.total)}</span></div>
  `;

  modalCopyBtn.onclick = () => {
    const lines = [
      `Quote \u2014 ${today}`,
      `Size: ${modalDims.textContent}`,
      `Material used: ${modalMaterial.textContent}`,
      `Est. print time: ${modalTime.textContent}`,
      `Materials: ${fmtMoney(cb.materials)}`,
      `Labor: ${fmtMoney(cb.labor)}`,
      `Printing: ${fmtMoney(cb.machine)}`,
      `Packaging & shipping: ${fmtMoney(cb.packaging)}`,
    ];
    if (cb.addOns > 0) lines.push(`Extras: ${fmtMoney(cb.addOns)}`);
    lines.push(`Total: ${fmtWhole(cb.total)}`);
    const text = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        modalCopyBtn.textContent = 'Copied!';
        setTimeout(() => (modalCopyBtn.textContent = 'Copy quote as text'), 1500);
      });
    }
  };

  customerModal.hidden = false;
  modalViewer.setGeometries(state.parts.map((p) => p.geometry.clone()));
  modalViewer.start();
  requestAnimationFrame(() => modalViewer.resize());
}

function closeCustomerModal() {
  customerModal.hidden = true;
  modalViewer.stop();
}
modalClose.addEventListener('click', closeCustomerModal);
customerModal.addEventListener('click', (e) => {
  if (e.target === customerModal) closeCustomerModal();
});

// ----------------------------------------------------------------------
// INIT
// ----------------------------------------------------------------------
// Bump this alongside the ?v= cache-buster in index.html on every deploy —
// shown in the footer so it's obvious at a glance whether an update
// actually landed, instead of guessing from behavior.
const APP_VERSION = 9;
const appVersionEl = el('appVersion');
if (appVersionEl) appVersionEl.textContent = `App v${APP_VERSION}`;

populateMaterialsForPrinter();
applyLaborDefault();
