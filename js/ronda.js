/* =========================================================================
 * ronda.js — Matematica de una RONDA completa (del inicio al TP o al SL)
 * Se expone como window.Ronda
 *
 * Una ronda no es una operacion: es la secuencia de operaciones que hace el
 * bot hasta alcanzar el objetivo de ganancia o el limite de perdida. Su
 * probabilidad de exito es un problema de ruina del jugador con premio
 * asimetrico, y tiene solucion exacta.
 * ========================================================================= */
(function (global) {
  'use strict';

  /* Contratos disponibles, con su probabilidad real y su pago tipico.
     El pago se confirma en vivo contra la API cuando hay conexion. */
  var CONTRATOS = {
    DIGITMATCH: { nombre:'Matches',  prob:0.10, pago:8.93, barrera:true,
                  desc:'Gana si el ultimo digito ES el elegido' },
    DIGITDIFF:  { nombre:'Differs',  prob:0.90, pago:1.09, barrera:true,
                  desc:'Gana si el ultimo digito NO es el elegido' },
    DIGITEVEN:  { nombre:'Par',      prob:0.50, pago:1.95, barrera:false,
                  desc:'Gana si el ultimo digito es par' },
    DIGITODD:   { nombre:'Impar',    prob:0.50, pago:1.95, barrera:false,
                  desc:'Gana si el ultimo digito es impar' },
    DIGITOVER:  { nombre:'Over',     prob:null, pago:null, barrera:true,
                  desc:'Gana si el ultimo digito es mayor que la barrera' },
    DIGITUNDER: { nombre:'Under',    prob:null, pago:null, barrera:true,
                  desc:'Gana si el ultimo digito es menor que la barrera' }
  };

  function probDe(tipo, barrera) {
    if (tipo === 'DIGITOVER')  return (9 - Number(barrera)) / 10;
    if (tipo === 'DIGITUNDER') return Number(barrera) / 10;
    return CONTRATOS[tipo] ? CONTRATOS[tipo].prob : null;
  }

  /* Pago justo menos la comision de la casa, que crece cuanto mas raro es
     el evento. Anclas reales: x8.93 para el 10%, x1.09 para el 90%. */
  function pagoDe(tipo, barrera) {
    var c = CONTRATOS[tipo];
    if (c && c.pago) return c.pago;
    var p = probDe(tipo, barrera);
    if (!p) return null;
    var com = p <= 0.2 ? 0.1071 : p >= 0.8 ? 0.0190
            : 0.1071 + ((p - 0.2) / 0.6) * (0.0190 - 0.1071);
    return (1 / p) * (1 - com);
  }

  /* ---------------------------------------------------------------------
   * Probabilidad de alcanzar +TP antes de -SL.
   * Iteracion de valor sobre el estado = ganancia acumulada en centimos.
   * ------------------------------------------------------------------- */
  function probExito(stake, pago, pWin, TP, SL) {
    var gana = Math.round(stake * (pago - 1) * 100);
    var pierde = Math.round(stake * 100);
    if (gana <= 0 || pierde <= 0) return 0;

    var tope = Math.round(TP * 100), suelo = -Math.round(SL * 100);
    if (tope <= 0 || suelo >= 0) return 0;

    var N = tope - suelo + 1;
    if (N > 400000) return NaN;                 // configuracion desproporcionada

    var f = new Float64Array(N), g = new Float64Array(N);
    var off = -suelo;                            // indice = x + off

    for (var it = 0; it < 2000; it++) {
      var dif = 0;
      for (var x = suelo + 1; x < tope; x++) {
        var up = x + gana, dn = x - pierde;
        var fu = up >= tope ? 1 : f[up + off];
        var fd = dn <= suelo ? 0 : f[dn + off];
        var v = pWin * fu + (1 - pWin) * fd;
        var d = v - g[x + off];
        if (d < 0) d = -d;
        if (d > dif) dif = d;
        g[x + off] = v;
      }
      g[tope + off] = 1; g[suelo + off] = 0;
      var t = f; f = g; g = t;
      if (dif < 1e-13) break;
    }
    return f[off];
  }

  /* Numero medio de operaciones que dura una ronda. */
  function duracionMedia(stake, pago, pWin, TP, SL) {
    var gana = Math.round(stake * (pago - 1) * 100);
    var pierde = Math.round(stake * 100);
    var tope = Math.round(TP * 100), suelo = -Math.round(SL * 100);
    var N = tope - suelo + 1;
    if (N > 400000) return NaN;
    var f = new Float64Array(N), g = new Float64Array(N), off = -suelo;
    for (var it = 0; it < 2000; it++) {
      var dif = 0;
      for (var x = suelo + 1; x < tope; x++) {
        var up = x + gana, dn = x - pierde;
        var fu = up >= tope ? 0 : f[up + off];
        var fd = dn <= suelo ? 0 : f[dn + off];
        var v = 1 + pWin * fu + (1 - pWin) * fd;
        var d = Math.abs(v - g[x + off]);
        if (d > dif) dif = d;
        g[x + off] = v;
      }
      var t = f; f = g; g = t;
      if (dif < 1e-9) break;
    }
    return f[off];
  }

  /* Analisis completo de una configuracion de ronda. */
  function analizar(cfg) {
    var p = probDe(cfg.tipo, cfg.barrera);
    var pago = cfg.pago || pagoDe(cfg.tipo, cfg.barrera);
    if (!p || !pago) return null;

    var exito = probExito(cfg.stake, pago, p, cfg.tp, cfg.sl);
    var ve = exito * cfg.tp - (1 - exito) * cfg.sl;
    var ops = duracionMedia(cfg.stake, pago, p, cfg.tp, cfg.sl);

    return {
      probOperacion: p,
      pago: pago,
      equilibrio: 1 / pago,
      veOperacion: p * pago - 1,
      probExito: exito,
      veRonda: ve,
      operacionesMedias: ops,
      // Con 1 tick por segundo en los indices (1s)
      minutosMedios: ops ? ops * 2 / 60 : null,
      ratio: cfg.tp / cfg.sl
    };
  }

  /* ---------------------------------------------------------------------
   * Busca, para un riesgo dado, que objetivo maximiza cada criterio.
   * ------------------------------------------------------------------- */
  function recomendar(cfg) {
    var opciones = [];
    var paso = cfg.sl <= 10 ? 0.5 : 1;
    for (var tp = paso; tp <= cfg.sl * 3; tp += paso) {
      var a = analizar({ tipo:cfg.tipo, barrera:cfg.barrera, stake:cfg.stake,
                         tp: Math.round(tp * 100) / 100, sl: cfg.sl, pago: cfg.pago });
      if (!a || !isFinite(a.probExito)) continue;
      opciones.push({ tp: Math.round(tp * 100) / 100, sl: cfg.sl,
                      exito: a.probExito, ve: a.veRonda, ops: a.operacionesMedias });
    }
    if (!opciones.length) return null;

    var masSeguro = opciones.slice().sort(function (a, b) { return b.exito - a.exito; })[0];
    var menosMalo = opciones.slice().sort(function (a, b) { return b.ve - a.ve; })[0];
    // Equilibrado: mejor VE entre los que superan el 50% de exito
    var conMedia = opciones.filter(function (o) { return o.exito >= 0.5; })
                           .sort(function (a, b) { return b.ve - a.ve; });
    return {
      masSeguro: masSeguro,
      menosMalo: menosMalo,
      equilibrado: conMedia.length ? conMedia[0] : masSeguro,
      todas: opciones
    };
  }

  global.Ronda = {
    CONTRATOS: CONTRATOS,
    probDe: probDe,
    pagoDe: pagoDe,
    probExito: probExito,
    duracionMedia: duracionMedia,
    analizar: analizar,
    recomendar: recomendar
  };
})(window);
