import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';

import { CONFIG } from './config.js';
import {
  computeMeshStats,
  estimateFDM,
  estimateResin,
  sizeTierForVolume,
  machineCostPerHour,
} from './geometry.js';
import { efficiencyFactorForColors, calculateQuote } from './pricing.js';

// ----------------------------------------------------------------------
// STATE
// ----------------------------------------------------------------------
const state = {
  geometry: null,       // merged THREE.BufferGeometry, world-transformed, non-indexed
  printerId: 'p1s',
  laborTouchedByUser: false,
};

// ----------------------------------------------------------------------
// DOM refs
// ----------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const dropzone = el('dropzone');
const fileInput = el('fileInput');
const fileStatus = el('fileStatus');

const panelSetup = el('panel-setup');
const panelExtras = el('panel-extras');
const panelPackaging = el('panel-packaging');
const panelResults = el('panel-results');

const printerSelect = el('printerSelect');
const materialSelect = el('materialSelect');
const colorsRow = el('colorsRow');
const colorsInput = el('colorsInput');
const efficiencyHint = el('efficiencyHint');
const sizeTierRow = el('sizeTierRow');
const sizeTierSelect = el('sizeTierSelect');
const sizeTierHint = el('sizeTierHint');
const quantityInput = el('quantityInput');
const laborInput = el('laborInput');
const laborHint = el('laborHint');

const materialsTableBody = document.querySelector('#materialsTable tbody');
const packagingTableBody = document.querySelector('#packagingTable tbody');
const addMaterialRowBtn = el('addMaterialRow');
const addPackagingRowBtn = el('addPackagingRow');

const fitWarning = el('fitWarning');
const outDimensions = el('outDimensions');
const outMaterial = el('outMaterial');
const outTime = el('outTime');
const outOrientation = el('outOrientation');
const bdMaterial = el('bdMaterial');
const bdExtras = el('bdExtras');
const bdLabor = el('bdLabor');
const bdMachine = el('bdMachine');
const bdPackaging = el('bdPackaging');
const bdLanded = el('bdLanded');
const marginTiersEl = el('marginTiers');

// ----------------------------------------------------------------------
// FORMATTERS
// ----------------------------------------------------------------------
const fmtMoney = (n) => `$${n.toFixed(2)}`;
const fmtGrams = (n, unit) => `${n.toFixed(1)} ${unit}`;
const fmtHours = (h) => {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
};
const fmtMm = (n) => `${n.toFixed(0)}mm`;

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

/** Flattens any loaded object (single geometry, or a Group of meshes) into
 *  one non-indexed, world-transformed BufferGeometry for volume/area math. */
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

async function handleFile(file) {
  fileStatus.textContent = `Analyzing ${file.name}\u2026`;
  fileStatus.className = 'file-status busy';

  try {
    const geometry = await parseFile(file);
    const { volumeMm3 } = computeMeshStats(geometry);

    if (!isFinite(volumeMm3) || volumeMm3 <= 0) {
      fileStatus.textContent =
        `Loaded ${file.name}, but couldn\u2019t get a reliable volume from it (mesh may not be watertight). ` +
        `Estimates below may be off \u2014 double check, or fall back to manual quoting for this one.`;
      fileStatus.className = 'file-status warn';
    } else {
      const triCount = geometry.attributes.position.count / 3;
      fileStatus.textContent = `Loaded ${file.name} \u2014 ${triCount.toLocaleString()} triangles`;
      fileStatus.className = 'file-status ok';
    }

    state.geometry = geometry;
    state.laborTouchedByUser = false;

    [panelSetup, panelExtras, panelPackaging, panelResults].forEach((p) => (p.hidden = false));

    populateMaterialsForPrinter();
    applySizeTierSuggestion();
    recalculate();
  } catch (err) {
    fileStatus.textContent = err.message || 'Could not read that file.';
    fileStatus.className = 'file-status error';
    state.geometry = null;
  }
}

// ----------------------------------------------------------------------
// DROPZONE
// ----------------------------------------------------------------------
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
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
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
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
    if (!state.laborTouchedByUser) applyLaborDefault();
    if (state.geometry) recalculate();
  });
});

function currentPrinterCfg() {
  return CONFIG.printers[state.printerId];
}

function toggleRowsForPrinterType() {
  const isFdm = currentPrinterCfg().type === 'fdm';
  colorsRow.hidden = !isFdm;
  sizeTierRow.hidden = isFdm;
}

function populateMaterialsForPrinter() {
  const printerCfg = currentPrinterCfg();
  materialSelect.innerHTML = '';
  Object.keys(printerCfg.materials).forEach((key) => {
    const mat = printerCfg.materials[key];
    const opt = document.createElement('option');
    opt.value = key;
    const costLabel = printerCfg.type === 'fdm' ? `$${mat.costPerKg}/kg` : `$${mat.costPerLiter}/L`;
    opt.textContent = `${key} (${costLabel})`;
    materialSelect.appendChild(opt);
  });
  materialSelect.value = printerCfg.defaultMaterial;
  toggleRowsForPrinterType();
}

function applyLaborDefault() {
  const printerCfg = currentPrinterCfg();
  if (printerCfg.type === 'fdm') {
    laborInput.value = printerCfg.baseLaborMinutes;
    laborHint.textContent = `Default for ${printerCfg.name}`;
  } else {
    const tier = sizeTierSelect.value;
    laborInput.value = printerCfg.laborBySizeTier[tier];
    laborHint.textContent = `${tier[0].toUpperCase()}${tier.slice(1)} resin part default (wash/cure/support setup)`;
  }
}

function applySizeTierSuggestion() {
  if (!state.geometry) return;
  // Size tiers are about total resin needed (part + supports), regardless
  // of which printer is currently selected in the UI.
  const resinEstimate = estimateResin(state.geometry, CONFIG.printers.photon, CONFIG.resinEstimate);
  const volumeCm3 = resinEstimate.totalVolumeMm3 / 1000;
  const tier = sizeTierForVolume(volumeCm3, CONFIG.sizeTiers);
  sizeTierSelect.value = tier;
  sizeTierHint.textContent = `Suggested from est. resin needed (${(volumeCm3 / 1000).toFixed(2)} L) \u2014 override if needed`;
  if (!state.laborTouchedByUser) applyLaborDefault();
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

sizeTierSelect.addEventListener('change', () => {
  if (!state.laborTouchedByUser) applyLaborDefault();
  recalculate();
});

laborInput.addEventListener('input', () => {
  state.laborTouchedByUser = true;
  recalculate();
});

quantityInput.addEventListener('input', recalculate);
materialSelect.addEventListener('change', recalculate);

// ----------------------------------------------------------------------
// LINE-ITEM TABLES (hardware/extras + packaging)
// ----------------------------------------------------------------------
function createLineRow(tbody, defaults = { name: '', qty: 1, unitCost: 0 }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="row-name" placeholder="Item" value="${defaults.name}" /></td>
    <td><input type="number" class="row-qty" min="0" step="1" value="${defaults.qty}" /></td>
    <td><input type="number" class="row-cost" min="0" step="0.01" value="${defaults.unitCost}" /></td>
    <td><button type="button" class="row-remove" title="Remove">\u2715</button></td>
  `;
  tr.querySelectorAll('input').forEach((input) => input.addEventListener('input', recalculate));
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

// Seed packaging with a postage row, matching the spreadsheet's default layout.
createLineRow(packagingTableBody, { name: 'Postage', qty: 1, unitCost: 0 });

// ----------------------------------------------------------------------
// MAIN CALCULATION
// ----------------------------------------------------------------------
function recalculate() {
  if (!state.geometry) return;

  const printerCfg = currentPrinterCfg();
  const materialKey = materialSelect.value;
  const materialCfg = printerCfg.materials[materialKey];
  const isFdm = printerCfg.type === 'fdm';

  const estimate = isFdm
    ? estimateFDM(state.geometry, printerCfg, CONFIG.fdmEstimate)
    : estimateResin(state.geometry, printerCfg, CONFIG.resinEstimate);

  const volumeCm3 = estimate.totalVolumeMm3 / 1000;
  const gramsOrMl = volumeCm3 * (isFdm ? materialCfg.densityGcm3 : 1); // resin costed by volume (mL)
  const unitLabel = isFdm ? 'g' : 'mL';

  const efficiencyFactor = isFdm
    ? efficiencyFactorForColors(
        printerCfg.baseEfficiencyFactor,
        printerCfg.amsColorStep,
        Math.max(1, parseInt(colorsInput.value || '1', 10))
      )
    : printerCfg.baseEfficiencyFactor;

  const costPerKgOrLiter = isFdm ? materialCfg.costPerKg : materialCfg.costPerLiter;

  const quote = calculateQuote({
    gramsOrMl,
    costPerKgOrLiter,
    efficiencyFactor,
    quantity: Math.max(1, parseInt(quantityInput.value || '1', 10)),
    printHours: estimate.hours,
    machineCostPerHour: machineCostPerHour(printerCfg),
    laborMinutes: Math.max(0, parseFloat(laborInput.value || '0')),
    laborRatePerHour: CONFIG.pricing.laborRatePerHour,
    materialsExtra: readLineItems(materialsTableBody),
    packaging: readLineItems(packagingTableBody),
    repeatUnitEfficiency: CONFIG.pricing.repeatUnitEfficiency,
    safetyMargin: CONFIG.estimateSafetyMargin,
    marginTiers: CONFIG.pricing.marginTiers,
  });

  renderResults(estimate, gramsOrMl, unitLabel, quote);
}

function renderResults(estimate, gramsOrMl, unitLabel, quote) {
  fitWarning.hidden = estimate.fits;

  outDimensions.textContent = `${fmtMm(estimate.bbox.x)} \u00D7 ${fmtMm(estimate.bbox.y)} \u00D7 ${fmtMm(estimate.bbox.z)}`;
  outMaterial.textContent = fmtGrams(gramsOrMl, unitLabel);
  outTime.textContent = fmtHours(estimate.hours);
  outOrientation.textContent = estimate.orientationName;

  bdMaterial.textContent = fmtMoney(quote.printedPartTotalCost);
  bdExtras.textContent = fmtMoney(quote.extraMaterialsCost);
  bdLabor.textContent = fmtMoney(quote.totalLaborCost);
  bdMachine.textContent = fmtMoney(quote.machineCost);
  bdPackaging.textContent = fmtMoney(quote.totalPackagingCost);
  bdLanded.textContent = fmtMoney(quote.landedCost);

  marginTiersEl.innerHTML = '';
  quote.prices.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'margin-card';
    card.innerHTML = `<div class="margin-pct">${p.marginPercent.toFixed(0)}%</div><div class="margin-price">${fmtMoney(p.price)}</div>`;
    marginTiersEl.appendChild(card);
  });
}

// ----------------------------------------------------------------------
// INIT
// ----------------------------------------------------------------------
populateMaterialsForPrinter();
applyLaborDefault();
