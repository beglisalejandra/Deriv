/* =========================================================================
 * edge.js — Motor de decision: probabilidad de exito, punto de equilibrio,
 *           deteccion de sesgo, calibracion y sostenibilidad.
 * Se expone como window.Edge
 *
 * La pregunta que responde este modulo no es "que digito va a salir" sino
 * la unica que decide si entrar o no:
 *
 *     P( probabilidad real de acierto  >  probabilidad de equilibrio | datos )
 *
 * Si ese numero no supera el umbral, la entrada pierde dinero en promedio
 * y la puerta no se abre.
 * ========================================================================= */
(function (global) {
  'use strict';

  var gammaln = global.MathUtil.gammaln;

  /* ------------------- Funcion beta incompleta regularizada ------------- */

  function betacf(a, b, x) {
    var FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return h;
  }

  // I_x(a,b) — tambien es la CDF de una Beta(a,b) evaluada en x.
  function betaCDF(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var lbt = gammaln(a + b) - gammaln(a) - gammaln(b) +
              a * Math.log(x) + b * Math.log(1 - x);
    var bt = Math.exp(lbt);
    return (x < (a + 1) / (a + b + 2))
      ? bt * betacf(a, b, x) / a
      : 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // Cuantil de una Beta(a,b) por biseccion sobre la CDF.
  function betaQuantile(p, a, b) {
    var lo = 0, hi = 1, mid;
    for (var i = 0; i < 200; i++) {
      mid = (lo + hi) / 2;
      if (betaCDF(mid, a, b) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ------------------------- Prueba binomial exacta ---------------------- */

  function logChoose(n, k) {
    return gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1);
  }

  // p-valor bilateral exacto de observar k exitos en n con probabilidad p.
  function binomTest(k, n, p) {
    if (n === 0) return 1;
    var lp = Math.log(p), lq = Math.log(1 - p);
    var pk = Math.exp(logChoose(n, k) + k * lp + (n - k) * lq);
    var total = 0, tol = pk * (1 + 1e-7);
    for (var i = 0; i <= n; i++) {
      var pi = Math.exp(logChoose(n, i) + i * lp + (n - i) * lq);
      if (pi <= tol) total += pi;
    }
    return Math.min(1, total);
  }

  // Correccion de Holm-Bonferroni: al mirar 10 digitos a la vez, el p-valor
  // crudo del mas extremo esta inflado. Esto lo corrige.
  function holm(pvalues) {
    var idx = pvalues.map(function (p, i) { return { p: p, i: i }; });
    idx.sort(function (a, b) { return a.p - b.p; });
    var m = idx.length, out = new Array(m), prev = 0;
    for (var r = 0; r < m; r++) {
      var adj = Math.min(1, (m - r) * idx[r].p);
      adj = Math.max(adj, prev);
      prev = adj;
      out[idx[r].i] = adj;
    }
    return out;
  }

  /* =======================================================================
   *  1. Probabilidad de exito de una entrada concreta
   * ===================================================================== */

  /* Probabilidad de equilibrio: por debajo de esta tasa de acierto, la
     operacion pierde dinero en promedio, por mucho que pague. */
  function breakEvenProb(payoutMult) {
    return 1 / payoutMult;
  }

  /*
   * Evalua una entrada.
   *   wins / n        -> veces que ese evento exacto ocurrio en la ventana
   *   payoutMult      -> multiplicador que cotiza la API ahora mismo
   *   theoreticalP    -> probabilidad del contrato bajo un RNG uniforme
   *   threshold       -> exigencia (0.95 = 95% de certeza de ser rentable)
   *   minSample       -> muestra minima para que la puerta pueda abrirse
   *
   * Prior de Jeffreys Beta(0.5, 0.5): deliberadamente debil, para que los
   * datos manden y el resultado no venga impuesto por la suposicion previa.
   */
  function evaluateEntry(o) {
    var n = o.n || 0, wins = o.wins || 0;
    var be = breakEvenProb(o.payoutMult);

    var a = 0.5 + wins;
    var b = 0.5 + (n - wins);

    var mean = a / (a + b);
    var lo = n > 0 ? betaQuantile(0.025, a, b) : 0;
    var hi = n > 0 ? betaQuantile(0.975, a, b) : 1;

    // P(p > equilibrio | datos) = 1 - CDF_Beta(equilibrio)
    var probProfitable = n > 0 ? 1 - betaCDF(be, a, b) : 0;

    var evTheoretical = o.theoreticalP * o.payoutMult - 1;
    var evPosterior = mean * o.payoutMult - 1;

    var reasons = [];
    var ok = true;

    if (n < (o.minSample || 500)) {
      ok = false;
      reasons.push('Muestra insuficiente: ' + n + ' de ' + (o.minSample || 500) +
                   ' observaciones minimas.');
    }
    if (probProfitable < (o.threshold || 0.95)) {
      ok = false;
      reasons.push('Certeza de rentabilidad ' + (probProfitable * 100).toFixed(1) +
                   '%, por debajo del ' + ((o.threshold || 0.95) * 100).toFixed(0) + '% exigido.');
    }
    if (o.theoreticalP * o.payoutMult < 1) {
      reasons.push('El pago x' + o.payoutMult.toFixed(2) + ' esta por debajo del pago justo x' +
                   (1 / o.theoreticalP).toFixed(2) + ': hace falta acertar ' +
                   (be * 100).toFixed(2) + '% para no perder, frente al ' +
                   (o.theoreticalP * 100).toFixed(2) + '% que da el generador.');
    }
    if (ok) reasons.push('La tasa de acierto medida supera el punto de equilibrio con la certeza exigida.');

    return {
      breakEven: be,
      needed: be,
      theoreticalP: o.theoreticalP,
      gap: o.theoreticalP - be,
      posterior: { a: a, b: b, mean: mean, lo: lo, hi: hi, n: n, wins: wins },
      probProfitable: probProfitable,
      evTheoretical: evTheoretical,
      evPosterior: evPosterior,
      decision: ok ? 'ENTRAR' : 'NO ENTRAR',
      ok: ok,
      reasons: reasons
    };
  }

  /* =======================================================================
   *  2. Deteccion de sesgo real en el simbolo
   * ===================================================================== */

  /*
   * Si un indice tuviera un sesgo explotable, apareceria aqui. Se prueba
   * cada digito por separado contra 10% y se corrige por las 10
   * comparaciones simultaneas, que es justo el paso que se salta cualquier
   * panel que informe "el digito mas frecuente va al 15.6%".
   */
  function biasScan(counts, total) {
    if (!total) return { ready: false };
    var raw = counts.map(function (c) { return binomTest(c, total, 0.1); });
    var adj = holm(raw);
    var digits = counts.map(function (c, d) {
      return {
        digit: d, count: c, freq: c / total,
        pRaw: raw[d], pAdj: adj[d],
        significant: adj[d] < 0.05
      };
    });
    var hits = digits.filter(function (x) { return x.significant; });
    var minAdj = Math.min.apply(null, adj);
    return {
      ready: true,
      total: total,
      digits: digits,
      significant: hits,
      anySignificant: hits.length > 0,
      minAdjusted: minAdj,
      // Sesgo minimo detectable con esta muestra (aprox. 2 errores estandar).
      detectable: 2 * Math.sqrt(0.1 * 0.9 / total)
    };
  }

  /* =======================================================================
   *  3. Calibracion: comprobar que la probabilidad anunciada es honesta
   * ===================================================================== */

  function Calibration(storageKey) {
    this.key = storageKey || 'deriv_calibracion';
    this.buckets = this._load();
  }

  Calibration.BANDS = [
    [0.00,0.05],[0.05,0.15],[0.15,0.25],[0.25,0.40],
    [0.40,0.60],[0.60,0.75],[0.75,0.90],[0.90,1.01]
  ];

  Calibration.prototype._empty = function () {
    return Calibration.BANDS.map(function () { return { n: 0, wins: 0, sum: 0 }; });
  };

  Calibration.prototype._load = function () {
    try {
      var raw = localStorage.getItem(this.key);
      if (raw) {
        var p = JSON.parse(raw);
        if (Array.isArray(p) && p.length === Calibration.BANDS.length) return p;
      }
    } catch (e) {}
    return this._empty();
  };

  Calibration.prototype._save = function () {
    try { localStorage.setItem(this.key, JSON.stringify(this.buckets)); } catch (e) {}
  };

  Calibration.prototype.reset = function () { this.buckets = this._empty(); this._save(); };

  Calibration.prototype.record = function (statedProb, won) {
    for (var i = 0; i < Calibration.BANDS.length; i++) {
      var band = Calibration.BANDS[i];
      if (statedProb >= band[0] && statedProb < band[1]) {
        this.buckets[i].n++;
        this.buckets[i].sum += statedProb;
        if (won) this.buckets[i].wins++;
        this._save();
        return;
      }
    }
  };

  Calibration.prototype.report = function () {
    var rows = [], totalN = 0, brier = 0;
    for (var i = 0; i < Calibration.BANDS.length; i++) {
      var bk = this.buckets[i];
      if (!bk.n) continue;
      var stated = bk.sum / bk.n;
      var real = bk.wins / bk.n;
      totalN += bk.n;
      rows.push({
        band: Calibration.BANDS[i],
        n: bk.n,
        stated: stated,
        realized: real,
        error: real - stated,
        ci: global.MathUtil.wilson(bk.wins, bk.n)
      });
    }
    // Error medio absoluto de calibracion, ponderado por muestra.
    var mae = 0;
    rows.forEach(function (r) { mae += Math.abs(r.error) * r.n; });
    return { rows: rows, total: totalN, mae: totalN ? mae / totalN : null };
  };

  /* =======================================================================
   *  4. Sostenibilidad: cuanto dura el capital
   * ===================================================================== */

  // Fraccion de Kelly. Negativa => la apuesta destruye capital: no apostar.
  function kelly(p, payoutMult) {
    var b = payoutMult - 1;
    if (b <= 0) return 0;
    return (p * b - (1 - p)) / b;
  }

  // Generador determinista para que las simulaciones sean reproducibles.
  function xorshift(seed) {
    var s = seed >>> 0 || 88675123;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  /*
   * Simula sesiones con stake fijo y devuelve cuanto sobrevive el capital.
   * Con valor esperado negativo la ruina es cuestion de tiempo; lo que se
   * decide aqui es cuanto tiempo.
   */
  function sustainability(o) {
    var p = o.winProb, m = o.payoutMult, stake = o.stake;
    var bankroll = o.bankroll, maxTrades = o.maxTrades || 5000;
    var runs = o.runs || 3000;
    var rnd = xorshift(12345);

    var ruined = 0, sumTrades = 0, sumFinal = 0, survived = 0;
    for (var r = 0; r < runs; r++) {
      var cap = bankroll, t = 0;
      while (t < maxTrades && cap >= stake) {
        cap += (rnd() < p) ? stake * (m - 1) : -stake;
        t++;
      }
      if (cap < stake) { ruined++; sumTrades += t; }
      else { survived++; sumTrades += t; }
      sumFinal += cap;
    }

    var ev = p * m - 1;
    // Vida media analitica: capital / sangria esperada por operacion.
    var analytic = ev < 0 ? bankroll / (stake * -ev) : Infinity;

    return {
      ev: ev,
      bleedPerTrade: stake * ev,
      ruinRate: ruined / runs,
      avgTrades: sumTrades / runs,
      avgFinal: sumFinal / runs,
      analyticLifetime: analytic,
      kelly: kelly(p, m)
    };
  }


  /* Cuenta, sobre un historial de digitos, cuantas veces habria ganado esta
     apuesta exacta. */
  function countWins(digits, type, barrier) {
    var w = 0;
    for (var i = 0; i < digits.length; i++) {
      var d = digits[i];
      if (type === 'DIGITMATCH')      { if (d === barrier) w++; }
      else if (type === 'DIGITDIFF')  { if (d !== barrier) w++; }
      else if (type === 'DIGITOVER')  { if (d > barrier) w++; }
      else if (type === 'DIGITUNDER') { if (d < barrier) w++; }
      else if (type === 'DIGITEVEN')  { if (d % 2 === 0) w++; }
      else if (type === 'DIGITODD')   { if (d % 2 === 1) w++; }
    }
    return w;
  }

  global.Edge = {
    betaCDF: betaCDF,
    betaQuantile: betaQuantile,
    binomTest: binomTest,
    holm: holm,
    countWins: countWins,
    breakEvenProb: breakEvenProb,
    evaluateEntry: evaluateEntry,
    biasScan: biasScan,
    Calibration: Calibration,
    kelly: kelly,
    sustainability: sustainability
  };
})(window);
