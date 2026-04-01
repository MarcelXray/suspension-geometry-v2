// ── Suspension Kinematics ─────────────────────────────────────────────────
// Port of SuspensionModel.cs — all units in mm

const sq = x => x * x;

function twoCircles(c1, r1, c2, r2, upper = true) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.sqrt(sq(dx) + sq(dy));
  if (d < 1e-9 || d > r1 + r2 + 1e-3 || d < Math.abs(r1 - r2) - 1e-3) return null;
  const a = (sq(r1) - sq(r2) + sq(d)) / (2 * d);
  const h = Math.sqrt(Math.max(0, sq(r1) - sq(a)));
  const mx = c1.x + a * dx / d, my = c1.y + a * dy / d;
  const p1 = { x: mx + h * dy / d, y: my - h * dx / d };
  const p2 = { x: mx - h * dy / d, y: my + h * dx / d };
  return upper ? (p1.y >= p2.y ? p1 : p2) : (p1.y < p2.y ? p1 : p2);
}

function lineIntersect(p1, d1, p2, d2) {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

export function instantCenter(side) {
  const d1 = { x: side.upperOuter.x - side.upperInner.x, y: side.upperOuter.y - side.upperInner.y };
  const d2 = { x: side.lowerOuter.x - side.lowerInner.x, y: side.lowerOuter.y - side.lowerInner.y };
  return lineIntersect(side.upperInner, d1, side.lowerInner, d2);
}

export function rollCenterHeight(side) {
  const ic = instantCenter(side);
  if (!ic) return null;
  const cp = { x: side.wheelCenter.x, y: 0 };
  const dir = { x: ic.x - cp.x, y: ic.y - cp.y };
  if (Math.abs(dir.x) < 1e-9) return null;
  return cp.y + (-cp.x / dir.x) * dir.y;
}

export function camberDeg(side) {
  return Math.atan2(side.upperOuter.x - side.lowerOuter.x, side.upperOuter.y - side.lowerOuter.y) * 180 / Math.PI;
}

function hubLocalOffset(p) {
  const udx = p.upperOuterX - p.lowerOuterX, udy = p.upperOuterY - p.lowerOuterY;
  const ul = Math.sqrt(sq(udx) + sq(udy));
  if (ul < 1e-9) return { along: 0, perp: 0 };
  const eUpX = udx / ul, eUpY = udy / ul;
  return {
    along: (p.halfTrack - p.lowerOuterX) * eUpX + (p.tireRadius - p.lowerOuterY) * eUpY,
    perp:  (p.halfTrack - p.lowerOuterX) * eUpY - (p.tireRadius - p.lowerOuterY) * eUpX
  };
}

function solveForAngle(uIn, lIn, uLen, lLen, upLen, along, perp, tL) {
  const lo = { x: lIn.x + lLen * Math.cos(tL), y: lIn.y + lLen * Math.sin(tL) };
  const uo = twoCircles(uIn, uLen, lo, upLen, true);
  if (!uo) return null;
  const udx = uo.x - lo.x, udy = uo.y - lo.y;
  const ul = Math.sqrt(sq(udx) + sq(udy));
  if (ul < 1e-9) return null;
  const eUpX = udx / ul, eUpY = udy / ul;
  return { lo, uo, wc: { x: lo.x + along * eUpX + perp * eUpY, y: lo.y + along * eUpY - perp * eUpX } };
}

function buildRight(upperInner, lowerInner, p) {
  const { upperArmLength: uLen, lowerArmLength: lLen, uprightLength: upLen } = p;
  const { along, perp } = hubLocalOffset(p);
  let tL = Math.atan2(p.lowerOuterY - p.lowerInnerY, p.lowerOuterX - p.lowerInnerX);
  for (let i = 0; i < 80; i++) {
    const r0 = solveForAngle(upperInner, lowerInner, uLen, lLen, upLen, along, perp, tL);
    if (!r0) break;
    const f = r0.wc.y - p.tireRadius;
    if (Math.abs(f) < 1e-9) break;
    const r1 = solveForAngle(upperInner, lowerInner, uLen, lLen, upLen, along, perp, tL + 1e-5);
    if (!r1) break;
    const df = (r1.wc.y - r0.wc.y) / 1e-5;
    if (Math.abs(df) < 1e-12) break;
    tL -= f / df;
  }
  const fin = solveForAngle(upperInner, lowerInner, uLen, lLen, upLen, along, perp, tL);
  if (!fin) return null;
  return { upperInner, lowerInner, upperOuter: fin.uo, lowerOuter: fin.lo, wheelCenter: fin.wc, tireRadius: p.tireRadius };
}

export function buildSide(upperInner, lowerInner, isRight, p) {
  if (isRight) return buildRight(upperInner, lowerInner, p);
  const r = buildRight({ x: -upperInner.x, y: upperInner.y }, { x: -lowerInner.x, y: lowerInner.y }, p);
  if (!r) return null;
  const fl = pt => ({ x: -pt.x, y: pt.y });
  return { upperInner, lowerInner, upperOuter: fl(r.upperOuter), lowerOuter: fl(r.lowerOuter), wheelCenter: fl(r.wheelCenter), tireRadius: r.tireRadius };
}

export function chassisInnerPivots(p, jounce, rollAngle) {
  const cy = (p.upperInnerY + p.lowerInnerY) / 2;
  const wcy = cy - jounce;
  const hwT = p.upperInnerX, hwB = p.lowerInnerX;
  const hhT = p.upperInnerY - cy, hhB = p.lowerInnerY - cy;
  const cos = Math.cos(rollAngle), sin = Math.sin(rollAngle);
  const rot = (lx, ly) => ({ x: lx * cos - ly * sin, y: wcy + lx * sin + ly * cos });
  return { rUI: rot(hwT, hhT), rLI: rot(hwB, hhB), lUI: rot(-hwT, hhT), lLI: rot(-hwB, hhB) };
}

export function deriveParams(s) {
  const chassisTop = s.rideH + s.chassisH;
  const upperInnerY = chassisTop + s.upperInnerYOffset;
  const lowerInnerY = chassisTop + s.lowerInnerYOffset;
  const dU = s.upperOuterY - upperInnerY;
  const dL = s.lowerOuterY - lowerInnerY;
  const upperOuterX = s.upperInnerX + Math.sqrt(Math.max(0, sq(s.upperArmLen) - sq(dU)));
  const lowerOuterX = s.lowerInnerX + Math.sqrt(Math.max(0, sq(s.lowerArmLen) - sq(dL)));
  const uprightLength = Math.sqrt(sq(upperOuterX - lowerOuterX) + sq(s.upperOuterY - s.lowerOuterY));
  return {
    upperInnerX: s.upperInnerX, upperInnerY,
    lowerInnerX: s.lowerInnerX, lowerInnerY,
    upperOuterX, upperOuterY: s.upperOuterY,
    lowerOuterX, lowerOuterY: s.lowerOuterY,
    halfTrack: s.halfTrack, tireRadius: s.tireRadius,
    upperArmLength: s.upperArmLen, lowerArmLength: s.lowerArmLen, uprightLength
  };
}

export function rcCurvePoints(settings) {
  const params = deriveParams(settings);
  return Array.from({ length: 61 }, (_, i) => {
    const j = -5 + 10 * i / 60;
    const { rUI, rLI } = chassisInnerPivots(params, j, 0);
    const side = buildSide(rUI, rLI, true, params);
    if (!side) return null;
    const rc = rollCenterHeight(side);
    return rc !== null ? { j, rc } : null;
  }).filter(Boolean);
}
