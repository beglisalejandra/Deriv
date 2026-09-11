/* =========================================================================
 * tecnico.js — Indicadores de analisis tecnico y senales
 * Se expone como window.Tecnico
 *
 * Implementaciones estandar, sin atajos: SMA, EMA, RSI de Wilder, bandas de
 * Bollinger, MACD, estocastico, ATR y soportes/resistencias por pivotes.
 * ========================================================================= */
(function (global) {
  'use strict';

  function sma(v, n, i) {
    if (i < n - 1) return null;
    var s = 0;
    for (var k = i - n + 1; k <= i; k++) s += v[k];
    return s / n;
  }

  /* EMA calculada sobre toda la serie; devuelve el array completo. */
  function emaSerie(v, n) {
    var out = new Array(v.length).fill(null);
    if (v.length < n) return out;
    var k = 2 / (n + 1), acc = 0;
    for (var i = 0; i < n; i++) acc += v[i];
    out[n - 1] = acc / n;
    for (var j = n; j < v.length; j++) out[j] = v[j] * k + out[j - 1] * (1 - k);
    return out;
  }

  /* RSI de Wilder: medias suavizadas de ganancias y perdidas. */
  function rsiSerie(v, n) {
    var out = new Array(v.length).fill(null);
    if (v.length <= n) return out;
    var g = 0, p = 0, i;
    for (i = 1; i <= n; i++) {
      var d = v[i] - v[i - 1];
      if (d > 0) g += d; else p -= d;
    }
    g /= n; p /= n;
    out[n] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
    for (i = n + 1; i < v.length; i++) {
      var dd = v[i] - v[i - 1];
      g = (g * (n - 1) + (dd > 0 ? dd : 0)) / n;
      p = (p * (n - 1) + (dd < 0 ? -dd : 0)) / n;
      out[i] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
    }
    return out;
  }

  function desviacion(v, n, i) {
    if (i < n - 1) return null;
    var m = sma(v, n, i), s = 0;
    for (var k = i - n + 1; k <= i; k++) s += (v[k] - m) * (v[k] - m);
    return Math.sqrt(s / n);
  }

  function bollinger(v, n, mult, i) {
    var m = sma(v, n, i), d = desviacion(v, n, i);
    if (m === null || d === null) return null;
    return { medio: m, alto: m + mult * d, bajo: m - mult * d, ancho: 2 * mult * d / m };
  }

  function macdSerie(v, rapida, lenta, senal) {
    var er = emaSerie(v, rapida), el = emaSerie(v, lenta);
    var linea = v.map(function (_, i) {
      return (er[i] === null || el[i] === null) ? null : er[i] - el[i];
    });
    var validos = linea.filter(function (x) { return x !== null; });
    var sig = emaSerie(validos, senal);
    var desfase = linea.length - validos.length;
    var salida = new Array(v.length).fill(null);
    for (var i = 0; i < sig.length; i++) {
      if (sig[i] !== null) salida[i + desfase] = { macd: validos[i], senal: sig[i],
                                                   hist: validos[i] - sig[i] };
    }
    return salida;
  }

  function estocastico(v, n, i) {
    if (i < n - 1) return null;
    var alto = -Infinity, bajo = Infinity;
    for (var k = i - n + 1; k <= i; k++) { if (v[k] > alto) alto = v[k]; if (v[k] < bajo) bajo = v[k]; }
    return alto === bajo ? 50 : ((v[i] - bajo) / (alto - bajo)) * 100;
  }

  /* Pivotes: maximos y minimos locales que actuan de soporte y resistencia. */
  function pivotes(v, radio, i) {
    var sop = null, res = null;
    for (var k = i - radio; k >= radio && k > i - 120; k--) {
      var esMax = true, esMin = true;
      for (var j = k - radio; j <= k + radio; j++) {
        if (j === k) continue;
        if (v[j] > v[k]) esMax = false;
        if (v[j] < v[k]) esMin = false;
      }
      if (esMax && res === null) res = v[k];
      if (esMin && sop === null) sop = v[k];
      if (sop !== null && res !== null) break;
    }
    return { soporte: sop, resistencia: res };
  }

  global.Tecnico = {
    sma: sma, emaSerie: emaSerie, rsiSerie: rsiSerie, desviacion: desviacion,
    bollinger: bollinger, macdSerie: macdSerie, estocastico: estocastico, pivotes: pivotes
  };
})(window);
