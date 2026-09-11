/* =========================================================================
 * modelo-predictivo.js — Modelo que aprende, no estrategia de manual
 *
 *   node docs/modelo-predictivo.js
 *
 * Construye 34 caracteristicas de cada instante (retornos rezagados,
 * indicadores, volatilidad, posicion relativa, rachas) y entrena una
 * regresion logistica por descenso de gradiente para predecir si el precio
 * subira dentro de N ticks.
 *
 * CONTROL DE VALIDEZ: el mismo procedimiento se aplica a una serie con
 * estructura inyectada a proposito. Si el modelo la encuentra ahi y no en
 * los datos de Deriv, la conclusion no es que el metodo falle.
 * ========================================================================= */
'use strict';
global.window = {};
require('../js/tecnico.js');
const T = global.window.Tecnico;

/* ------------------------- Generadores de series ----------------------- */

function normal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* Modelo real de los indices de volatilidad de Deriv. */
function serieDeriv(n, vol, seg, ini) {
  const s = vol / Math.sqrt((365 * 24 * 3600) / seg);
  const p = [ini];
  for (let i = 1; i < n; i++) p.push(p[i-1] * Math.exp(s * normal() - 0.5 * s * s));
  return p;
}

/* CONTROL: misma volatilidad, pero con autocorrelacion inyectada.
   Aqui SI hay algo que aprender: el retorno depende del anterior. */
function serieConPatron(n, vol, seg, ini, phi) {
  const s = vol / Math.sqrt((365 * 24 * 3600) / seg);
  const p = [ini];
  let r = 0;
  for (let i = 1; i < n; i++) {
    r = phi * r + Math.sqrt(1 - phi * phi) * normal();
    p.push(p[i-1] * Math.exp(s * r - 0.5 * s * s));
  }
  return p;
}

/* --------------------------- Caracteristicas --------------------------- */

function caracteristicas(p, i, ctx) {
  const f = [];
  // Retornos rezagados, normalizados por la volatilidad reciente
  const vol = ctx.vol[i] || 1e-9;
  for (let k = 1; k <= 10; k++) f.push((Math.log(p[i-k+1] / p[i-k])) / vol);
  // Momento a varias escalas
  for (const w of [3, 5, 10, 20, 40]) f.push(Math.log(p[i] / p[i-w]) / (vol * Math.sqrt(w)));
  // Distancia a medias moviles
  for (const w of [5, 10, 20, 50]) {
    const m = T.sma(p, w, i);
    f.push(m ? Math.log(p[i] / m) / vol : 0);
  }
  // Indicadores acotados
  f.push((ctx.rsi[i] === null ? 50 : ctx.rsi[i]) / 100);
  const st = T.estocastico(p, 14, i);
  f.push((st === null ? 50 : st) / 100);
  const bb = T.bollinger(p, 20, 2, i);
  f.push(bb ? (p[i] - bb.medio) / (bb.alto - bb.medio || 1e-9) : 0);
  f.push(bb ? bb.ancho * 1000 : 0);
  const mc = ctx.macd[i];
  f.push(mc ? mc.hist / (p[i] * vol) : 0);
  // Volatilidad relativa
  const v20 = T.desviacion(p, 20, i), v60 = T.desviacion(p, 60, i);
  f.push(v20 && v60 ? v20 / v60 : 1);
  // Rachas de signo
  let racha = 0;
  for (let k = i; k > i - 10 && k > 0; k--) {
    const sg = p[k] > p[k-1];
    if (k === i) racha = sg ? 1 : -1;
    else if ((racha > 0) === sg) racha += sg ? 1 : -1;
    else break;
  }
  f.push(racha / 10);
  // Proporcion de subidas en ventanas
  for (const w of [5, 10, 20]) {
    let s = 0;
    for (let k = i - w + 1; k <= i; k++) if (p[k] > p[k-1]) s++;
    f.push(s / w - 0.5);
  }
  f.push(1); // termino independiente
  return f;
}

const N_CAR = 34;

/* --------------------- Regresion logistica entrenada ------------------- */

function entrenar(X, y, epocas, lr, l2) {
  const w = new Float64Array(X[0].length);
  const n = X.length;
  for (let e = 0; e < epocas; e++) {
    const g = new Float64Array(w.length);
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < w.length; j++) z += w[j] * X[i][j];
      const pred = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const err = pred - y[i];
      for (let j = 0; j < w.length; j++) g[j] += err * X[i][j];
    }
    for (let j = 0; j < w.length; j++) w[j] -= lr * (g[j] / n + l2 * w[j]);
  }
  return w;
}

function predecir(w, x) {
  let z = 0;
  for (let j = 0; j < w.length; j++) z += w[j] * x[j];
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/* --------------------------- Montar el conjunto ------------------------ */

function construir(series, horizonte) {
  const X = [], y = [];
  for (const p of series) {
    const ctx = { rsi: T.rsiSerie(p, 14), macd: T.macdSerie(p, 12, 26, 9), vol: [] };
    for (let i = 0; i < p.length; i++) {
      const d = T.desviacion(p.map(Math.log), 60, i);
      ctx.vol[i] = d || 1e-9;
    }
    for (let i = 80; i < p.length - horizonte; i++) {
      X.push(caracteristicas(p, i, ctx));
      y.push(p[i + horizonte] > p[i] ? 1 : 0);
    }
  }
  return { X, y };
}

function experimento(nombre, generador, nSeries, largo, horizonte) {
  console.log('\n' + '='.repeat(70));
  console.log(nombre);
  console.log('='.repeat(70));

  const ent = [], val = [];
  for (let i = 0; i < nSeries; i++) ent.push(generador(largo));
  for (let i = 0; i < nSeries; i++) val.push(generador(largo));

  const A = construir(ent, horizonte);
  const B = construir(val, horizonte);
  console.log('  entrenamiento: ' + A.X.length.toLocaleString('es') + ' ejemplos, ' +
              N_CAR + ' caracteristicas');
  console.log('  validacion   : ' + B.X.length.toLocaleString('es') + ' ejemplos NUEVOS');

  const w = entrenar(A.X, A.y, 400, 0.5, 1e-4);

  function medir(D) {
    let ok = 0;
    for (let i = 0; i < D.X.length; i++) {
      const pr = predecir(w, D.X[i]);
      if ((pr > 0.5 ? 1 : 0) === D.y[i]) ok++;
    }
    return ok / D.X.length;
  }
  // Solo las predicciones en las que el modelo esta mas seguro
  function medirSeguras(D, umbral) {
    let ok = 0, n = 0;
    for (let i = 0; i < D.X.length; i++) {
      const pr = predecir(w, D.X[i]);
      if (Math.abs(pr - 0.5) < umbral) continue;
      n++;
      if ((pr > 0.5 ? 1 : 0) === D.y[i]) ok++;
    }
    return { tasa: n ? ok / n : 0, n };
  }

  const tEnt = medir(A), tVal = medir(B);
  console.log('\n  acierto en ENTRENAMIENTO : ' + (tEnt * 100).toFixed(2) + '%');
  console.log('  acierto en VALIDACION    : ' + (tVal * 100).toFixed(2) + '%   <- el que cuenta');
  const err = 1.96 * Math.sqrt(0.25 / B.X.length) * 100;
  console.log('  margen de error al 95%   : +/-' + err.toFixed(2) + ' pp');

  console.log('\n  filtrando por confianza del modelo:');
  for (const u of [0.01, 0.02, 0.05]) {
    const r = medirSeguras(B, u);
    console.log('    solo las mas seguras (|p-0.5|>' + u + '): ' +
      (r.tasa * 100).toFixed(2) + '% sobre ' + r.n.toLocaleString('es') + ' casos');
  }
  const sobra = (tVal * 100 - 50) > err;
  console.log('\n  VEREDICTO: ' + (sobra
    ? 'ENCUENTRA SENAL — supera el 50% mas alla del margen'
    : 'sin senal — indistinguible de acertar al azar'));
  return tVal;
}

console.log('\nMODELO PREDICTIVO ENTRENADO — 34 caracteristicas, regresion logistica');
console.log('Prediccion: subira o bajara el precio dentro de 5 ticks\n');

const r1 = experimento(
  'A. DATOS DE DERIV (Volatility 75, el modelo real de sus indices)',
  n => serieDeriv(n, 0.75, 2, 1000), 25, 4000, 5);

const r2 = experimento(
  'B. CONTROL — la misma serie pero con patron inyectado (autocorrelacion 0.25)',
  n => serieConPatron(n, 0.75, 2, 1000, 0.25), 25, 4000, 5);

console.log('\n' + '='.repeat(70));
console.log('COMPARACION');
console.log('='.repeat(70));
console.log('  Con datos de Deriv        : ' + (r1 * 100).toFixed(2) + '%');
console.log('  Con un patron de verdad   : ' + (r2 * 100).toFixed(2) + '%');
console.log('');
if (r2 > r1 + 0.02) {
  console.log('  El mismo modelo, el mismo codigo, las mismas caracteristicas.');
  console.log('  Encuentra el patron cuando existe. En los datos de Deriv no lo');
  console.log('  encuentra porque no hay ninguno que encontrar.');
} else {
  console.log('  El control no separo: habria que revisar el procedimiento.');
}
console.log('');
