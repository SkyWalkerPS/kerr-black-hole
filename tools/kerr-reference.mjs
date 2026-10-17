export function horizonRadius(spin) {
  return 1 + Math.sqrt(1 - spin * spin);
}

export function iscoRadius(spin) {
  const z1 = 1 + Math.cbrt(1 - spin * spin) * (Math.cbrt(1 + spin) + Math.cbrt(1 - spin));
  const z2 = Math.sqrt(3 * spin * spin + z1 * z1);
  return 3 + z2 - Math.sign(spin) * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

export function zamoCamera(spin, r, theta, phi) {
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const sigma = r * r + spin * spin * cosTheta * cosTheta;
  const delta = r * r - 2 * r + spin * spin;
  const bigA = (r * r + spin * spin) ** 2 - spin * spin * delta * sinTheta * sinTheta;
  const lapse = Math.sqrt((sigma * delta) / bigA);
  const frameDragOmega = (2 * spin * r) / bigA;
  const cylindricalRadius = Math.sqrt(bigA / sigma) * sinTheta;
  return {
    spin, r, theta, phi, sinTheta, cosTheta, sigma, delta, bigA, lapse, frameDragOmega, cylindricalRadius,
    sphereUnit: [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta],
    sphereThetaHat: [cosTheta * Math.cos(phi), cosTheta * Math.sin(phi), -sinTheta],
    spherePhiHat: [-Math.sin(phi), Math.cos(phi), 0],
  };
}

export function minoInitialState(camera, localDirection) {
  const { spin } = camera;
  const [dirR, dirTheta, dirPhi] = localDirection;
  const energy = -camera.lapse + camera.frameDragOmega * camera.cylindricalRadius * dirPhi;
  const angularMomentum = camera.cylindricalRadius * dirPhi;
  const thetaRate = Math.sqrt(camera.sigma) * dirTheta;
  const radialRate = Math.sqrt(camera.sigma * camera.delta) * dirR;
  const carterQ = thetaRate * thetaRate
    + camera.cosTheta ** 2 * ((camera.bigA / camera.sigma) * dirPhi * dirPhi - spin * spin * energy * energy);
  const azimuthalSpeed = Math.sqrt(camera.bigA / camera.sigma) * dirPhi;
  const m = [...camera.sphereUnit];
  const dm = [0, 1, 2].map((i) => thetaRate * camera.sphereThetaHat[i] + azimuthalSpeed * camera.spherePhiHat[i]);
  const kerrK = carterQ + (angularMomentum - spin * energy) ** 2;
  const aShift = spin * (spin * energy - angularMomentum);
  const constants = {
    spin, energy, angularMomentum, carterQ, kerrK, aShift,
    c0: 2 * energy * aShift - kerrK,
    c1: 3 * kerrK,
    c2: 2 * (aShift * aShift - spin * spin * kerrK),
    sphereSpeedSquared: carterQ + angularMomentum * angularMomentum,
    spinEnergySquared: spin * spin * energy * energy,
  };
  const state = { w: 1 / camera.r, dw: -radialRate / (camera.r * camera.r), m, dm, phiFd: 0, t: 0 };
  return { constants, state };
}

export function minoAccelerations(c, w, m) {
  const u = m[2];
  const ddw = w * (c.c0 + w * (c.c1 + w * c.c2));
  const radialPull = -c.sphereSpeedSquared - 2 * c.spinEnergySquared * u * u;
  const ddm = [radialPull * m[0], radialPull * m[1], radialPull * m[2] + c.spinEnergySquared * u];
  const deltaOverR2 = 1 - 2 * w + c.spin * c.spin * w * w;
  const inverseDelta = 1 / Math.max(deltaOverR2, 1e-5);
  const dPhiFd = c.spin * w * (2 * c.energy - c.spin * c.angularMomentum * w) * inverseDelta;
  const dTRegular = (2 * c.energy * (2 - c.spin * c.spin * w) + c.aShift * (1 + c.spin * c.spin * w * w)) * inverseDelta
    + c.spin * (c.angularMomentum - c.spin * c.energy * (1 - u * u));
  return { ddw, ddm, dPhiFd, dTRegular };
}

export function singularTimeIntegral(energy, h, w0, w1) {
  const safeW1 = Math.max(w1, 1e-6);
  const relativeChange = (safeW1 - w0) / w0;
  const logRatioOverDifference = Math.abs(relativeChange) < 1e-3
    ? (1 - relativeChange / 2 + (relativeChange * relativeChange) / 3) / w0
    : Math.log(safeW1 / w0) / (safeW1 - w0);
  return energy * h * (1 / (w0 * safeW1) + 2 * logRatioOverDifference);
}

export function rknStep(c, s, h) {
  const k1 = minoAccelerations(c, s.w, s.m);
  const halfH = 0.5 * h;
  const h2over8 = (h * h) / 8;
  const k2 = minoAccelerations(
    c,
    s.w + halfH * s.dw + h2over8 * k1.ddw,
    [0, 1, 2].map((i) => s.m[i] + halfH * s.dm[i] + h2over8 * k1.ddm[i]),
  );
  const h2over2 = 0.5 * h * h;
  const k3 = minoAccelerations(
    c,
    s.w + h * s.dw + h2over2 * k2.ddw,
    [0, 1, 2].map((i) => s.m[i] + h * s.dm[i] + h2over2 * k2.ddm[i]),
  );
  const h2over6 = (h * h) / 6;
  const hOver6 = h / 6;
  const next = {
    w: s.w + h * s.dw + h2over6 * (k1.ddw + 2 * k2.ddw),
    dw: s.dw + hOver6 * (k1.ddw + 4 * k2.ddw + k3.ddw),
    m: [0, 1, 2].map((i) => s.m[i] + h * s.dm[i] + h2over6 * (k1.ddm[i] + 2 * k2.ddm[i])),
    dm: [0, 1, 2].map((i) => s.dm[i] + hOver6 * (k1.ddm[i] + 4 * k2.ddm[i] + k3.ddm[i])),
    phiFd: s.phiFd + hOver6 * (k1.dPhiFd + 4 * k2.dPhiFd + k3.dPhiFd),
    t: 0,
    tRegularRate: [k1.dTRegular, k2.dTRegular, k3.dTRegular],
  };
  next.t = s.t + hOver6 * (k1.dTRegular + 4 * k2.dTRegular + k3.dTRegular) + singularTimeIntegral(c.energy, h, s.w, next.w);
  const length = Math.hypot(...next.m);
  next.m = next.m.map((x) => x / length);
  const radialPart = next.m[0] * next.dm[0] + next.m[1] * next.dm[1] + next.m[2] * next.dm[2];
  next.dm = next.dm.map((x, i) => x - radialPart * next.m[i]);
  return next;
}

export const DEFAULT_STEP_PARAMS = { angleNear: 0.1, angleFar: 0.35, nearW: 0.12, farW: 0.03, wSpan: 0.1, horizonGapFraction: 0.5, frameDragStepAngle: 0.25, maxSteps: 4000 };

export function minoStepSize(c, s, p) {
  const sphereSpeed = Math.sqrt(Math.max(c.sphereSpeedSquared + c.spinEnergySquared * s.m[2] * s.m[2], 0));
  const blend = Math.min(Math.max((s.w - p.farW) / (p.nearW - p.farW), 0), 1);
  const angle = p.angleFar + (p.angleNear - p.angleFar) * blend;
  const horizonW = 1 / horizonRadius(c.spin);
  const horizonApproach = Math.max(s.dw, 0) / (p.horizonGapFraction * Math.max(horizonW - s.w, 1e-4));
  const delta = 1 - 2 * s.w + c.spin * c.spin * s.w * s.w;
  const frameDragRate = Math.abs(c.spin * s.w * (2 * c.energy - c.spin * c.angularMomentum * s.w)) / Math.max(delta, 1e-4);
  const diskZoneW = 1 / (0.95 * iscoRadius(Math.max(c.spin, 0)));
  const diskZoneDrag = s.w < diskZoneW ? frameDragRate / p.frameDragStepAngle : 0;
  const rate = Math.max(sphereSpeed, Math.abs(s.dw) * angle / p.wSpan, Math.max(horizonApproach, diskZoneDrag, 1e-6) * angle);
  return angle / Math.max(rate, 1e-6);
}

function rotateAboutSpinAxis(v, angle) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return [v[0] * cosA - v[1] * sinA, v[0] * sinA + v[1] * cosA, v[2]];
}

export function traceMino(camera, localDirection, params = DEFAULT_STEP_PARAMS) {
  const { constants: c, state: start } = minoInitialState(camera, localDirection);
  const horizonW = 1 / (horizonRadius(camera.spin) * 1.003);
  let s = start;
  const crossings = [];
  for (let step = 1; step <= params.maxSteps; step++) {
    const h = minoStepSize(c, s, params);
    const next = rknStep(c, s, h);
    if ((s.m[2] > 0) !== (next.m[2] > 0)) {
      const fraction = s.m[2] / (s.m[2] - next.m[2]);
      const w = hermite(s.w, s.dw, next.w, next.dw, h, fraction);
      const mx = s.m[0] + (next.m[0] - s.m[0]) * fraction;
      const my = s.m[1] + (next.m[1] - s.m[1]) * fraction;
      const regularRate = next.tRegularRate[0] + (next.tRegularRate[1] - next.tRegularRate[0]) * Math.min(2 * fraction, 1);
      crossings.push({
        r: 1 / w,
        phi: Math.atan2(my, mx) + s.phiFd + (next.phiFd - s.phiFd) * fraction,
        t: s.t + regularRate * fraction * h + singularTimeIntegral(c.energy, fraction * h, s.w, w),
        dmz: s.dm[2] + (next.dm[2] - s.dm[2]) * fraction,
        step,
      });
    }
    if (next.w <= 0) {
      const fraction = s.w / (s.w - next.w);
      const m = [0, 1, 2].map((i) => s.m[i] + (next.m[i] - s.m[i]) * fraction);
      const length = Math.hypot(...m);
      const phiFd = s.phiFd + (next.phiFd - s.phiFd) * fraction;
      const direction = rotateAboutSpinAxis(m.map((x) => x / length), phiFd);
      return { outcome: 'escaped', direction, steps: step, crossings, constants: c, final: next };
    }
    if (next.w >= horizonW) return { outcome: 'captured', steps: step, crossings, constants: c, final: next };
    s = next;
  }
  return { outcome: 'maxsteps', steps: params.maxSteps, crossings, constants: c, final: s };
}

function hermite(p0, d0, p1, d1, h, f) {
  const f2 = f * f;
  const f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * p0 + (f3 - 2 * f2 + f) * h * d0 + (-2 * f3 + 3 * f2) * p1 + (f3 - f2) * h * d1;
}


function inverseMetric(spin, r, theta) {
  const sinTheta = Math.sin(theta);
  const sin2 = sinTheta * sinTheta;
  const cos2 = 1 - sin2;
  const sigma = r * r + spin * spin * cos2;
  const delta = r * r - 2 * r + spin * spin;
  const bigA = (r * r + spin * spin) ** 2 - spin * spin * delta * sin2;
  return {
    tt: -bigA / (sigma * delta),
    tphi: (-2 * spin * r) / (sigma * delta),
    phiphi: (delta - spin * spin * sin2) / (sigma * delta * sin2),
    rr: delta / sigma,
    thetatheta: 1 / sigma,
  };
}

function hamiltonian(spin, r, theta, p) {
  const g = inverseMetric(spin, r, theta);
  return 0.5 * (g.tt * p.t * p.t + 2 * g.tphi * p.t * p.phi + g.phiphi * p.phi * p.phi + g.rr * p.r * p.r + g.thetatheta * p.theta * p.theta);
}

function blDerivatives(spin, x, p) {
  const g = inverseMetric(spin, x.r, x.theta);
  const eps = 1e-6;
  const dHdr = (hamiltonian(spin, x.r * (1 + eps), x.theta, p) - hamiltonian(spin, x.r * (1 - eps), x.theta, p)) / (2 * x.r * eps);
  const dHdtheta = (hamiltonian(spin, x.r, x.theta + eps, p) - hamiltonian(spin, x.r, x.theta - eps, p)) / (2 * eps);
  return {
    x: {
      t: g.tt * p.t + g.tphi * p.phi,
      r: g.rr * p.r,
      theta: g.thetatheta * p.theta,
      phi: g.tphi * p.t + g.phiphi * p.phi,
    },
    p: { t: 0, r: -dHdr, theta: -dHdtheta, phi: 0 },
  };
}

function blAdd(x, p, dx, dp, h) {
  return [
    { t: x.t + h * dx.t, r: x.r + h * dx.r, theta: x.theta + h * dx.theta, phi: x.phi + h * dx.phi },
    { t: p.t, r: p.r + h * dp.r, theta: p.theta + h * dp.theta, phi: p.phi },
  ];
}

export function traceBoyerLindquist(camera, localDirection, { escapeRadius = 2e4, stepFactor = 0.002 } = {}) {
  const { spin } = camera;
  const [dirR, dirTheta, dirPhi] = localDirection;
  let x = { t: 0, r: camera.r, theta: camera.theta, phi: camera.phi };
  let p = {
    t: camera.lapse - camera.frameDragOmega * camera.cylindricalRadius * dirPhi,
    r: Math.sqrt(camera.sigma / camera.delta) * dirR,
    theta: Math.sqrt(camera.sigma) * dirTheta,
    phi: camera.cylindricalRadius * dirPhi,
  };
  const rStop = horizonRadius(spin) * 1.002;
  const initialH = hamiltonian(spin, x.r, x.theta, p);
  const crossings = [];
  for (let step = 0; step < 5e6; step++) {
    const previous = x;
    const h = stepFactor * Math.min(x.r * x.r, 50 * x.r) * Math.min(1, (x.r - rStop + 0.01) * 2);
    const k1 = blDerivatives(spin, x, p);
    const [x2, p2] = blAdd(x, p, k1.x, k1.p, h / 2);
    const k2 = blDerivatives(spin, x2, p2);
    const [x3, p3] = blAdd(x, p, k2.x, k2.p, h / 2);
    const k3 = blDerivatives(spin, x3, p3);
    const [x4, p4] = blAdd(x, p, k3.x, k3.p, h);
    const k4 = blDerivatives(spin, x4, p4);
    const combine = (key, a1, a2, a3, a4) => (a1[key] + 2 * a2[key] + 2 * a3[key] + a4[key]) / 6;
    x = {
      t: x.t + h * combine('t', k1.x, k2.x, k3.x, k4.x),
      r: x.r + h * combine('r', k1.x, k2.x, k3.x, k4.x),
      theta: x.theta + h * combine('theta', k1.x, k2.x, k3.x, k4.x),
      phi: x.phi + h * combine('phi', k1.x, k2.x, k3.x, k4.x),
    };
    p = { t: p.t, r: p.r + h * combine('r', k1.p, k2.p, k3.p, k4.p), theta: p.theta + h * combine('theta', k1.p, k2.p, k3.p, k4.p), phi: p.phi };
    if ((previous.theta > Math.PI / 2) !== (x.theta > Math.PI / 2)) {
      const fraction = (previous.theta - Math.PI / 2) / (previous.theta - x.theta);
      crossings.push({ r: previous.r + (x.r - previous.r) * fraction, phi: previous.phi + (x.phi - previous.phi) * fraction, t: previous.t + (x.t - previous.t) * fraction });
    }
    if (x.r < rStop) return { outcome: 'captured', steps: step, crossings };
    if (x.r > escapeRadius) {
      const velocity = blDerivatives(spin, x, p).x;
      const sinT = Math.sin(x.theta);
      const cosT = Math.cos(x.theta);
      const cosP = Math.cos(x.phi);
      const sinP = Math.sin(x.phi);
      const cartesianVelocity = [
        velocity.r * sinT * cosP + x.r * cosT * cosP * velocity.theta - x.r * sinT * sinP * velocity.phi,
        velocity.r * sinT * sinP + x.r * cosT * sinP * velocity.theta + x.r * sinT * cosP * velocity.phi,
        velocity.r * cosT - x.r * sinT * velocity.theta,
      ];
      const length = Math.hypot(...cartesianVelocity);
      return {
        outcome: 'escaped',
        direction: cartesianVelocity.map((v) => v / length),
        steps: step,
        crossings,
        hamiltonianDrift: hamiltonian(spin, x.r, x.theta, p) - initialH,
      };
    }
  }
  return { outcome: 'maxsteps', crossings };
}


export function bardeenShadowPoint(spin, photonOrbitRadius, thetaObserver) {
  const r = photonOrbitRadius;
  const xi = -(r ** 3 - 3 * r * r + spin * spin * r + spin * spin) / (spin * (r - 1));
  const eta = -(r ** 3) * (r ** 3 - 6 * r * r + 9 * r - 4 * spin * spin) / (spin * spin * (r - 1) ** 2);
  const alpha = -xi / Math.sin(thetaObserver);
  const betaSquared = eta + spin * spin * Math.cos(thetaObserver) ** 2 - xi * xi / Math.tan(thetaObserver) ** 2;
  return { xi, eta, alpha, betaSquared };
}

export function angleBetween(u, v) {
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return Math.atan2(Math.hypot(...cross), u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
}
