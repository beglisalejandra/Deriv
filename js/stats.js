/* =========================================================================
 * stats.js — Analisis de digitos, pruebas estadisticas y riesgo
 * Se expone como window.DigitStats y window.Risk
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------- Utilidades numericas ------------------------- */

  // Funcion gamma logaritmica (Lanczos).
  function gammaln(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  // Gamma incompleta regularizada P(a,x) por serie.
  function gser(a, x) {
    var ap = a, sum = 1 / a, del = sum;
    for (var n = 0; n < 500; n++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }

  // Gamma incompleta regularizada Q(a,x) por fraccion continua.
  function gcf(a, x) {
    var FPMIN = 1e-300, b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (var i = 1; i <= 500; i++) {
      var an = -i * (i - a);
      b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
  }

  // P(X > x) para una chi-cuadrado con df grados de libertad.
  function chiSquareP(x, df) {
    if (x <= 0) return 1;
    var a = df / 2;
    return (x < a + 1) ? 1 - gser(a, x / 2) : gcf(a, x / 2);
  }

  // Intervalo de Wilson al 95% para una proporcion. Honesto con muestras chicas.
  function wilson(successes, n) {
    if (n === 0) return { low: 0, high: 1, p: 0 };
    var z = 1.959964, p = successes / n, z2 = z * z;
    var denom = 1 + z2 / n;
    var centre = (p + z2 / (2 * n)) / denom;
    var margin = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
    return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin), p: p };
  }

  /* --------------------------- Analisis de digitos ------------------------ */

  function DigitStats(maxSize) {
    this.max = maxSize || 5000;
    this.digits = [];
    this.prices = [];
  }

  DigitStats.prototype.reset = function () { this.digits = []; this.prices = []; };

  // Deriv define el ultimo digito sobre el precio formateado a pip_size decimales.
  DigitStats.lastDigit = function (quote, pipSize) {
    var s = Number(quote).toFixed(pipSize);
    return Number(s.charAt(s.length - 1));
  };

  DigitStats.prototype.push = function (quote, pipSize) {
    var d = DigitStats.lastDigit(quote, pipSize);
    this.digits.push(d);
    this.prices.push(Number(quote));
    if (this.digits.length > this.max) { this.digits.shift(); this.prices.shift(); }
    return d;
  };

  DigitStats.prototype.window = function (n) {
    if (!n || n >= this.digits.length) return this.digits.slice();
    return this.digits.slice(this.digits.length - n);
  };

  DigitStats.prototype.counts = function (n) {
    var w = this.window(n), c = [0,0,0,0,0,0,0,0,0,0];
    for (var i = 0; i < w.length; i++) c[w[i]]++;
    return { counts: c, total: w.length };
  };

  DigitStats.prototype.last = function () {
    return this.digits.length ? this.digits[this.digits.length - 1] : null;
  };

  DigitStats.prototype.lastPrice = function () {
    return this.prices.length ? this.prices[this.prices.length - 1] : null;
  };

  // Racha actual: cuantas veces seguidas se repite el ultimo digito.
  DigitStats.prototype.streak = function () {
    var d = this.digits, n = d.length;
    if (!n) return 0;
    var k = 1;
    for (var i = n - 2; i >= 0 && d[i] === d[n - 1]; i--) k++;
    return k;
  };

  // Reporte completo sobre una ventana de n ticks.
  DigitStats.prototype.report = function (n) {
    var r = this.counts(n), c = r.counts, total = r.total;
    var pct = c.map(function (x) { return total ? x / total : 0; });

    var hot = 0, cold = 0;
    for (var i = 1; i < 10; i++) {
      if (c[i] > c[hot]) hot = i;
      if (c[i] < c[cold]) cold = i;
    }

    var even = 0;
    for (var j = 0; j < 10; j += 2) even += c[j];
    var odd = total - even;

    // Chi-cuadrado de uniformidad: 9 grados de libertad, esperado = total/10.
    var expected = total / 10, chi = 0;
    if (total > 0) {
      for (var k = 0; k < 10; k++) { var diff = c[k] - expected; chi += diff * diff / expected; }
    }
    var pValue = total >= 30 ? chiSquareP(chi, 9) : null;

    return {
      total: total,
      counts: c,
      pct: pct,
      hot: hot,
      cold: cold,
      hotCI: wilson(c[hot], total),
      coldCI: wilson(c[cold], total),
      even: even,
      odd: odd,
      evenPct: total ? even / total : 0,
      chi2: chi,
      pValue: pValue,           // p bajo (<0.05) => la muestra se desvia de lo uniforme
      isSkewed: pValue !== null && pValue < 0.05,
      streak: this.streak(),
      last: this.last(),
      lastPrice: this.lastPrice()
    };
  };

  // Cuantos de los ultimos n ticks fueron > barrera y < barrera.
  DigitStats.prototype.overUnder = function (barrier, n) {
    var w = this.window(n), over = 0, under = 0, eq = 0;
    for (var i = 0; i < w.length; i++) {
      if (w[i] > barrier) over++;
      else if (w[i] < barrier) under++;
      else eq++;
    }
    return { over: over, under: under, equal: eq, total: w.length };
  };

  /* ------------------------------ Estrategias ----------------------------- */
  /* Cada estrategia devuelve {contract_type, barrier, reason, observed}.
     `observed` es la frecuencia medida del evento en la ventana: es un dato
     descriptivo del pasado, NO una probabilidad del proximo tick.           */

  var STRATEGIES = {
    matches_hot: {
      label: 'Matches — digito mas frecuente',
      payoutClass: 'alto',
      run: function (rep) {
        return {
          contract_type: 'DIGITMATCH',
          barrier: rep.hot,
          observed: rep.pct[rep.hot],
          ci: rep.hotCI,
          reason: 'El digito ' + rep.hot + ' aparecio ' + rep.counts[rep.hot] + ' de ' + rep.total +
                  ' ticks (' + (rep.pct[rep.hot] * 100).toFixed(1) + '%).'
        };
      }
    },
    matches_cold: {
      label: 'Matches — digito menos frecuente (reversion)',
      payoutClass: 'alto',
      run: function (rep) {
        return {
          contract_type: 'DIGITMATCH',
          barrier: rep.cold,
          observed: rep.pct[rep.cold],
          ci: rep.coldCI,
          reason: 'El digito ' + rep.cold + ' esta rezagado (' + rep.counts[rep.cold] + '/' + rep.total +
                  '). Apuesta de reversion a la media.'
        };
      }
    },
    differs_cold: {
      label: 'Differs — contra el digito menos frecuente',
      payoutClass: 'bajo',
      run: function (rep) {
        return {
          contract_type: 'DIGITDIFF',
          barrier: rep.cold,
          observed: 1 - rep.pct[rep.cold],
          ci: null,
          reason: 'Gana si el proximo digito NO es ' + rep.cold + '.'
        };
      }
    },
    over_8: {
      label: 'Over 8 — solo gana el 9',
      payoutClass: 'alto',
      run: function (rep) {
        return {
          contract_type: 'DIGITOVER', barrier: 8,
          observed: rep.pct[9], ci: null,
          reason: 'Gana solo con el digito 9.'
        };
      }
    },
    under_1: {
      label: 'Under 1 — solo gana el 0',
      payoutClass: 'alto',
      run: function (rep) {
        return {
          contract_type: 'DIGITUNDER', barrier: 1,
          observed: rep.pct[0], ci: null,
          reason: 'Gana solo con el digito 0.'
        };
      }
    },
    over_dynamic: {
      label: 'Over / Under dinamico',
      payoutClass: 'medio',
      run: function (rep) {
        // Elige el lado con mas peso observado alrededor de la mediana.
        var lowSum = 0, highSum = 0, i;
        for (i = 0; i <= 4; i++) lowSum += rep.counts[i];
        for (i = 5; i <= 9; i++) highSum += rep.counts[i];
        if (highSum >= lowSum) {
          return { contract_type: 'DIGITOVER', barrier: 4,
                   observed: rep.total ? highSum / rep.total : 0, ci: null,
                   reason: 'Los digitos 5-9 dominan (' + highSum + ' vs ' + lowSum + ').' };
        }
        return { contract_type: 'DIGITUNDER', barrier: 5,
                 observed: rep.total ? lowSum / rep.total : 0, ci: null,
                 reason: 'Los digitos 0-4 dominan (' + lowSum + ' vs ' + highSum + ').' };
      }
    },
    even_odd: {
      label: 'Par / Impar',
      payoutClass: 'bajo',
      run: function (rep) {
        var even = rep.evenPct >= 0.5;
        return {
          contract_type: even ? 'DIGITEVEN' : 'DIGITODD',
          barrier: null,
          observed: even ? rep.evenPct : 1 - rep.evenPct,
          ci: null,
          reason: (even ? 'Pares' : 'Impares') + ' van adelante en la ventana.'
        };
      }
    },
    random_match: {
      label: 'Matches al azar (control)',
      payoutClass: 'alto',
      run: function (rep) {
        var b = Math.floor(Math.random() * 10);
        return {
          contract_type: 'DIGITMATCH', barrier: b, observed: 0.1, ci: null,
          reason: 'Digito elegido al azar. Es la linea base contra la que se mide todo lo demas.'
        };
      }
    }
  };

  // Probabilidad teorica de ganar de cada tipo de contrato (RNG uniforme).
  function theoreticalWinProb(contractType, barrier) {
    switch (contractType) {
      case 'DIGITMATCH': return 0.1;
      case 'DIGITDIFF':  return 0.9;
      case 'DIGITOVER':  return (9 - barrier) / 10;
      case 'DIGITUNDER': return barrier / 10;
      case 'DIGITEVEN':  return 0.5;
      case 'DIGITODD':   return 0.5;
      default: return null;
    }
  }

  /* ------------------------------- Riesgo -------------------------------- */

  var Risk = {};

  // Escalera de stakes de un martingala: stake_k = base * factor^k
  Risk.ladder = function (base, factor, steps) {
    var rows = [], cum = 0;
    for (var k = 0; k < steps; k++) {
      var stake = base * Math.pow(factor, k);
      cum += stake;
      rows.push({ step: k + 1, stake: stake, cumulative: cum });
    }
    return rows;
  };

  // P(al menos una racha de `run` perdidas en `trials` operaciones).
  // Recursion clasica: A(m) = A(m-1) - p*q^run*A(m-run-1)
  Risk.probOfLosingRun = function (lossProb, run, trials) {
    if (run <= 0) return 1;
    if (trials < run) return 0;
    var q = lossProb, p = 1 - q;
    var A = new Array(trials + 1);
    for (var m = 0; m < run; m++) A[m] = 1;
    A[run] = 1 - Math.pow(q, run);
    for (var i = run + 1; i <= trials; i++) {
      A[i] = A[i - 1] - p * Math.pow(q, run) * A[i - run - 1];
      if (A[i] < 0) A[i] = 0;
    }
    return 1 - A[trials];
  };

  // Valor esperado por operacion, en fraccion del stake.
  // payoutMult = pago total / stake (lo que devuelve la API en payout/ask_price)
  Risk.expectedValue = function (winProb, payoutMult) {
    return winProb * payoutMult - 1;
  };

  // Utilidades numericas reutilizadas por edge.js
  global.MathUtil = { gammaln: gammaln, chiSquareP: chiSquareP, wilson: wilson };

  global.DigitStats = DigitStats;
  global.DigitStats.STRATEGIES = STRATEGIES;
  global.DigitStats.theoreticalWinProb = theoreticalWinProb;
  global.DigitStats.wilson = wilson;
  global.DigitStats.chiSquareP = chiSquareP;
  global.Risk = Risk;
})(window);
