// ============================================================================
// GEOMETRY — mesh math. No real slicer here: this is the heuristic layer
// described in the README. Every constant it leans on lives in config.js.
// ============================================================================

import * as THREE from 'three';

/**
 * Walks every triangle of a (possibly indexed) BufferGeometry and calls
 * fn(v0, v1, v2) — three THREE.Vector3, already in local mesh space.
 */
function forEachTriangle(geometry, fn) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  const triCount = index ? index.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    if (index) {
      a.fromBufferAttribute(pos, index.getX(i * 3));
      b.fromBufferAttribute(pos, index.getX(i * 3 + 1));
      c.fromBufferAttribute(pos, index.getX(i * 3 + 2));
    } else {
      a.fromBufferAttribute(pos, i * 3);
      b.fromBufferAttribute(pos, i * 3 + 1);
      c.fromBufferAttribute(pos, i * 3 + 2);
    }
    fn(a, b, c);
  }
}

/**
 * Net solid volume (mm^3) and total surface area (mm^2) of a closed mesh,
 * via the signed-tetrahedron-volume method. Assumes the mesh is manifold
 * with outward-facing normals (true for the vast majority of print-ready
 * STL/OBJ/3MF files). Units follow whatever the source file used — this
 * app assumes millimeters, standard for 3D printing.
 */
function computeMeshStats(geometry) {
  let volume = 0;
  let area = 0;
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  forEachTriangle(geometry, (v0, v1, v2) => {
    volume += v0.dot(v1.clone().cross(v2)) / 6;
    e1.subVectors(v1, v0);
    e2.subVectors(v2, v0);
    cross.crossVectors(e1, e2);
    area += cross.length() * 0.5;
  });

  return { volumeMm3: Math.abs(volume), surfaceAreaMm2: area };
}

/**
 * Overhang-facing surface area (mm^2) once the mesh is rotated by `quat`.
 * Heuristic (see README): a triangle counts as overhang if its rotated
 * normal points within `thresholdDeg` of straight down.
 */
function computeOverhangArea(geometry, quat, thresholdDeg) {
  let overhangArea = 0;
  const down = new THREE.Vector3(0, 0, -1);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const rv0 = new THREE.Vector3();
  const rv1 = new THREE.Vector3();
  const rv2 = new THREE.Vector3();
  const thresholdRad = THREE.MathUtils.degToRad(thresholdDeg);

  forEachTriangle(geometry, (v0, v1, v2) => {
    rv0.copy(v0).applyQuaternion(quat);
    rv1.copy(v1).applyQuaternion(quat);
    rv2.copy(v2).applyQuaternion(quat);
    e1.subVectors(rv1, rv0);
    e2.subVectors(rv2, rv0);
    normal.crossVectors(e1, e2);
    const triArea = normal.length() * 0.5;
    if (triArea === 0) return;
    normal.normalize();
    const angleFromDown = normal.angleTo(down);
    if (angleFromDown <= thresholdRad) {
      overhangArea += triArea;
    }
  });

  return overhangArea;
}

/** Axis-aligned bounding box dimensions (mm) after rotating by `quat`. */
function boundingBoxAfterRotation(geometry, quat) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let first = true;

  forEachTriangle(geometry, (v0, v1, v2) => {
    [v0, v1, v2].forEach((p) => {
      v.copy(p).applyQuaternion(quat);
      if (first) {
        box.min.copy(v);
        box.max.copy(v);
        first = false;
      } else {
        box.expandByPoint(v);
      }
    });
  });

  const size = new THREE.Vector3();
  box.getSize(size);
  return { x: size.x, y: size.y, z: size.z };
}

/**
 * Tests a fixed set of axis-aligned "which face is down" candidate
 * orientations (the 6 faces of the bounding box) plus the mesh's original
 * orientation, and picks the one with the least overhang area. Ties broken
 * by lower print height (less material/time).
 *
 * This is a proxy for real auto-orientation algorithms, not a replacement —
 * see README.
 */
function findBestOrientation(geometry, overhangThresholdDeg) {
  const candidates = [
    { name: 'as-is', quat: new THREE.Quaternion() },
    { name: '+X down', quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) },
    { name: '-X down', quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2) },
    { name: '+Y down', quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2) },
    { name: '-Y down', quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2) },
    { name: 'flip (+Z down)', quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI) },
  ];

  let best = null;
  for (const cand of candidates) {
    const overhangAreaMm2 = computeOverhangArea(geometry, cand.quat, overhangThresholdDeg);
    const bbox = boundingBoxAfterRotation(geometry, cand.quat);
    const score = overhangAreaMm2 * 1000 + bbox.z; // overhang dominates, height tie-breaks
    if (!best || score < best.score) {
      best = { ...cand, overhangAreaMm2, bbox, score };
    }
  }
  return best;
}

/**
 * Checks whether `bbox` (mm) fits on `buildPlate` (mm), trying both the
 * as-computed footprint and a 90-degree swap of X/Y (rotating on the bed).
 */
function fitsOnPlate(bbox, buildPlate) {
  const marginMm = 2; // small clearance
  const fitsDirect =
    bbox.x + marginMm <= buildPlate.x &&
    bbox.y + marginMm <= buildPlate.y &&
    bbox.z + marginMm <= buildPlate.z;
  const fitsSwapped =
    bbox.y + marginMm <= buildPlate.x &&
    bbox.x + marginMm <= buildPlate.y &&
    bbox.z + marginMm <= buildPlate.z;
  return fitsDirect || fitsSwapped;
}

/**
 * Full FDM material + time estimate.
 * Returns { gramsBeforeEfficiency, hours, overhangAreaMm2, bbox, fits }
 */
function estimateFDM(geometry, printerCfg, fdmCfg) {
  const { volumeMm3, surfaceAreaMm2 } = computeMeshStats(geometry);
  const orient = findBestOrientation(geometry, fdmCfg.overhangThresholdDeg);
  const fits = fitsOnPlate(orient.bbox, printerCfg.buildPlate);

  // Shell volume: wall loops around the surface, plus top/bottom shells
  // across the bbox footprint.
  const shellVolumeMm3 = surfaceAreaMm2 * (fdmCfg.wallLoops * fdmCfg.nozzleWidthMm);
  const footprintMm2 = orient.bbox.x * orient.bbox.y;
  const topBottomVolumeMm3 =
    footprintMm2 * (fdmCfg.topBottomShellLayers * printerCfg.layerHeightMm) * 2;

  const remainingVolumeMm3 = Math.max(volumeMm3 - shellVolumeMm3 - topBottomVolumeMm3, 0);
  const infillVolumeMm3 = remainingVolumeMm3 * fdmCfg.infillPercent;

  const partVolumeMm3 = shellVolumeMm3 + topBottomVolumeMm3 + infillVolumeMm3;

  // Support material: overhang area x an assumed average support height.
  const supportVolumeMm3 =
    orient.overhangAreaMm2 * (orient.bbox.z * fdmCfg.supportVolumeFactor);

  const totalVolumeMm3 = partVolumeMm3 + supportVolumeMm3;

  // Print time: extrusion volume / flow rate, plus per-layer overhead.
  const numLayers = Math.ceil(orient.bbox.z / printerCfg.layerHeightMm);
  const printSeconds =
    totalVolumeMm3 / printerCfg.flowRateMm3PerSec +
    numLayers * printerCfg.perLayerOverheadSec;

  return {
    totalVolumeMm3,
    hours: printSeconds / 3600,
    bbox: orient.bbox,
    orientationName: orient.name,
    overhangAreaMm2: orient.overhangAreaMm2,
    fits,
  };
}

/**
 * Full resin material + time estimate.
 */
function estimateResin(geometry, printerCfg, resinCfg) {
  const { volumeMm3 } = computeMeshStats(geometry);
  // Resin printers cure layer-by-layer regardless of orientation choice in
  // the same way FDM does — orientation mainly affects supports/peel force,
  // which we approximate as a flat support fraction rather than re-running
  // the overhang search.
  const orient = findBestOrientation(geometry, 45);
  const fits = fitsOnPlate(orient.bbox, printerCfg.buildPlate);

  const supportVolumeMm3 = volumeMm3 * resinCfg.supportVolumeFraction;
  const totalVolumeMm3 = volumeMm3 + supportVolumeMm3;

  const numLayers = Math.ceil(orient.bbox.z / printerCfg.layerHeightMm);
  const printSeconds =
    numLayers * printerCfg.exposureSecPerLayer +
    numLayers * printerCfg.liftOverheadSecPerLayer;

  return {
    totalVolumeMm3,
    hours: printSeconds / 3600,
    bbox: orient.bbox,
    orientationName: orient.name,
    fits,
  };
}

/** Volume (cm3) -> size tier name, per CONFIG.sizeTiers. */
function sizeTierForVolume(volumeCm3, sizeTiers) {
  if (volumeCm3 <= sizeTiers.small.maxVolumeCm3) return 'small';
  if (volumeCm3 <= sizeTiers.medium.maxVolumeCm3) return 'medium';
  return 'large';
}

/**
 * Machine cost per hour, derived exactly like the spreadsheet's Adv. Inputs
 * tab: (capital cost/hr + electrical cost/hr) x buffer factor.
 */
function machineCostPerHour(printerCfg) {
  const totalInvestment = printerCfg.purchasePrice + printerCfg.additionalUpfrontCost;
  const lifetimeCost = totalInvestment + printerCfg.annualMaintenance * printerCfg.estimatedLifeYears;
  const uptimeHoursPerYear = 8760 * printerCfg.estimatedUptimePercent;
  const capitalCostPerHour = lifetimeCost / (uptimeHoursPerYear * printerCfg.estimatedLifeYears);
  const electricalCostPerHour = (printerCfg.avgPowerWatts / 1000) * printerCfg.electricityCostPerKwh;
  return (capitalCostPerHour + electricalCostPerHour) * printerCfg.costBufferFactor;
}

export {
  computeMeshStats,
  findBestOrientation,
  fitsOnPlate,
  estimateFDM,
  estimateResin,
  sizeTierForVolume,
  machineCostPerHour,
};
