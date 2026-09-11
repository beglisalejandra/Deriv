/* =========================================================================
 * backtest-tecnico.js — Analisis tecnico sobre contratos Rise/Fall
 *
 *   node docs/backtest-tecnico.js
 *
 * Genera una serie de precios con el modelo de los indices de volatilidad de
 * Deriv (movimiento browniano geometrico con la volatilidad declarada del
 * indice), aplica las estrategias tecnicas clasicas y mide cada una contra
 * una linea base que entra al azar.
 * ========================================================================= */
'use strict';
global.window = {};
require('../js/tecnico.js');
const T = global.window.Tecnico;

/* ---- Serie de precios del indice de volatilidad ----
   Volatility 75 = 75% de volatilidad anualizada, un tick cada 2 segundos. */
function serieDeriv(n, volAnual, segPorTick, inicio) {
  const ticksAno = (365 * 24 * 3600) / segPorTick;
  const sigma = volAnual / Math.sqrt(ticksAno);
  const p = [inicio];
  for (let i = 1; i < n; i++) {
    // Box-Muller para una normal estandar
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    p.push(p[i - 1] * Math.exp(sigma * z - 0.5 * sigma * sigma));
  }
  return p;
}

/* ---- Estrategias. Devuelven 'CALL', 'PUT' o null (no entrar) ---- */
const ESTRATEGIAS = {
  'Cruce de medias 10/30': (p, i, c) => {
    const r = T.sma(p, 10, i), l = T.sma(p, 30, i);
    const rp = T.sma(p, 10, i - 1), lp = T.sma(p, 30, i - 1);
    if (r === null || l === null || rp === null || lp === null) return null;
    if (rp <= lp && r > l) return 'CALL';
    if (rp >= lp && r < l) return 'PUT';
    return null;
  },

  'Tendencia con media 50': (p, i, c) => {
    const m = T.sma(p, 50, i);
    if (m === null) return null;
    return p[i] > m ? 'CALL' : 'PUT';
  },

  'RSI 14 sobrecompra/sobreventa': (p, i, c) => {
    const r = c.rsi[i];
    if (r === null) return null;
    if (r < 30) return 'CALL';
    if (r > 70) return 'PUT';
    return null;
  },

  'RSI 14 a favor de la tendencia': (p, i, c) => {
    const r = c.rsi[i], m = T.sma(p, 50, i);
    if (r === null || m === null) return null;
    if (r < 40 && p[i] > m) return 'CALL';
    if (r > 60 && p[i] < m) return 'PUT';
    return null;
  },

  'Rebote en Bollinger 20': (p, i, c) => {
    const b = T.bollinger(p, 20, 2, i);
    if (!b) return null;
    if (p[i] <= b.bajo) return 'CALL';
    if (p[i] >= b.alto) return 'PUT';
    return null;
  },

  'Ruptura de Bollinger 20': (p, i, c) => {
    const b = T.bollinger(p, 20, 2, i);
    if (!b) return null;
    if (p[i] >= b.alto) return 'CALL';
    if (p[i] <= b.bajo) return 'PUT';
    return null;
  },

  'MACD 12/26/9': (p, i, c) => {
    const a = c.macd[i], b = c.macd[i - 1];
    if (!a || !b) return null;
    if (b.hist <= 0 && a.hist > 0) return 'CALL';
    if (b.hist >= 0 && a.hist < 0) return 'PUT';
    return null;
  },

  'Estocastico 14': (p, i, c) => {
    const k = T.estocastico(p, 14, i);
    if (k === null) return null;
    if (k < 20) return 'CALL';
    if (k > 80) return 'PUT';
    return null;
  },

  'Momento de 5 ticks': (p, i, c) => {
    if (i < 5) return null;
    return p[i] > p[i - 5] ? 'CALL' : 'PUT';
  },

  'Tres velas iguales': (p, i, c) => {
    if (i < 3) return null;
    const s = [p[i] > p[i-1], p[i-1] > p[i-2], p[i-2] > p[i-3]];
    if (s[0] && s[1] && s[2]) return 'CALL';
    if (!s[0] && !s[1] && !s[2]) return 'PUT';
    return null;
  },

  'Soporte y resistencia': (p, i, c) => {
    const pv = T.pivotes(p, 5, i);
    if (pv.soporte === null || pv.resistencia === null) return null;
    const rango = pv.resistencia - pv.soporte;
    if (rango <= 0) return null;
    if (p[i] <= pv.soporte + rango * 0.1) return 'CALL';
    if (p[i] >= pv.resistencia - rango * 0.1) return 'PUT';
    return null;
  },

  'AL AZAR (linea base)': () => Math.random() < 0.5 ? 'CALL' : 'PUT'
};

/* ---- Evaluacion ---- */
const DURACION = 5;      // ticks que dura el contrato Rise/Fall
const PAGO = 1.95;       // pago tipico de Rise/Fall

function evaluar(nombre, fn, series) {
  let ganadas = 0, total = 0, dinero = 0;
  for (const p of series) {
    const ctx = { rsi: T.rsiSerie(p, 14), macd: T.macdSerie(p, 12, 26, 9) };
    for (let i = 60; i < p.length - DURACION; i++) {
      const s = fn(p, i, ctx);
      if (!s) continue;
      const entrada = p[i], salida = p[i + DURACION];
      const gana = s === 'CALL' ? salida > entrada : salida < entrada;
      total++;
      if (gana) { ganadas++; dinero += PAGO - 1; } else { dinero -= 1; }
      i += DURACION;                       // no solapar contratos
    }
  }
  return { nombre, total, tasa: total ? ganadas / total : 0, roi: total ? dinero / total : 0 };
}

/* ---- Ejecucion ---- */
console.log('\n=== ANALISIS TECNICO SOBRE RISE/FALL ===');
console.log('Volatility 75 Index: 75% de volatilidad anual, tick cada 2 s');
console.log('Contratos de ' + DURACION + ' ticks, pago x' + PAGO + '\n');

const SERIES = 40, LARGO = 6000;
const series = [];
for (let s = 0; s < SERIES; s++) series.push(serieDeriv(LARGO, 0.75, 2, 1000));
console.log('Generados ' + SERIES + ' recorridos de ' + LARGO + ' ticks = ' +
            (SERIES * LARGO).toLocaleString('es') + ' ticks\n');

const res = [];
for (const [n, f] of Object.entries(ESTRATEGIAS)) res.push(evaluar(n, f, series));

const base = res.find(r => r.nombre.startsWith('AL AZAR'));
res.sort((a, b) => b.tasa - a.tasa);

console.log('estrategia'.padEnd(34) + 'entradas'.padStart(10) + 'acierto'.padStart(10) +
            'ROI'.padStart(9) + 'vs azar'.padStart(10));
console.log('-'.repeat(73));
for (const r of res) {
  const dif = (r.tasa - base.tasa) * 100;
  console.log(
    r.nombre.padEnd(34) +
    r.total.toLocaleString('es').padStart(10) +
    (r.tasa * 100).toFixed(2).padStart(9) + '%' +
    (r.roi * 100).toFixed(2).padStart(8) + '%' +
    ((dif >= 0 ? '+' : '') + dif.toFixed(2) + ' pp').padStart(10)
  );
}

// Margen de error para saber si alguna diferencia es real
const n = base.total;
const err = 1.96 * Math.sqrt(0.25 / n) * 100;
console.log('\n  Linea base (azar): ' + (base.tasa * 100).toFixed(2) + '% sobre ' +
            n.toLocaleString('es') + ' entradas.');
console.log('  Margen de error al 95%: +/-' + err.toFixed(2) + ' puntos porcentuales.');
const reales = res.filter(r => !r.nombre.startsWith('AL AZAR') &&
                               (r.tasa - base.tasa) * 100 > err);
console.log('  Estrategias que superan al azar mas alla del margen: ' +
            (reales.length ? reales.map(r => r.nombre).join(', ') : 'NINGUNA'));
console.log('');
