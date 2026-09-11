/* =========================================================================
 * backtest.js — Monte Carlo del motor contra un RNG uniforme.
 *
 *   node docs/backtest.js
 *
 * Los indices de volatilidad de Deriv generan ticks independientes, asi que
 * el ultimo digito es uniforme sobre 0-9. Este script usa exactamente las
 * mismas estrategias y la misma funcion de liquidacion que la app, y mide
 * cuanto sobrevive cada plan con stakes de 1, 3 y 5 USD.
 * ========================================================================= */
'use strict';

global.window = {};
require('../js/stats.js');
require('../js/trader.js');
const { DigitStats, Risk, TradeEngine } = global.window;

// ---- Modelo de pagos -------------------------------------------------------
// Deriv cotiza cada contrato como: pago = (1/probabilidad) * (1 - ventaja).
// Anclas reales conocidas:
//   * Matches sobre Volatility 75 (1s): el video muestra 100.00 USD de stake
//     y 892.86 USD de pago -> x8.9286 -> ventaja de la casa = 10.71%.
//   * Differs y otros contratos de alta probabilidad cotizan cerca de x1.09
//     -> ventaja ~1.9%.
// La ventaja NO es constante: crece cuanto menos probable es el evento.
// Aqui se interpola de forma lineal entre esas dos anclas. Es una
// aproximacion; el escaner de la app cotiza los numeros verdaderos en vivo.
const EDGE_LOW_PROB  = 0.1071;   // eventos ~10% (Matches, Over 8, Under 1)
const EDGE_HIGH_PROB = 0.0190;   // eventos ~90% (Differs, Over 0, Under 9)

function houseEdge(p) {
  if (p <= 0.2) return EDGE_LOW_PROB;
  if (p >= 0.8) return EDGE_HIGH_PROB;
  const t = (p - 0.2) / 0.6;
  return EDGE_LOW_PROB + t * (EDGE_HIGH_PROB - EDGE_LOW_PROB);
}

function payoutMult(type, barrier) {
  const p = DigitStats.theoreticalWinProb(type, barrier);
  return (1 / p) * (1 - houseEdge(p));
}

function rngDigit() { return Math.floor(Math.random() * 10); }

/* ---- 1. Tasa de acierto de cada estrategia contra un RNG uniforme ---- */

function testStrategy(key, nTrades, windowTicks) {
  const stats = new DigitStats(windowTicks + 10);
  for (let i = 0; i < windowTicks; i++) stats.digits.push(rngDigit());

  const strat = DigitStats.STRATEGIES[key];
  let wins = 0, staked = 0, returned = 0;

  for (let i = 0; i < nTrades; i++) {
    const rep = stats.report(windowTicks);
    const sig = strat.run(rep);
    const mult = payoutMult(sig.contract_type, sig.barrier);
    const next = rngDigit();
    const won = TradeEngine.evaluate(sig.contract_type, sig.barrier, next);

    staked += 1;
    if (won) { wins++; returned += mult; }

    stats.digits.push(next);
    if (stats.digits.length > windowTicks + 10) stats.digits.shift();
  }

  return { key, label: strat.label, trades: nTrades, wins,
           winRate: wins / nTrades, roi: (returned - staked) / staked };
}

/* ---- 2. Simulacion de sesiones completas con gestion de capital ---- */

function simulateSession(opts) {
  const { bankroll, baseStake, factor, maxSteps, maxTrades, takeProfit, stopLoss,
          strategyKey, windowTicks } = opts;
  const stats = new DigitStats(windowTicks + 10);
  for (let i = 0; i < windowTicks; i++) stats.digits.push(rngDigit());

  const strat = DigitStats.STRATEGIES[strategyKey];
  let pnl = 0, lossStreak = 0, trades = 0, busted = false;

  while (trades < maxTrades) {
    let stake = factor > 1 ? baseStake * Math.pow(factor, lossStreak) : baseStake;
    if (lossStreak >= maxSteps) { stake = baseStake; lossStreak = 0; }

    if (bankroll + pnl < stake) { busted = true; break; }
    if (takeProfit > 0 && pnl >= takeProfit) break;
    if (stopLoss > 0 && pnl <= -stopLoss) break;

    const rep = stats.report(windowTicks);
    const sig = strat.run(rep);
    const mult = payoutMult(sig.contract_type, sig.barrier);
    const next = rngDigit();
    const won = TradeEngine.evaluate(sig.contract_type, sig.barrier, next);

    pnl += won ? stake * (mult - 1) : -stake;
    lossStreak = won ? 0 : lossStreak + 1;
    trades++;

    stats.digits.push(next);
    if (stats.digits.length > windowTicks + 10) stats.digits.shift();
  }
  return { pnl, trades, busted };
}

function runSessions(n, opts) {
  let profit = 0, busts = 0, total = 0, worst = 0, best = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateSession(opts);
    total += r.pnl;
    if (r.pnl > 0) profit++;
    if (r.busted) busts++;
    if (r.pnl < worst) worst = r.pnl;
    if (r.pnl > best) best = r.pnl;
  }
  return { sessions: n, profitable: profit / n, busted: busts / n,
           avgPnl: total / n, worst, best };
}

/* ------------------------------- Salida -------------------------------- */

function pct(x) { return (x * 100).toFixed(2) + '%'; }
function usd(x) { return (x < 0 ? '-' : '') + Math.abs(x).toFixed(2); }

console.log('\n=== 1. Tasa de acierto por estrategia (200.000 operaciones, ventana 100) ===\n');
console.log('estrategia'.padEnd(42), 'aciertos'.padStart(10), 'teorico'.padStart(9), 'ROI'.padStart(9));
console.log('-'.repeat(73));

const THEORY = {
  matches_hot: 0.10, matches_cold: 0.10, differs_cold: 0.90, over_8: 0.10,
  under_1: 0.10, over_dynamic: 0.50, even_odd: 0.50, random_match: 0.10
};

for (const key of Object.keys(DigitStats.STRATEGIES)) {
  const r = testStrategy(key, 200000, 100);
  console.log(
    r.label.slice(0, 41).padEnd(42),
    pct(r.winRate).padStart(10),
    pct(THEORY[key]).padStart(9),
    pct(r.roi).padStart(9)
  );
}

console.log('\n=== 2. Sesiones completas — 5.000 sesiones de hasta 200 operaciones ===\n');

const plans = [
  { name:'1 USD fija',                  baseStake:1, factor:1,   maxSteps:99, bankroll:100 },
  { name:'3 USD fija',                  baseStake:3, factor:1,   maxSteps:99, bankroll:100 },
  { name:'5 USD fija',                  baseStake:5, factor:1,   maxSteps:99, bankroll:100 },
  { name:'1 USD martingala x2.2 (5)',   baseStake:1, factor:2.2, maxSteps:5,  bankroll:100 },
  { name:'1 USD martingala x2.2 (8)',   baseStake:1, factor:2.2, maxSteps:8,  bankroll:100 },
  { name:'1 USD martingala x2.2 (sin tope)', baseStake:1, factor:2.2, maxSteps:99, bankroll:100 }
];

console.log('plan'.padEnd(34), 'en ganancia'.padStart(12), 'quiebra'.padStart(9),
            'P/L medio'.padStart(11), 'peor'.padStart(10));
console.log('-'.repeat(78));

for (const p of plans) {
  const r = runSessions(5000, Object.assign({
    strategyKey:'matches_hot', windowTicks:100, maxTrades:200, takeProfit:0, stopLoss:0
  }, p));
  console.log(
    p.name.padEnd(34),
    pct(r.profitable).padStart(12),
    pct(r.busted).padStart(9),
    usd(r.avgPnl).padStart(11),
    usd(r.worst).padStart(10)
  );
}

console.log('\n=== 3. Que pago haria rentable a Matches ===\n');
console.log('El pago justo de un evento 1-en-10 es x10.00 exacto.');
for (const m of [7, 8, 8.93, 9.5, 10, 10.5]) {
  const ev = Risk.expectedValue(0.1, m);
  console.log('  pago x' + m.toFixed(2).padStart(5) +
              '  ->  valor esperado ' + (ev * 100).toFixed(2).padStart(7) + '%' +
              '   (1 USD x 1000 operaciones = ' + usd(ev * 1000).padStart(8) + ' USD)');
}

console.log('\n=== 4. Riesgo de racha con martingala x2.2 (prob. de perder 90%) ===\n');
console.log('pasos'.padEnd(7), 'capital necesario'.padStart(18),
            'espera media'.padStart(14), 'en 50 ops'.padStart(11),
            'en 200 ops'.padStart(12));
console.log('-'.repeat(65));
for (const steps of [5, 6, 7, 8, 10, 12]) {
  const cap = 1 * (Math.pow(2.2, steps) - 1) / (2.2 - 1);
  // Espera media hasta encadenar `steps` perdidas seguidas (q=0.9).
  const q = 0.9, pw = 1 - q;
  const wait = (1 - Math.pow(q, steps)) / (pw * Math.pow(q, steps));
  console.log(
    String(steps).padEnd(7),
    (usd(cap) + ' USD').padStart(18),
    (wait.toFixed(0) + ' ops').padStart(14),
    pct(Risk.probOfLosingRun(0.9, steps, 50)).padStart(11),
    pct(Risk.probOfLosingRun(0.9, steps, 200)).padStart(12)
  );
}
console.log('');
