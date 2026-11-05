// Captar malla — decodificador de capturas.
// Convierte lo que registra hook.js (bytes de atributos, índices, uniforms, bloques, texturas)
// en mallas con coordenadas reales. Funciona igual en el visor y en Node (pruebas).

// ------------------------------------------------------------------ lectura del archivo
export function parsePart(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[0] !== 0x43 || u8[1] !== 0x4D || u8[2] !== 0x41 || u8[3] !== 0x4C) throw new Error('No es una captura de Captar malla');
  const hlen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hlen)));
  let base = 12 + hlen; base = (base + 3) & ~3;
  const bin = (i) => {
    if (i === undefined || i === null || i < 0 || !header.bins[i]) return null;
    const [off, len] = header.bins[i];
    return u8.subarray(base + off, base + off + len);
  };
  return { header, bin };
}

// Archivo .cmal con varias partes (página + workers): "CMAP", nº de partes, tamaños y las partes seguidas
export function packFile(parts) {
  const head = new Uint8Array(8 + parts.length * 4);
  const dv = new DataView(head.buffer);
  head.set([0x43, 0x4D, 0x41, 0x50]); dv.setUint32(4, parts.length, true);
  parts.forEach((p, i) => dv.setUint32(8 + i * 4, p.byteLength, true));
  const out = new Uint8Array(head.length + parts.reduce((a, p) => a + p.byteLength, 0));
  out.set(head); let o = head.length;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}
export function unpackFile(u8) {
  if (u8[0] === 0x43 && u8[1] === 0x4D && u8[2] === 0x41 && u8[3] === 0x4C) return [u8]; // una sola parte
  if (!(u8[0] === 0x43 && u8[1] === 0x4D && u8[2] === 0x41 && u8[3] === 0x50)) throw new Error('El archivo no es una captura de Captar malla (.cmal)');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(4, true);
  const parts = []; let o = 8 + n * 4;
  for (let i = 0; i < n; i++) { const len = dv.getUint32(8 + i * 4, true); parts.push(u8.subarray(o, o + len)); o += len; }
  return parts;
}

// ------------------------------------------------------------------ matrices 4x4 (columnas, Float64)
export const M4 = {
  ident() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  inv(m) {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det || !isFinite(det)) return null;
    det = 1 / det;
    return [
      (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
      (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
      (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
      (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
    ];
  },
  tp(m, x, y, z, w = 1) {
    return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
  },
  transpose(m) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = m[r * 4 + c]; return o; },
  isAffine(m) { return Math.abs(m[3]) < 1e-9 && Math.abs(m[7]) < 1e-9 && Math.abs(m[11]) < 1e-9 && Math.abs(m[15] - 1) < 1e-6; },
  eq(a, b, eps = 1e-6) { for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > eps * Math.max(1, Math.abs(a[i]))) return false; return true; },
};

// ------------------------------------------------------------------ atributos
const T = { BYTE: 0x1400, UBYTE: 0x1401, SHORT: 0x1402, USHORT: 0x1403, INT: 0x1404, UINT: 0x1405, FLOAT: 0x1406, HALF: 0x140B, HALF_OES: 0x8D61, I2101010: 0x8D9F, UI2101010: 0x8368 };
function half(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
// Devuelve Float32Array con size componentes por elemento (n elementos)
export function decodeAttr(a, bytes) {
  const n = Math.floor(bytes.length / a.elem);
  const size = a.size;
  const out = new Float32Array(n * size);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const norm = a.norm && !a.integer;
  if (a.type === T.I2101010 || a.type === T.UI2101010) {
    const signed = a.type === T.I2101010;
    for (let i = 0; i < n; i++) {
      const v = dv.getUint32(i * 4, true);
      const parts = [v & 1023, (v >> 10) & 1023, (v >> 20) & 1023, (v >>> 30) & 3];
      for (let k = 0; k < size; k++) {
        let c = parts[k];
        const bits = k < 3 ? 10 : 2;
        if (signed && c >= (1 << (bits - 1))) c -= (1 << bits);
        if (norm) c = signed ? Math.max(c / ((1 << (bits - 1)) - 1), -1) : c / ((1 << bits) - 1);
        out[i * size + k] = c;
      }
    }
    return out;
  }
  const cb = { 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2 }[a.type] || 4;
  for (let i = 0; i < n; i++) {
    const base = i * a.elem;
    for (let k = 0; k < size; k++) {
      const o = base + k * cb;
      let c;
      switch (a.type) {
        case T.BYTE: c = dv.getInt8(o); if (norm) c = Math.max(c / 127, -1); break;
        case T.UBYTE: c = dv.getUint8(o); if (norm) c = c / 255; break;
        case T.SHORT: c = dv.getInt16(o, true); if (norm) c = Math.max(c / 32767, -1); break;
        case T.USHORT: c = dv.getUint16(o, true); if (norm) c = c / 65535; break;
        case T.INT: c = dv.getInt32(o, true); if (norm) c = Math.max(c / 2147483647, -1); break;
        case T.UINT: c = dv.getUint32(o, true); if (norm) c = c / 4294967295; break;
        case T.HALF: case T.HALF_OES: c = half(dv.getUint16(o, true)); break;
        default: c = dv.getFloat32(o, true);
      }
      out[i * size + k] = c;
    }
  }
  return out;
}

// ------------------------------------------------------------------ nombres
const clean = (s) => String(s || '').toLowerCase().replace(/\[\d+\]/g, '').split('.').pop().replace(/[^a-z0-9]/g, '');
function scorePosition(a) {
  const n = clean(a.name);
  let s = 0;
  if (/position|^pos\d*$|^apos\d*$|^inpos\d*$|^vpos$/.test(n)) s += 100;
  else if (/vertex|^vert$|^v$|^p$|^ap$/.test(n)) s += 60;
  if (/attribute0$|^inattribute0$/.test(n)) s += 40; // Unreal
  if (/normal|uv|texcoord|tex|color|colour|tangent|weight|joint|bone|index|^id|offset|scale|instance|matrix|world|origin|draped|extrude|corner|radii|edge|coverage|style|stipple|endcap|type/.test(n)) s -= 120;
  return s;
}
function scoreUV(a) {
  const n = clean(a.name);
  let s = 0;
  if (/^(a|in|v|i|attr)?(uv0?|texcoords?0?|texcoord0?|st|tc0?)$/.test(n)) s += 100;
  else if (/texcoord0|meshuv0|uv0|texcoords?$/.test(n)) s += 90;
  else if (/uv|texcoord|tex_coord|textureco/.test(n)) s += 50;
  if (/draped|layer|light|lm|detail|rect|index|atlas|endcap|stipple|uv[1-9]|texcoord[1-9]/.test(n)) s -= 60;
  return s;
}
function scoreColorAttr(a) {
  const n = clean(a.name);
  return /^(a|in|v)?(color|colour|rgba|col|color0|vertexcolor)$/.test(n) ? 100 : 0;
}
function scoreSampler(name) {
  const n = clean(name);
  let s = 0;
  if (/basecolor|albedo|diffuse|maintex|meshtexture|rastertexture|colormap|colortexture|baseMap/i.test(n)) s += 100;
  else if (/^(u|s)?(map|texture|tex|image|sampler)0?$|texture0|sampler0|^utexture$|^uimage$/.test(n)) s += 60;
  if (/normal|bump|rough|metal|spec|occlusion|^ao|aomap|emissive|emission|light|shadow|env|cube|depth|lut|brdf|noise|mask|alphamap|atmo|sky|inscatter|cloud|sun|star|stipple|endcap|glyph|font|atlas|dash|draped|transmission|thickness|sheen|clearcoat|iridescence|displacement|bloom|flare|dirt|starburst|ssao|reflect|refract/.test(n)) s -= 150;
  return s;
}
const MAT_RE = {
  model: (n) => !/view|proj|normal|inverse|inv|prev|previous|orig|light|shadow|texture|tex|uv|decode|bone|joint|skin|bind|clip|eye|camera/.test(n) &&
    (/(model|object|mesh|local|obj)(to|2)world|worldfrom(model|object|mesh|local)|objecttoworld|localtoworld/.test(n) || /^(u|m|g|czm)?(model|world)(matrix|mat|mtx|transform|xform)?$/.test(n) || n === 'matrixmodel' || n === 'czmmodel'),
  view: (n) => !/proj|model|inverse|inv|prev|light|shadow|normal|world(?!to)/.test(n) && (/^(u|m|g|czm)?view(matrix|mat|mtx)?$/.test(n) || n === 'matrixview' || /worldtoview|viewfromworld|worldtoeye|eyefromworld|^(u)?camera(matrix)?$/.test(n)),
  modelView: (n) => !/proj|normal|inverse|inv|prev|light|shadow|orig|draped/.test(n) && (/modelview|worldview|^(u|m)?mv(matrix|mat)?$|eyefrom(model|mesh|object)|(model|mesh|object)toeye/.test(n)),
  mvp: (n) => !/inverse|inv|prev|light|shadow|draped/.test(n) && (/modelviewproj|worldviewproj|^(u|m)?mvp(matrix)?$|projmodelview|projectionmodelview|clipfrom(model|mesh|object)|modelviewprojection/.test(n)),
  viewProj: (n) => !/inverse|inv|prev|light|shadow|model|world(?!to)|draped/.test(n) && (/viewproj|projview|^(u)?vp(matrix)?$|clipfromworld|worldtoclip/.test(n)),
  proj: (n) => !/inverse|inv|prev|light|shadow|model|view|draped/.test(n) && /^(u|m|g|czm)?proj(ection)?(matrix|mat|mtx)?$|^matrixprojection$/.test(n),
};

// Evaluador de expresiones enteras de #if (sin eval: las extensiones MV3 lo prohíben)
export function evalIntExpr(src) {
  const toks = String(src).match(/\d+(?:\.\d+)?|&&|\|\||==|!=|<=|>=|<<|>>|[-+*/%()!~<>&|^?:]/g) || [];
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const prec = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
  function unary() {
    const t = next();
    if (t === '(') { const v = ternary(); next(); return v; }
    if (t === '!') return unary() ? 0 : 1;
    if (t === '-') return -unary();
    if (t === '+') return +unary();
    if (t === '~') return ~unary();
    if (t !== undefined && /^\d/.test(t)) return parseFloat(t);
    throw new Error('expresión');
  }
  function binary(minP) {
    let l = unary();
    for (;;) {
      const op = peek(); const p = prec[op];
      if (!p || p < minP) return l;
      next();
      const r = binary(p + 1);
      switch (op) {
        case '||': l = (l || r) ? 1 : 0; break; case '&&': l = (l && r) ? 1 : 0; break;
        case '|': l = l | r; break; case '^': l = l ^ r; break; case '&': l = l & r; break;
        case '==': l = l === r ? 1 : 0; break; case '!=': l = l !== r ? 1 : 0; break;
        case '<': l = l < r ? 1 : 0; break; case '>': l = l > r ? 1 : 0; break; case '<=': l = l <= r ? 1 : 0; break; case '>=': l = l >= r ? 1 : 0; break;
        case '<<': l = l << r; break; case '>>': l = l >> r; break;
        case '+': l = l + r; break; case '-': l = l - r; break; case '*': l = l * r; break;
        case '/': l = r ? Math.trunc(l / r) : 0; break; case '%': l = r ? l % r : 0; break;
      }
    }
  }
  function ternary() {
    const c = binary(1);
    if (peek() === '?') { next(); const a = ternary(); next(); const b = ternary(); return c ? a : b; }
    return c;
  }
  const v = ternary();
  if (i < toks.length) throw new Error('sobra');
  return v;
}

// ------------------------------------------------------------------ preprocesador GLSL mínimo
// Resuelve #define/#ifdef/#if para saber qué rama del shader está activa.
export function preprocess(src) {
  const defs = new Map();
  const out = [];
  const stack = []; // {active, taken, parentActive}
  const lines = String(src || '').split(/\r?\n/);
  const active = () => stack.every((s) => s.active);
  const evalExpr = (expr) => {
    let e = expr.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    e = e.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (m, a, b) => (defs.has(a || b) ? ' 1 ' : ' 0 '));
    for (let i = 0; i < 4; i++) e = e.replace(/\b([A-Za-z_]\w*)\b/g, (m) => (defs.has(m) ? ' (' + (defs.get(m) || '1') + ') ' : ' 0 '));
    e = e.replace(/\b(\d+)[uU]\b/g, '$1');
    try { return !!evalIntExpr(e); } catch (er) { return false; }
  };
  for (const raw of lines) {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(raw);
    if (m) {
      const [, dir, rest] = m;
      if (dir === 'ifdef' || dir === 'ifndef') {
        const name = rest.trim().split(/\s+/)[0];
        const cond = dir === 'ifdef' ? defs.has(name) : !defs.has(name);
        const pa = active();
        stack.push({ active: pa && cond, taken: cond, pa });
        continue;
      }
      if (dir === 'if') { const pa = active(); const cond = pa && evalExpr(rest); stack.push({ active: cond, taken: cond, pa }); continue; }
      if (dir === 'elif') { const s = stack[stack.length - 1]; if (!s) continue; if (s.taken) s.active = false; else { const cond = evalExpr(rest); s.active = cond; s.taken = cond; } continue; }
      if (dir === 'else') { const s = stack[stack.length - 1]; if (!s) continue; s.active = !s.taken; s.taken = true; continue; }
      if (dir === 'endif') { stack.pop(); continue; }
      if (!active()) continue;
      if (dir === 'define') { const dm = /^(\w+)(?:\s+(.*))?$/.exec(rest.trim()); if (dm && !/\(/.test(dm[1])) defs.set(dm[1], (dm[2] || '').trim()); continue; }
      if (dir === 'undef') { defs.delete(rest.trim()); continue; }
      continue;
    }
    if (active()) out.push(raw);
  }
  return { code: out.join('\n').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), defs };
}

// ------------------------------------------------------------------ geodesia (WGS84)
const WGS_A = 6378137.0, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);
export function ecefToGeo(x, y, z) {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - WGS_E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat);
    const N = WGS_A / Math.sqrt(1 - WGS_E2 * s * s);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - WGS_E2 * N / (N + h)));
  }
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI, h };
}
export function geoToEcef(latDeg, lonDeg, h) {
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
  const s = Math.sin(lat), N = WGS_A / Math.sqrt(1 - WGS_E2 * s * s);
  return [(N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - WGS_E2) + h) * s];
}
// Matriz ECEF (metros) -> ENU local (metros; X este, Y norte, Z arriba) con origen en (lat, lon, h)
export function enuMatrix(latDeg, lonDeg, h) {
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
  const [ox, oy, oz] = geoToEcef(latDeg, lonDeg, h);
  const e = [-Math.sin(lon), Math.cos(lon), 0];
  const nn = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const u = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  // filas e, n, u ; traslación -R*o
  const R = [e[0], nn[0], u[0], 0, e[1], nn[1], u[1], 0, e[2], nn[2], u[2], 0, 0, 0, 0, 1];
  const t = M4.tp(R, -ox, -oy, -oz, 0);
  R[12] = t[0]; R[13] = t[1]; R[14] = t[2];
  return R;
}

// ENU sobre una esfera de radio EARTH_R (origen en la superficie de la esfera: Z = altitud)
export function sphereEnu(latDeg, lonDeg) {
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
  const u = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const e = [-Math.sin(lon), Math.cos(lon), 0];
  const nn = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const o = u.map((x) => x * EARTH_R);
  const R = [e[0], nn[0], u[0], 0, e[1], nn[1], u[1], 0, e[2], nn[2], u[2], 0, 0, 0, 0, 1];
  const t = M4.tp(R, -o[0], -o[1], -o[2], 0);
  R[12] = t[0]; R[13] = t[1]; R[14] = t[2];
  return R;
}

// ------------------------------------------------------------------ escena
const EARTH_R = 6371010; // radio con el que Google Earth normaliza su globo (sale en sus shaders)

export function buildScene(parts, opts = {}) {
  const warnings = [];
  const meshes = [];
  const textures = new Map();
  const groupsByKey = new Map();
  const draws = []; // registros enriquecidos

  // 1) preparar cada parte (página / worker)
  parts.forEach((part, pi) => {
    const { header, bin } = part;
    const progInfo = {};
    for (const [k, p] of Object.entries(header.programs || {})) progInfo[k] = analyseProgram(p);
    for (const t of header.textures || []) {
      if (t.bin === undefined || t.bin === null) continue;
      textures.set(pi + '/' + t.key, { key: pi + '/' + t.key, kind: t.kind, w: t.w, h: t.h, ifmt: t.ifmt, bytes: bin(t.bin) });
    }
    header.draws.forEach((d, di) => {
      const g = header.geoms[d.g];
      const pinfo = progInfo[d.p];
      if (!g || !pinfo) return;
      draws.push({ part: pi, pi: part, d, di, g, pinfo, pkey: pi + '/' + d.p });
    });
    if (header.truncated) warnings.push('La captura se cortó por exceso de llamadas de dibujo: puede faltar geometría.');
    if (header.errors && header.errors.length) warnings.push(`El gancho registró ${header.errors.length} incidencias leves durante la captura.`);
  });

  // 2) leer uniforms de cada dibujo y calcular su transformación
  for (const r of draws) {
    r.U = uniformReader(r);
    r.profile = r.pinfo.profile;
    r.tf = computeTransforms(r);
  }
  // matrices de vista por pasada (fb + fotograma), sacadas de dibujos con M y MV/MVP
  const passV = new Map(), passVP = new Map();
  for (const r of draws) {
    const pk = r.part + ':' + (r.d.fb || 0) + ':' + (r.d.f || 0);
    const M = r.tf.model;
    if (!M) continue;
    if (r.tf.modelView && !passV.has(pk)) { const iM = M4.inv(M); if (iM) passV.set(pk, M4.mul(r.tf.modelView, iM)); }
    if (r.tf.mvp && !passVP.has(pk)) { const iM = M4.inv(M); if (iM) passVP.set(pk, M4.mul(r.tf.mvp, iM)); }
  }
  for (const r of draws) {
    const t = r.tf;
    if (t.model) { t.kind = 'absoluta'; continue; }
    const pk = r.part + ':' + (r.d.fb || 0) + ':' + (r.d.f || 0);
    const V = t.view || passV.get(pk), VP = t.viewProj || passVP.get(pk);
    if (t.modelView && V) { const iV = M4.inv(V); if (iV) { t.model = M4.mul(iV, t.modelView); t.kind = 'absoluta'; continue; } }
    if (t.mvp && VP) { const iVP = M4.inv(VP); if (iVP) { t.model = M4.mul(iVP, t.mvp); t.kind = 'absoluta'; continue; } }
    if (t.mvp && t.proj && V) { const iPV = M4.inv(M4.mul(t.proj, V)); if (iPV) { t.model = M4.mul(iPV, t.mvp); t.kind = 'absoluta'; continue; } }
    const X = t.modelView || t.mvp || t.anyMatrix;
    if (X) { t.rel = X; t.relName = t.modelView ? 'MV' : t.mvp ? 'MVP' : ('?' + (t.anyName || '')); t.kind = 'relativa'; }
    else t.kind = 'ninguna';
  }

  // 3) grupos por programa y clasificación
  for (const r of draws) {
    let g = groupsByKey.get(r.pkey);
    if (!g) {
      g = { key: r.pkey, part: r.part, realm: r.pi.header.realm, program: r.pinfo, label: '', draws: 0, tris: 0, meshes: 0, textured: false, enabled: true, reason: '' };
      groupsByKey.set(r.pkey, g);
    }
    g.draws++;
  }

  // 4) referencias para los dibujos con transformación relativa (por tipo de matriz).
  // Se usa SIEMPRE la misma pieza de referencia (la mayor del primer fotograma) en todos los fotogramas,
  // para que lo grabado en varios fotogramas encaje.
  const relRefs = new Map();
  const refGeom = new Map(); // part:relName -> {g (índice de geometría), f (fotograma)}
  for (const r of draws) {
    if (r.tf.kind !== 'relativa') continue;
    const k = r.part + ':' + r.tf.relName;
    const cur = refGeom.get(k);
    const f = r.d.f || 0;
    if (!cur || f < cur.f || (f === cur.f && r.g.nVerts > cur.n)) refGeom.set(k, { g: r.d.g, f, n: r.g.nVerts });
  }
  for (const r of draws) {
    if (r.tf.kind !== 'relativa') continue;
    const rg = refGeom.get(r.part + ':' + r.tf.relName);
    const k = r.part + ':' + r.tf.relName + ':' + (r.d.f || 0);
    const cur = relRefs.get(k);
    if (r.d.g === rg.g) { if (!cur || cur.d.g !== rg.g) relRefs.set(k, r); }
    else if (!cur) relRefs.set(k, r);
    else if (cur.d.g !== rg.g && r.g.nVerts > cur.g.nVerts) relRefs.set(k, r);
  }
  const misaligned = [...relRefs.entries()].filter(([k, r]) => { const rg = refGeom.get(r.part + ':' + r.tf.relName); return r.d.g !== rg.g; }).length;
  if (misaligned) warnings.push(`En ${misaligned} fotograma(s) no aparece la pieza de referencia: lo grabado en ellos puede quedar desplazado.`);

  // 5) construir mallas
  const seen = new Set();
  let geoMode = null; // {type:'earth', center} o {type:'ecef'} …
  for (const r of draws) {
    const group = groupsByKey.get(r.pkey);
    const { d, g, pinfo } = r;
    if (!(d.m === 4 || d.m === 5 || d.m === 6)) { group.nonTri = (group.nonTri || 0) + 1; continue; }
    const pos = pinfo.posAttr ? g.attrs.find((a) => a.name === pinfo.posAttr) : null;
    if (!pos || pos.constant || pos.skipped) { group.noPos = true; continue; }
    const P = decodeAttr(pos, r.pi.bin(pos.bin));
    const psize = pos.size;
    const nV = g.nVerts;
    let UV = null, uvSize = 0;
    if (pinfo.uvAttr) { const ua = g.attrs.find((a) => a.name === pinfo.uvAttr); if (ua && !ua.constant && !ua.divisor && !ua.skipped) { UV = decodeAttr(ua, r.pi.bin(ua.bin)); uvSize = ua.size; } }
    else if (pinfo.uvFromPos) {
      const ci = { x: 0, y: 1, z: 2, w: 3 };
      const [a, b] = [ci[pinfo.uvFromPos[0]], ci[pinfo.uvFromPos[1]]];
      UV = new Float32Array(nV * 2); uvSize = 2;
      for (let i = 0; i < nV; i++) { UV[i * 2] = P[i * psize + a] || 0; UV[i * 2 + 1] = P[i * psize + b] || 0; }
    }
    let COL = null, colSize = 0;
    if (pinfo.colorAttr) { const ca = g.attrs.find((a) => a.name === pinfo.colorAttr); if (ca && !ca.constant && !ca.divisor && !ca.skipped) { COL = decodeAttr(ca, r.pi.bin(ca.bin)); colSize = ca.size; } }
    const idx = g.idx !== null && g.idx !== undefined ? new Uint32Array(r.pi.bin(g.idx).slice().buffer) : null;
    let tris = triangulate(d.m, idx, nV);

    // perfil Google Earth: escala ×255, máscara de octantes, UV escala/desplazamiento
    let posScale = 1;
    let mask = null;
    if (r.profile === 'gearth') {
      if (pos.norm) posScale = 255;
      const om = r.tf.octantMask;
      if (om !== undefined && psize >= 4) {
        mask = new Uint8Array(nV);
        for (let i = 0; i < nV; i++) {
          const w = P[i * psize + 3];
          if (!w) { mask[i] = 1; continue; }
          const fm = om / (w * 2);
          mask[i] = Math.floor((fm - Math.floor(fm)) * 2) > 0 ? 1 : 0;
        }
      }
    }
    if (mask) tris = tris.filter3((a, b, c) => mask[a] && mask[b] && mask[c]);
    if (!tris.length) continue;

    // UV transform
    const uvT = r.tf.uvTransform;

    // instancias
    const instMats = r.tf.instances || [null];
    for (let ii = 0; ii < instMats.length; ii++) {
      let T;
      if (r.tf.kind === 'absoluta') T = instMats[ii] ? M4.mul(r.tf.model, instMats[ii]) : r.tf.model;
      else if (r.tf.kind === 'relativa') {
        const ref = relRefs.get(r.part + ':' + r.tf.relName + ':' + (d.f || 0));
        if (ref && !ref.tf.relInv) {
          // Referencia sin escala: si es una MV (afín), se quita la escala del objeto de referencia
          let X = ref.tf.rel;
          if (M4.isAffine(X)) {
            const s = [0, 1, 2].map((c) => Math.hypot(X[c * 4], X[c * 4 + 1], X[c * 4 + 2]) || 1);
            X = X.slice(); for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) X[c * 4 + k] /= s[c];
          }
          ref.tf.relInv = M4.inv(X);
        }
        const iR = ref ? ref.tf.relInv : null;
        const X = instMats[ii] ? M4.mul(r.tf.rel, instMats[ii]) : r.tf.rel;
        T = iR ? M4.mul(iR, X) : X;
      } else T = instMats[ii] || M4.ident();
      // quitar repetidos (misma geometría y misma posición: pasadas de sombras, profundidad, etc.).
      // En capturas de área cada fotograma es otra posición de cámara: se compara solo dentro del fotograma.
      const dk = r.part + ':' + (opts.area ? (d.f || 0) + ':' : '') + d.g + ':' + (r.tf.octantMask !== undefined ? 'o' + r.tf.octantMask + ':' : '') + T.map((x) => (Math.abs(x) < 1e-6 ? '0' : x.toPrecision(5))).join(',');
      if (seen.has(dk)) { group.dupes = (group.dupes || 0) + 1; continue; }
      seen.add(dk);

      const out = new Float64Array(nV * 3);
      const persp = !M4.isAffine(T);
      for (let i = 0; i < nV; i++) {
        const x = P[i * psize] * posScale, y = (psize > 1 ? P[i * psize + 1] : 0) * posScale, z = (psize > 2 ? P[i * psize + 2] : 0) * posScale;
        if (!persp) {
          out[i * 3] = T[0] * x + T[4] * y + T[8] * z + T[12];
          out[i * 3 + 1] = T[1] * x + T[5] * y + T[9] * z + T[13];
          out[i * 3 + 2] = T[2] * x + T[6] * y + T[10] * z + T[14];
        } else {
          const v = M4.tp(T, x, y, z, 1); const w = v[3] || 1;
          out[i * 3] = v[0] / w; out[i * 3 + 1] = v[1] / w; out[i * 3 + 2] = v[2] / w;
        }
      }
      let uvs = null;
      if (UV) {
        uvs = new Float32Array(nV * 2);
        for (let i = 0; i < nV; i++) {
          let u = UV[i * uvSize], v = UV[i * uvSize + 1];
          if (uvT) {
            if (uvT.kind === 'sb') { u = u * uvT.v[0] + uvT.v[2]; v = v * uvT.v[1] + uvT.v[3]; }
            else if (uvT.kind === 'osb') { u = (u + uvT.v[0]) * uvT.v[2]; v = (v + uvT.v[1]) * uvT.v[3]; }
            else if (uvT.kind === 'm3') { const m = uvT.v; const uu = m[0] * u + m[3] * v + m[6]; const vv = m[1] * u + m[4] * v + m[7]; u = uu; v = vv; }
          }
          uvs[i * 2] = u; uvs[i * 2 + 1] = v;
        }
      }
      let colors = null;
      if (COL && !r.tf.texKey) {
        colors = new Float32Array(nV * 4);
        for (let i = 0; i < nV; i++) for (let k = 0; k < 4; k++) colors[i * 4 + k] = k < colSize ? COL[i * colSize + k] : 1;
      }
      const texKey = r.tf.texKey ? r.part + '/' + r.tf.texKey : null;
      meshes.push({
        id: meshes.length, group: r.pkey, drawIndex: r.di, part: r.part, frame: d.f || 0, fb: d.fb || 0,
        name: `${pinfo.short || 'malla'}_${String(meshes.length).padStart(4, '0')}`,
        world: out, indices: Uint32Array.from(tris), uvs: texKey ? uvs : (uvs || null), texKey: texKey && textures.has(texKey) ? texKey : null,
        color: r.tf.color || null, colors, transformKind: r.tf.kind, profile: r.profile,
        depthTest: !!d.dt, nVerts: nV, nTris: tris.length / 3,
        gc: r.profile === 'gearth' ? r.tf.globeCenter || null : undefined,
        gkey: r.part + ':' + d.g,
      });
      group.meshes++; group.tris += tris.length / 3;
      if (texKey && textures.has(texKey)) group.textured = true;
      if (r.profile === 'gearth' && !geoMode && r.tf.globeCenter) geoMode = { type: 'gearth' };
    }
  }

  // 6) sistema de coordenadas de salida
  if (!geoMode && meshes.some((m) => m.profile === 'gearth')) geoMode = { type: 'gearth' };
  const info = { warnings, frame: 'mundo', geo: null, origin: [0, 0, 0], units: 'unidades del visor', upAxis: 'Y' };
  if (geoMode && geoMode.type === 'gearth') convertEarth(meshes, draws, info, opts);
  else detectEcef(meshes, info);
  // captura de un área: cada fotograma aporta solo los triángulos de su celda (sin huecos ni repetidos)
  if (opts.area && info.frame === 'enu') {
    registerFrames(meshes, info);
    clipToCells(meshes, opts.area, info);
    for (let i = meshes.length - 1; i >= 0; i--) if (!meshes[i].indices.length) meshes.splice(i, 1);
    meshes.forEach((m, i) => { m.id = i; m.name = `earth_${String(i).padStart(4, '0')}`; });
    for (const g of groupsByKey.values()) { g.meshes = 0; g.tris = 0; }
    for (const m of meshes) { const g = groupsByKey.get(m.group); if (g) { g.meshes++; g.tris += m.nTris; } }
  }
  // origen: centro de la caja (en XY) y suelo en Z/Y mínimo; las coordenadas se guardan relativas
  finalizeMeshes(meshes, info);

  // 7) clasificar grupos para la selección por defecto
  markSmall(meshes);
  const groups = [...groupsByKey.values()];
  for (const g of groups) classifyGroup(g, meshes);
  groups.sort((a, b) => (b.enabled - a.enabled) || (b.tris - a.tris));
  return { meshes, groups, textures, info };
}

// Triángulos como array normal de índices locales; filter3 para filtrar ternas
function triangulate(mode, idx, nV) {
  const out = [];
  const get = idx ? (i) => idx[i] : (i) => i;
  const n = idx ? idx.length : nV;
  if (mode === 4) {
    for (let i = 0; i + 2 < n; i += 3) { const a = get(i), b = get(i + 1), c = get(i + 2); if (a === 0xFFFFFFFF || b === 0xFFFFFFFF || c === 0xFFFFFFFF) continue; if (a !== b && b !== c && a !== c) out.push(a, b, c); }
  } else if (mode === 5) {
    let start = 0;
    for (let i = 0; i <= n; i++) {
      if (i === n || get(i) === 0xFFFFFFFF) {
        for (let k = start; k + 2 < i; k++) {
          const a = get(k), b = get(k + 1), c = get(k + 2);
          if (a === b || b === c || a === c) continue;
          if ((k - start) % 2 === 0) out.push(a, b, c); else out.push(b, a, c);
        }
        start = i + 1;
      }
    }
  } else if (mode === 6) {
    let start = 0;
    for (let i = 0; i <= n; i++) {
      if (i === n || get(i) === 0xFFFFFFFF) {
        for (let k = start + 1; k + 1 < i; k++) { const a = get(start), b = get(k), c = get(k + 1); if (a !== b && b !== c && a !== c) out.push(a, b, c); }
        start = i + 1;
      }
    }
  }
  out.filter3 = function (fn) { const r = []; for (let i = 0; i + 2 < this.length; i += 3) if (fn(this[i], this[i + 1], this[i + 2])) r.push(this[i], this[i + 1], this[i + 2]); r.filter3 = out.filter3; return r; };
  return out;
}

// ------------------------------------------------------------------ análisis de programas
function analyseProgram(p) {
  const info = { raw: p, attribs: p.attribs, uniforms: p.uniforms, blocks: p.blocks };
  const pre = preprocess(p.vs || '');
  info.vsCode = pre.code;
  info.defs = pre.defs;
  const uniNames = new Set(p.uniforms.map((u) => u.base));
  const has = (n) => uniNames.has(n);
  const attrs = p.attribs.filter((a) => !/^gl_/.test(a.name));
  // perfil
  if (has('uMeshToWorldMatrix') && has('uModelviewMatrix') && attrs.some((a) => a.name === 'aPosition')) info.profile = 'gearth';
  else if (p.uniforms.some((u) => /worldFromModelMatrix$/.test(u.name))) info.profile = 'filament';
  else info.profile = 'generic';
  // atributos
  const best = (list, score) => { let b = null, bs = 0; for (const a of list) { const s = score(a); if (s > bs) { bs = s; b = a; } } return b; };
  let pos = best(attrs, scorePosition);
  info.posGuessed = false;
  if (!pos) {
    // sin nombre reconocible: primer vec3/vec4 (o vec2). Se marca como dudoso.
    pos = attrs.find((a) => [0x8B51, 0x8B52].includes(a.type)) || attrs.find((a) => a.type === 0x8B50) || null;
    info.posGuessed = !!pos;
  }
  info.posAttr = pos ? pos.name : null;
  info.posIs2D = pos ? pos.type === 0x8B50 : false;
  const uv = best(attrs.filter((a) => a !== pos), scoreUV);
  info.uvAttr = uv ? uv.name : null;
  // UV calculada en el shader a partir de la posición (p. ej. teselas de Google Maps: textureCoord = mesh_position.xz)
  if (!info.uvAttr && pos) {
    const pn = pos.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp('\\.x\\s*=\\s*' + pn + '\\.([xyzw]{2})\\.x\\s*;[\\s\\S]{0,300}?\\.y\\s*=\\s*' + pn + '\\.\\1\\.y').exec(pre.code);
    if (m) info.uvFromPos = m[1];
  }
  const col = best(attrs.filter((a) => a !== pos && a !== uv), scoreColorAttr);
  info.colorAttr = col ? col.name : null;
  // sampler de color
  const samplers = p.uniforms.filter((u) => u.type === 0x8B5E);
  let sb = null, ss = 0;
  for (const s of samplers) { const sc = scoreSampler(s.base); if (sc > ss) { ss = sc; sb = s; } }
  if (!sb && samplers.length === 1 && scoreSampler(samplers[0].base) > -100) sb = samplers[0];
  if (info.profile === 'gearth' && samplers.some((s) => s.base === 'uMeshTexture')) sb = samplers.find((s) => s.base === 'uMeshTexture');
  info.colorSampler = sb ? sb.base : null;
  // interfaz 2D (Skia, etc.)
  info.isSkia = has('sk_RTAdjust');
  // patrón de transformación de UV en el shader
  info.uvPattern = info.uvAttr ? detectUVPattern(info.vsCode, info.uvAttr, p.uniforms) : null;
  // nombre corto para las mallas
  info.short = info.profile === 'gearth' ? 'earth' : info.profile === 'filament' ? 'filament' : 'malla';
  return info;
}

function detectUVPattern(code, attr, uniforms) {
  const vec4s = new Set(uniforms.filter((u) => u.type === 0x8B52).map((u) => u.base.split('.').pop()));
  // alias de un salto: vec2 x = attr;
  const names = [attr];
  const re = new RegExp('(?:vec[234]|highp\\s+vec2|mediump\\s+vec2)?\\s*(\\w+)\\s*=\\s*' + attr + '(?:\\.xy)?\\s*;', 'g');
  let m; while ((m = re.exec(code))) if (m[1] !== attr) names.push(m[1]);
  for (const n of names) {
    let r = new RegExp('\\b' + n + '(?:\\.xy)?\\s*\\*\\s*(\\w+)\\.xy\\s*\\+\\s*(\\w+)\\.zw').exec(code);
    if (r && r[1] === r[2] && vec4s.has(r[1])) return { kind: 'sb', uniform: r[1] };
    r = new RegExp('\\(\\s*' + n + '(?:\\.xy)?\\s*\\+\\s*(\\w+)\\.xy\\s*\\)\\s*\\*\\s*(\\w+)\\.zw').exec(code);
    if (r && r[1] === r[2] && vec4s.has(r[1])) return { kind: 'osb', uniform: r[1] };
  }
  if (uniforms.some((u) => u.base === 'mapTransform' && u.type === 0x8B5B)) return { kind: 'm3', uniform: 'mapTransform' };
  if (uniforms.some((u) => u.base === 'uvTransform' && u.type === 0x8B5B) && /uvTransform/.test(code)) return { kind: 'm3', uniform: 'uvTransform' };
  return null;
}

// ------------------------------------------------------------------ uniforms de un dibujo
function uniformReader(r) {
  const { d, pi, pinfo } = r;
  const vals = pi.header.values;
  const byBase = new Map(pinfo.uniforms.map((u) => [u.base, u]));
  const blockBytes = {};
  if (d.b) for (const [name, bi] of Object.entries(d.b)) blockBytes[name] = pi.bin(bi);
  const blockName = (u) => (pinfo.blocks.find((b) => b.index === u.block) || {}).name;
  function readBlockMember(u) {
    const bytes = blockBytes[blockName(u)];
    if (!bytes) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const f = (o) => (o + 4 <= bytes.length ? dv.getFloat32(o, true) : 0);
    const cols = { 0x8B5A: 2, 0x8B5B: 3, 0x8B5C: 4 }[u.type];
    if (cols) {
      const out = [];
      for (let c = 0; c < cols; c++) for (let rr = 0; rr < cols; rr++) out.push(f(u.offset + (u.rowMajor ? rr * u.matrixStride + c * 4 : c * u.matrixStride + rr * 4)));
      return out;
    }
    const n = u.comps || 1;
    const out = [];
    const cnt = Math.max(1, u.size || 1);
    for (let k = 0; k < cnt; k++) for (let i = 0; i < n; i++) out.push(f(u.offset + k * (u.arrayStride || 0) + i * 4));
    return out;
  }
  return {
    get(base) {
      const u = byBase.get(base);
      if (!u) return null;
      if (u.block >= 0) return readBlockMember(u);
      const id = d.u ? d.u[base] : undefined;
      if (id === undefined) return null;
      const v = vals[id];
      if (!v || !v.d) return null;
      if (v.tr && u.comps === 16) return M4.transpose(v.d);
      return v.d;
    },
    find(pred) { return pinfo.uniforms.filter((u) => pred(u)); },
  };
}

// ------------------------------------------------------------------ transformaciones de un dibujo
function computeTransforms(r) {
  const { d, g, pinfo, U } = r;
  const tf = {};
  const mat4s = pinfo.uniforms.filter((u) => u.type === 0x8B5C && (u.size || 1) === 1);
  const get = (u) => { const v = U.get(u.base); return v && v.length >= 16 && v.slice(0, 16).every(isFinite) ? v.slice(0, 16).map(Number) : null; };
  const pick = (test) => { for (const u of mat4s) { if (test(clean(u.base))) { const v = get(u); if (v) return { v, name: u.base }; } } return null; };

  if (r.profile === 'gearth') {
    const m = U.get('uMeshToWorldMatrix');
    if (m && m.length >= 16) {
      const M = m.slice(0, 16).map(Number);
      tf.octantMask = M[15];
      M[3] = 0; M[7] = 0; M[11] = 0; M[15] = 1;
      tf.model = M;
    }
    const mv = U.get('uModelviewMatrix'); if (mv) tf.view = mv.slice(0, 16).map(Number);
    const wo = U.get('uWorldOriginInEye');
    if (wo && tf.view) { const iV = M4.inv(tf.view); if (iV) { const c = M4.tp(iV, wo[0], wo[1], wo[2], 1); tf.globeCenter = [c[0] / (c[3] || 1), c[1] / (c[3] || 1), c[2] / (c[3] || 1)]; } }
    const sb = U.get('uTexCoordScaleBias'); if (sb) tf.uvTransform = { kind: 'sb', v: sb.map(Number) };
  } else if (r.profile === 'filament') {
    // ObjectUniforms.a[i].worldFromModelMatrix, i = gl_InstanceID
    const members = pinfo.uniforms.filter((u) => /worldFromModelMatrix$/.test(u.name)).sort((a, b) => (a.offset || 0) - (b.offset || 0));
    const mats = members.map((u) => U.get(u.base)).filter((v) => v && v.length >= 16).map((v) => v.slice(0, 16).map(Number));
    if (mats.length) {
      tf.model = mats[0];
      const nInst = Math.max(1, d.ic || 1);
      if (nInst > 1 && mats.length > 1) {
        // cada instancia usa su propia matriz de mundo
        tf.instances = [];
        const inv0 = M4.inv(mats[0]);
        for (let i = 0; i < Math.min(nInst, mats.length); i++) tf.instances.push(inv0 ? M4.mul(inv0, mats[i]) : null);
      }
    }
  } else {
    const mm = pick(MAT_RE.model); if (mm) { tf.model = mm.v; tf.modelName = mm.name; }
    const mv = pick(MAT_RE.modelView); if (mv) tf.modelView = mv.v;
    const mvp = pick(MAT_RE.mvp); if (mvp) tf.mvp = mvp.v;
    const v = pick(MAT_RE.view); if (v) tf.view = v.v;
    const vp = pick(MAT_RE.viewProj); if (vp) tf.viewProj = vp.v;
    const p = pick(MAT_RE.proj); if (p) tf.proj = p.v;
    if (!tf.model && !tf.modelView && !tf.mvp) {
      // cualquier otra mat4 que no sea proyección ni vista
      for (const u of mat4s) {
        const n = clean(u.base);
        if (MAT_RE.proj(n) || MAT_RE.view(n) || MAT_RE.viewProj(n) || /texture|uv|tex|light|shadow|bone|inverse|inv|prev|normal|decode|color/.test(n)) continue;
        const val = get(u); if (val) { tf.anyMatrix = val; tf.anyName = u.base; break; }
      }
    }
    // matrices de decodificación (p. ej. xeokit: positionsDecodeMatrix)
    const dec = mat4s.find((u) => /positionsdecode|decodematrix|dequant/.test(clean(u.base)));
    if (dec) { const dv = get(dec); if (dv) { if (tf.model) tf.model = M4.mul(tf.model, dv); else if (tf.modelView) tf.modelView = M4.mul(tf.modelView, dv); else if (tf.mvp) tf.mvp = M4.mul(tf.mvp, dv); } }
    // instancias (three.js instanceMatrix, Babylon world0..3, PlayCanvas instance_line1..4)
    tf.instances = instanceMatrices(r);
    // transformación de UV
    if (pinfo.uvPattern) { const val = U.get(pinfo.uvPattern.uniform); if (val) tf.uvTransform = { kind: pinfo.uvPattern.kind, v: val.map(Number) }; }
  }
  // textura y color
  if (pinfo.colorSampler && d.t && d.t[pinfo.colorSampler]) tf.texKey = d.t[pinfo.colorSampler];
  const colU = pinfo.uniforms.find((u) => (u.type === 0x8B51 || u.type === 0x8B52) && /^(u|m)?(diffuse|albedo|basecolor|basecolorfactor|color|colour|materialdiffuse|vdiffusecolor|valbedocolor|diffusecolor|albedocolor)$/.test(clean(u.base)));
  if (colU) { const c = U.get(colU.base); if (c && c.slice(0, 3).every((x) => x >= 0 && x <= 1.5)) tf.color = [c[0], c[1], c[2], c.length > 3 ? c[3] : 1]; }
  return tf;
}

function instanceMatrices(r) {
  const { d, g } = r;
  const nInst = Math.max(1, d.ic || 1);
  if (nInst <= 1) return null;
  const inst = g.attrs.filter((a) => a.divisor && !a.constant && !a.skipped);
  if (!inst.length) return null;
  const dec = (a) => decodeAttr(a, r.pi.bin(a.bin));
  // mat4 como atributo: name#0..#3
  const groups = new Map();
  for (const a of inst) {
    let m = /^(.*)#(\d)$/.exec(a.name), base, col;
    if (m) { base = m[1]; col = +m[2]; }
    else if ((m = /^(.*?)(\d)$/.exec(a.name)) && a.size === 4) { base = m[1]; col = +m[2]; }
    else continue;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({ a, col });
  }
  for (const [base, cols] of groups) {
    if (cols.length < 3) continue;
    cols.sort((x, y) => x.col - y.col);
    const data = cols.map((c) => ({ v: dec(c.a), size: c.a.size, div: c.a.divisor }));
    const out = [];
    for (let i = 0; i < nInst; i++) {
      const M = M4.ident();
      for (let c = 0; c < Math.min(4, data.length); c++) {
        const e = Math.floor(i / data[c].div);
        for (let k = 0; k < Math.min(4, data[c].size); k++) M[c * 4 + k] = data[c].v[e * data[c].size + k];
      }
      if (cols.length === 3) { /* matriz 4x3 (PlayCanvas/Babylon a veces): completar */ }
      out.push(M);
    }
    return out;
  }
  // desplazamiento por instancia (vec3 llamado offset/instancePosition…)
  const off = inst.find((a) => a.size >= 3 && /offset|instanceposition|instancepos|translation|ipos/.test(clean(a.name)));
  if (off) {
    const v = dec(off); const out = [];
    for (let i = 0; i < nInst; i++) { const e = Math.floor(i / off.divisor); const M = M4.ident(); M[12] = v[e * off.size]; M[13] = v[e * off.size + 1]; M[14] = v[e * off.size + 2]; out.push(M); }
    return out;
  }
  return null;
}

// ------------------------------------------------------------------ coordenadas geográficas
function convertEarth(meshes, draws, info, opts = {}) {
  // Centro del globo en coordenadas "mundo" de Earth (sale de uWorldOriginInEye); unidades: radios terrestres.
  // Cada dibujo trae el suyo (m.gc): Earth puede mover su origen interno cuando la cámara se desplaza.
  const r0 = draws.find((r) => r.profile === 'gearth' && r.tf.globeCenter);
  let C = r0 ? r0.tf.globeCenter : null;
  if (!C) {
    // Sin referencia del centro: si las coordenadas están a ~1 radio del origen, el centro es (0,0,0)
    let s = 0, k = 0;
    for (const m of meshes) { if (m.profile !== 'gearth' || !m.world.length) continue; s += Math.hypot(m.world[0], m.world[1], m.world[2]); k++; }
    if (!k || Math.abs(s / k - 1) > 0.05) { info.warnings.push('Google Earth: no se pudo georreferenciar esta captura (falta la referencia del centro del globo).'); return; }
    C = [0, 0, 0];
  }
  // Earth (coordenadas "Keyhole") -> ECEF: E = (-kz, -kx, ky), y ×6371010 m
  const toEcef = (x, y, z, c = C) => { const kx = x - c[0], ky = y - c[1], kz = z - c[2]; return [-kz * EARTH_R, -kx * EARTH_R, ky * EARTH_R]; };
  // centro de la escena: media ponderada de las mallas de Earth
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const m of meshes) {
    if (m.profile !== 'gearth') continue;
    const w = m.world, c = m.gc || C;
    for (let i = 0; i < w.length; i += 3 * Math.max(1, Math.floor(w.length / 3 / 50))) { const e = toEcef(w[i], w[i + 1], w[i + 2], c); sx += e[0]; sy += e[1]; sz += e[2]; n++; }
  }
  if (!n) return;
  // Google Earth web usa un globo ESFÉRICO de radio 6.371.010 m (no el elipsoide WGS84):
  // latitud/longitud geocéntricas y altura sobre la esfera (≈ altitud sobre el nivel del mar).
  const ce = [sx / n, sy / n, sz / n];
  const rr = Math.hypot(ce[0], ce[1], ce[2]);
  const geo = { lat: Math.asin(ce[2] / rr) * 180 / Math.PI, lon: Math.atan2(ce[1], ce[0]) * 180 / Math.PI, h: rr - EARTH_R };
  if (opts.area && isFinite(opts.area.lat) && isFinite(opts.area.lon)) {
    // captura de un área: el origen es el centro del rectángulo marcado
    geo.lat = opts.area.lat; geo.lon = opts.area.lon; geo.areaCenter = true;
  } else {
    // Si la URL trae el punto al que mira la cámara (…/@lat,lon,…), el origen va ahí
    const anchor = urlAnchor(draws.map((r) => r.pi.header.url));
    if (anchor && Math.abs(anchor.lat - geo.lat) < 1 && Math.abs(anchor.lon - geo.lon) < 1) { geo.lat = anchor.lat; geo.lon = anchor.lon; geo.fromUrl = true; }
  }
  const E = sphereEnu(geo.lat, geo.lon);
  for (const m of meshes) {
    if (m.profile !== 'gearth') continue;
    const w = m.world, c = m.gc || C;
    for (let i = 0; i < w.length; i += 3) {
      const e = toEcef(w[i], w[i + 1], w[i + 2], c);
      w[i] = E[0] * e[0] + E[4] * e[1] + E[8] * e[2] + E[12];
      w[i + 1] = E[1] * e[0] + E[5] * e[1] + E[9] * e[2] + E[13];
      w[i + 2] = E[2] * e[0] + E[6] * e[1] + E[10] * e[2] + E[14];
    }
    m.geo = true;
  }
  // cámara de la captura (posición y dirección de la vista en este, norte, altitud): el visor la usa
  // para centrar el recorte en el punto que se miraba
  const rc = draws.find((r) => r.profile === 'gearth' && r.tf.view && r.tf.globeCenter);
  if (rc) {
    const iV = M4.inv(rc.tf.view);
    if (iV) {
      const p = M4.tp(iV, 0, 0, 0, 1), q = M4.tp(iV, 0, 0, -1, 0);
      const pe = toEcef(p[0] / (p[3] || 1), p[1] / (p[3] || 1), p[2] / (p[3] || 1), rc.tf.globeCenter);
      const de = [-q[2], -q[0], q[1]];
      const pos = [0, 1, 2].map((k) => E[k] * pe[0] + E[4 + k] * pe[1] + E[8 + k] * pe[2] + E[12 + k]);
      const dir = [0, 1, 2].map((k) => E[k] * de[0] + E[4 + k] * de[1] + E[8 + k] * de[2]);
      const l = Math.hypot(...dir) || 1;
      info.camera = { pos, dir: dir.map((x) => x / l) };
    }
  }
  info.frame = 'enu';
  info.geo = { lat: geo.lat, lon: geo.lon, h: geo.h, source: 'Google Earth', model: 'esfera R=6.371.010 m', fromUrl: !!geo.fromUrl, areaCenter: !!geo.areaCenter };
  info.units = 'metros';
  info.upAxis = 'Z';
}

// Captura de un área: Earth pasa a la tarjeta gráfica la posición del centro de la Tierra en coma
// flotante de 32 bits (≈0,4 m de precisión a 6.371 km), y cambia su origen interno en cada posición
// de cámara. Por eso cada fotograma sale desplazado unos decímetros respecto a los demás. Las
// teselas que se ven desde dos posiciones son exactamente la misma geometría: con ellas se mide el
// desfase entre cada pareja de fotogramas y se reparte por mínimos cuadrados (traslación por fotograma;
// la media de las correcciones es cero, para no mover el conjunto).
function registerFrames(meshes, info) {
  const byG = new Map();
  for (const m of meshes) { if (!m.geo || !m.gkey) continue; if (!byG.has(m.gkey)) byG.set(m.gkey, []); byG.get(m.gkey).push(m); }
  const edges = new Map(); // "fa|fb" -> {fa, fb, s:[x,y,z], n}
  for (const list of byG.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      let a = list[i], b = list[j];
      if (a.frame === b.frame || a.world.length !== b.world.length) continue;
      if (a.frame > b.frame) [a, b] = [b, a];
      const k = a.frame + '|' + b.frame;
      let e = edges.get(k); if (!e) { e = { fa: a.frame, fb: b.frame, s: [0, 0, 0], n: 0 }; edges.set(k, e); }
      const nv = a.world.length / 3, step = Math.max(1, Math.floor(nv / 32));
      let sx = 0, sy = 0, sz = 0, c = 0;
      const dif = [];
      for (let v = 0; v < nv; v += step) { const o = v * 3; const dx = b.world[o] - a.world[o], dy = b.world[o + 1] - a.world[o + 1], dz = b.world[o + 2] - a.world[o + 2]; dif.push(dx, dy, dz); sx += dx; sy += dy; sz += dz; c++; }
      const mx = sx / c, my = sy / c, mz = sz / c;
      // solo parejas que son de verdad la misma pieza en el mismo sitio: desfase de una sola traslación
      // (dispersión < 5 cm) y pequeño (< 3 m); si no, es otra cosa (geometría repetida, instancias…)
      let spread = 0; for (let k = 0; k < dif.length; k += 3) spread = Math.max(spread, Math.hypot(dif[k] - mx, dif[k + 1] - my, dif[k + 2] - mz));
      if (spread > 0.05 || Math.hypot(mx, my, mz) > 3) continue;
      e.s[0] += mx; e.s[1] += my; e.s[2] += mz; e.n++;
    }
  }
  const frames = [...new Set(meshes.filter((m) => m.geo).map((m) => m.frame))];
  if (frames.length < 2 || !edges.size) return;
  const E = [...edges.values()].filter((e) => e.n > 0).map((e) => ({ fa: e.fa, fb: e.fb, d: e.s.map((x) => x / e.n), w: e.n }));
  if (!E.length) return;
  const t = new Map(frames.map((f) => [f, [0, 0, 0]]));
  for (let it = 0; it < 300; it++) {
    for (const f of frames) {
      let w = 0; const acc = [0, 0, 0];
      for (const e of E) {
        // pos_b + t_b = pos_a + t_a, con d = pos_b - pos_a
        if (e.fa === f) { const tb = t.get(e.fb); for (let k = 0; k < 3; k++) acc[k] += (tb[k] + e.d[k]) * e.w; w += e.w; }
        else if (e.fb === f) { const ta = t.get(e.fa); for (let k = 0; k < 3; k++) acc[k] += (ta[k] - e.d[k]) * e.w; w += e.w; }
      }
      if (w) t.set(f, acc.map((x) => x / w));
    }
    // media cero
    const mean = [0, 0, 0]; for (const v of t.values()) for (let k = 0; k < 3; k++) mean[k] += v[k] / frames.length;
    for (const v of t.values()) for (let k = 0; k < 3; k++) v[k] -= mean[k];
  }
  // residuo después de corregir
  let before = 0, after = 0, n = 0;
  for (const e of E) {
    const ta = t.get(e.fa), tb = t.get(e.fb);
    before += Math.hypot(...e.d) * e.w;
    after += Math.hypot(e.d[0] + tb[0] - ta[0], e.d[1] + tb[1] - ta[1], e.d[2] + tb[2] - ta[2]) * e.w; n += e.w;
  }
  for (const m of meshes) {
    if (!m.geo) continue;
    const c = t.get(m.frame); if (!c) continue;
    const w = m.world;
    for (let i = 0; i < w.length; i += 3) { w[i] += c[0]; w[i + 1] += c[1]; w[i + 2] += c[2]; }
  }
  const maxCorr = Math.max(...[...t.values()].map((v) => Math.hypot(...v)));
  info.registration = { frames: frames.length, pairs: E.length, before_mm: Math.round(before / n * 1000), after_mm: Math.round(after / n * 1000), max_correction_mm: Math.round(maxCorr * 1000) };
}

// Captura de un área: cada fotograma (posición de cámara) es dueño de una celda del rectángulo
// (este/norte en metros respecto al centro). De cada fotograma se quedan solo los triángulos cuyo
// centro cae en su celda; así las celdas encajan sin huecos ni triángulos repetidos.
// area.cells = [{ f, e0, n0, e1, n1 }] (intervalos semiabiertos [e0,e1) × [n0,n1), salvo el borde exterior)
function clipToCells(meshes, area, info) {
  const byFrame = new Map();
  for (const c of area.cells || []) byFrame.set(c.f, c);
  const R = area.rect || null;
  const cells = area.cells || [];
  // Franja junto a las costuras: si la posición vecina NO dibujó esta misma tesela (usó otra de distinto
  // nivel), el triángulo se conserva aunque su centro caiga un poco dentro de la celda vecina. Así no
  // quedan rendijas entre posiciones; si las dos tienen la misma tesela, el triángulo entra una sola vez.
  const margin = area.margin ?? 2;
  const framesByG = new Map();
  for (const m of meshes) { if (!m.geo || !m.gkey) continue; let s = framesByG.get(m.gkey); if (!s) framesByG.set(m.gkey, (s = new Set())); s.add(m.frame); }
  const inCell = (c, x, y) => {
    const cE = R && c.e1 >= R.e1 - 1e-6, cN = R && c.n1 >= R.n1 - 1e-6; // borde exterior: cerrado
    return x >= c.e0 && y >= c.n0 && (cE ? x <= c.e1 : x < c.e1) && (cN ? y <= c.n1 : y < c.n1);
  };
  // celdas que se quedaron sin fotograma: su zona se reparte a la celda presente más cercana
  const extra = new Map(); // f -> [rect]
  for (const mc of area.missingCells || []) {
    const cx = (mc.e0 + mc.e1) / 2, cy = (mc.n0 + mc.n1) / 2;
    let best = null, bd = Infinity;
    for (const c of cells) { const d = Math.hypot((c.e0 + c.e1) / 2 - cx, (c.n0 + c.n1) / 2 - cy); if (d < bd) { bd = d; best = c; } }
    if (best) { if (!extra.has(best.f)) extra.set(best.f, []); extra.get(best.f).push(mc); }
  }
  const owns = (c, x, y) => inCell(c, x, y) || (extra.get(c.f) || []).some((r) => inCell(r, x, y));
  const ownerOf = (x, y) => { for (const c of cells) if (owns(c, x, y)) return c; return null; };
  let kept = 0, dropped = 0, seam = 0;
  for (const m of meshes) {
    const cell = m.geo ? byFrame.get(m.frame) : null;
    if (!cell) { dropped += m.indices.length / 3; m.indices = new Uint32Array(0); continue; }
    const w = m.world, I = m.indices;
    const others = framesByG.get(m.gkey) || new Set();
    const keep = [];
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
      const x = (w[a] + w[b] + w[c]) / 3, y = (w[a + 1] + w[b + 1] + w[c + 1]) / 3;
      if (owns(cell, x, y)) { keep.push(I[i], I[i + 1], I[i + 2]); continue; }
      if (!margin || !R || x < cell.e0 - margin || x > cell.e1 + margin || y < cell.n0 - margin || y > cell.n1 + margin) continue;
      if (x < R.e0 || x > R.e1 || y < R.n0 || y > R.n1) continue; // nunca fuera del rectángulo marcado
      const o = ownerOf(x, y);
      if (o && o.f !== cell.f && !others.has(o.f)) { keep.push(I[i], I[i + 1], I[i + 2]); seam++; }
    }
    kept += keep.length / 3; dropped += (I.length - keep.length) / 3;
    if (keep.length === I.length) continue;
    compactWorld(m, keep);
  }
  info.area = { cells: cells.length, kept, dropped, seam };
}
function compactWorld(m, idx) {
  const nV = m.world.length / 3;
  const remap = new Int32Array(nV).fill(-1);
  let n = 0;
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) { const v = idx[i]; if (remap[v] < 0) remap[v] = n++; out[i] = remap[v]; }
  const w = new Float64Array(n * 3), uv = m.uvs ? new Float32Array(n * 2) : null, col = m.colors ? new Float32Array(n * 4) : null;
  for (let v = 0; v < nV; v++) {
    const r = remap[v]; if (r < 0) continue;
    w[r * 3] = m.world[v * 3]; w[r * 3 + 1] = m.world[v * 3 + 1]; w[r * 3 + 2] = m.world[v * 3 + 2];
    if (uv) { uv[r * 2] = m.uvs[v * 2]; uv[r * 2 + 1] = m.uvs[v * 2 + 1]; }
    if (col) for (let k = 0; k < 4; k++) col[r * 4 + k] = m.colors[v * 4 + k];
  }
  m.world = w; m.indices = out; m.uvs = uv; m.colors = col; m.nVerts = n; m.nTris = out.length / 3;
}
// Lee "@lat,lon" de las URL de Google Earth / Google Maps
export function urlAnchor(urls) {
  for (const u of urls || []) {
    const m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(String(u || ''));
    if (m) { const lat = +m[1], lon = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }; }
  }
  return null;
}
function detectEcef(meshes, info) {
  // Escenas cuyo "mundo" son coordenadas geocéntricas (ECEF en metros)
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const m of meshes) { if (m.transformKind !== 'absoluta') continue; const w = m.world; if (!w.length) continue; sx += w[0]; sy += w[1]; sz += w[2]; n++; }
  if (!n) return;
  const r = Math.hypot(sx / n, sy / n, sz / n);
  if (r > 6.30e6 && r < 6.42e6) {
    const geo = ecefToGeo(sx / n, sy / n, sz / n);
    const E = enuMatrix(geo.lat, geo.lon, 0);
    for (const m of meshes) {
      if (m.transformKind !== 'absoluta') continue;
      const w = m.world;
      for (let i = 0; i < w.length; i += 3) {
        const x = w[i], y = w[i + 1], z = w[i + 2];
        w[i] = E[0] * x + E[4] * y + E[8] * z + E[12]; w[i + 1] = E[1] * x + E[5] * y + E[9] * z + E[13]; w[i + 2] = E[2] * x + E[6] * y + E[10] * z + E[14];
      }
      m.geo = true;
    }
    info.frame = 'enu'; info.geo = { lat: geo.lat, lon: geo.lon, h: geo.h, source: 'ECEF' }; info.units = 'metros'; info.upAxis = 'Z';
  }
}

function finalizeMeshes(meshes, info) {
  // caja de las mallas "3D" (prof. activada) para el origen
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    const w = m.world;
    m.bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < w.length; i += 3) for (let k = 0; k < 3; k++) { const v = w[i + k]; if (v < m.bbox[k]) m.bbox[k] = v; if (v > m.bbox[k + 3]) m.bbox[k + 3] = v; }
  }
  if (info.frame === 'enu') { info.origin = [0, 0, 0]; }
  else {
    for (const m of meshes) { if (!isFinite(m.bbox[0])) continue; for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], m.bbox[k]); bb[k + 3] = Math.max(bb[k + 3], m.bbox[k + 3]); } }
    info.origin = isFinite(bb[0]) ? [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2] : [0, 0, 0];
  }
  const o = info.origin;
  for (const m of meshes) {
    const w = m.world;
    const p = new Float32Array(w.length);
    for (let i = 0; i < w.length; i += 3) { p[i] = w[i] - o[0]; p[i + 1] = w[i + 1] - o[1]; p[i + 2] = w[i + 2] - o[2]; }
    m.positions = p;
    m.bbox = [m.bbox[0] - o[0], m.bbox[1] - o[1], m.bbox[2] - o[2], m.bbox[3] - o[0], m.bbox[4] - o[1], m.bbox[5] - o[2]];
    delete m.world;
  }
}

function classifyGroup(g, meshes) {
  const p = g.program;
  const ms = meshes.filter((m) => m.group === g.key);
  const kinds = new Set(ms.map((m) => m.transformKind));
  const attrsTxt = [p.posAttr, p.uvAttr].filter(Boolean).join(', ');
  g.label = `${p.profile === 'gearth' ? 'Google Earth · ' : p.profile === 'filament' ? 'Filament · ' : ''}${attrsTxt || 'sin posición'}${p.colorSampler ? ' · textura ' + p.colorSampler : ''}`;
  g.enabled = true; g.reason = '';
  if (!ms.length) { g.enabled = false; g.reason = g.nonTri ? 'solo líneas o puntos' : g.noPos ? 'sin atributo de posición' : 'sin triángulos'; }
  else if (p.isSkia) { g.enabled = false; g.reason = 'interfaz 2D del navegador'; }
  else if (p.posIs2D) { g.enabled = false; g.reason = 'posiciones 2D (interfaz o efectos)'; }
  else if (p.posGuessed && !(p.profile === 'gearth' || p.profile === 'filament')) { g.enabled = false; g.reason = 'no se reconoce qué atributo es la posición (líneas, etiquetas o efectos)'; }
  else if (ms.length === 1 && ms[0].nTris <= 2) { g.enabled = false; g.reason = 'un solo rectángulo (fondo, cielo o efecto de pantalla)'; }
  else if (p.uniforms.some((u) => /styleproperties|dashtexture|glyph|font|label/i.test(u.base))) { g.enabled = false; g.reason = 'dibujo vectorial del mapa (carreteras, zonas o textos): su forma se calcula en pantalla'; }
  else if (kinds.size === 1 && kinds.has('ninguna')) { g.enabled = false; g.reason = 'sin matriz 3D (pantalla completa, cielo o interfaz)'; }
  else if (ms.every((m) => !m.depthTest) && !p.colorSampler) { g.enabled = false; g.reason = 'sin prueba de profundidad (probablemente interfaz)'; }
  else if (/sky|atmo|star|sun|cloud|moon/i.test(p.uniforms.map((u) => u.base).join(' ')) && !p.uniforms.some((u) => /meshtoworld|model|world/i.test(u.base))) { g.enabled = false; g.reason = 'cielo o atmósfera'; }
}
// Rectángulos sueltos diminutos (iconos, marcadores, etiquetas): menos del 1 % del tamaño de la escena
function markSmall(meshes) {
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (let k = 0; k < 3; k++) { if (isFinite(m.bbox[k])) { bb[k] = Math.min(bb[k], m.bbox[k]); bb[k + 3] = Math.max(bb[k + 3], m.bbox[k + 3]); } }
  const diag = Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) || 1;
  for (const m of meshes) {
    const d = Math.hypot(m.bbox[3] - m.bbox[0], m.bbox[4] - m.bbox[1], m.bbox[5] - m.bbox[2]);
    m.small = m.nTris <= 2 && m.nVerts <= 4 && (d < diag * 0.01 || m.transformKind === 'ninguna');
  }
}
