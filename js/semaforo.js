/* =========================================================================
 * semaforo.js — Observa el mercado real de Deriv y dice cuando abrir ronda
 *
 * No accede a ninguna cuenta: los datos de mercado de Deriv son publicos,
 * los mismos que muestra charts.deriv.com. Aqui solo se leen.
 * ========================================================================= */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var api = new window.DerivAPI();
  var stats = new window.DigitStats(5000);

  var APP_ID = '1089';
  var estado = { corriendo:false, sub:null, pipSize:2, pagoReal:null, ultimoAnalisis:null };

  var COLORES = ['#dc2626','#ea580c','#d97706','#65a30d','#16a34a',
                 '#0d9488','#0284c7','#4f46e5','#9333ea','#db2777'];

  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d) + '%'; }
  function usd(x) { return (x < 0 ? '-' : '+') + Math.abs(x).toFixed(2); }

  /* ------------------------- Configuracion actual ----------------------- */

  function cfg() {
    var tipo = $('tipo').value;
    return {
      simbolo: $('simbolo').value,
      tipo: tipo,
      barrera: Number($('barrera').value),
      stake: Number($('stake').value) || 1,
      tp: Number($('tp').value) || 1,
      sl: Number($('sl').value) || 1,
      pago: estado.pagoReal
    };
  }

  function guardar() {
    var o = {};
    ['simbolo','tipo','barrera','stake','tp','sl'].forEach(function (id) { o[id] = $(id).value; });
    try { localStorage.setItem('semaforo_cfg', JSON.stringify(o)); } catch (e) {}
  }

  function cargar() {
    try {
      var o = JSON.parse(localStorage.getItem('semaforo_cfg') || '{}');
      Object.keys(o).forEach(function (id) { if ($(id)) $(id).value = o[id]; });
    } catch (e) {}
  }

  /* ------------------- Analisis de la configuracion --------------------- */

  function analizarConfig() {
    var c = cfg();
    var a = window.Ronda.analizar(c);
    if (!a) return null;

    $('dAcierto').textContent = pct(a.probOperacion);
    $('dPago').textContent = 'x' + a.pago.toFixed(2);
    $('dEquilibrio').textContent = pct(a.equilibrio, 2);
    $('dDuracion').textContent = a.operacionesMedias
      ? Math.round(a.operacionesMedias) + ' ops (~' + a.minutosMedios.toFixed(0) + ' min)' : '—';

    var linea = function (k, v, cls) {
      return '<div class="line"><span>' + k + '</span><b class="' + (cls||'') + '">' + v + '</b></div>';
    };
    $('dResumen').innerHTML =
      linea('Probabilidad de llegar a +' + c.tp.toFixed(0) + ' antes de -' + c.sl.toFixed(0),
            pct(a.probExito), a.probExito >= 0.5 ? 'pos' : 'neg') +
      linea('Resultado medio por ronda', usd(a.veRonda) + ' USD', a.veRonda >= 0 ? 'pos' : 'neg') +
      linea('Valor esperado por operacion', pct(a.veOperacion, 2), a.veOperacion >= 0 ? 'pos' : 'neg') +
      linea('Rondas hasta perder ' + c.sl.toFixed(0) + ' USD netos',
            a.veRonda < 0 ? Math.round(c.sl / -a.veRonda) : '—');

    estado.ultimoAnalisis = a;
    return a;
  }

  /* ------------------------- Recomendaciones ---------------------------- */

  function recomendar() {
    var c = cfg();
    var r = window.Ronda.recomendar(c);
    if (!r) return;

    var cajas = [
      { t:'Mas probable de cerrar en verde', o:r.masSeguro, tag:'exito' },
      { t:'La que menos cuesta', o:r.menosMalo, tag:'ve' },
      { t:'Equilibrada', o:r.equilibrado, tag:'eq' }
    ];
    // Quitar duplicados por TP
    var vistos = {};
    cajas = cajas.filter(function (x) {
      if (vistos[x.o.tp]) return false;
      vistos[x.o.tp] = 1; return true;
    });

    $('recos').innerHTML = cajas.map(function (x, i) {
      return '<button data-tp="' + x.o.tp + '" class="' + (i === 0 ? 'mejor' : '') + '">' +
        '<b>Arriesga ' + c.sl.toFixed(0) + ' USD buscando ' + x.o.tp.toFixed(2) + ' USD</b>' +
        '<small>' + x.t + ' · exito ' + pct(x.o.exito) +
        ' · resultado medio ' + usd(x.o.ve) + ' USD · ~' + Math.round(x.o.ops) + ' operaciones</small>' +
        '</button>';
    }).join('');

    Array.prototype.forEach.call($('recos').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        $('tp').value = b.dataset.tp;
        guardar(); refrescarTodo();
      });
    });

    // Tabla resumida
    var actual = Number($('tp').value);
    var filas = r.todas.filter(function (o, i) { return i % Math.ceil(r.todas.length / 12) === 0
                                                     || Math.abs(o.tp - actual) < 0.01; });
    $('tablaTp').querySelector('tbody').innerHTML = filas.map(function (o) {
      return '<tr class="' + (Math.abs(o.tp - actual) < 0.01 ? 'actual' : '') + '">' +
        '<td>+' + o.tp.toFixed(2) + '</td>' +
        '<td>' + pct(o.exito) + '</td>' +
        '<td class="' + (o.ve >= 0 ? 'pos' : 'neg') + '">' + usd(o.ve) + '</td>' +
        '<td>' + Math.round(o.ops) + ' ops</td></tr>';
    }).join('');
  }

  /* --------------------------- El semaforo ------------------------------ */

  function evaluarMomento() {
    var c = cfg();
    var a = estado.ultimoAnalisis;
    if (!a) return null;
    if (stats.digits.length < 100) return { listo:false, n:stats.digits.length };

    var aciertos = window.Edge.countWins(stats.digits, c.tipo, c.barrera);
    var g = window.Edge.evaluateEntry({
      wins: aciertos, n: stats.digits.length,
      payoutMult: a.pago, theoreticalP: a.probOperacion,
      threshold: 0.5, minSample: 100
    });
    return { listo:true, gate:g, analisis:a, freq: aciertos / stats.digits.length };
  }

  function pintarSemaforo() {
    var t = $('tarjetaLuz');
    var a = estado.ultimoAnalisis;
    if (!a) return;

    $('exitoRonda').textContent = pct(a.probExito);

    if (!estado.corriendo) {
      t.className = 'card luz';
      $('luzTexto').textContent = 'Detenido';
      $('luzSub').textContent = 'Pulsa INICIAR para observar el mercado.';
      $('momento').textContent = '—';
      return;
    }

    var m = evaluarMomento();
    if (!m || !m.listo) {
      t.className = 'card luz';
      $('luzTexto').textContent = 'Midiendo…';
      $('luzSub').textContent = 'Acumulando ticks (' + (m ? m.n : 0) + ' de 100).';
      $('momento').textContent = '—';
      return;
    }

    var pMomento = m.gate.probProfitable;
    $('momento').textContent = pct(pMomento);

    var luz, texto, sub;
    if (a.probExito < 0.40) {
      luz = 'rojo';
      texto = 'NO ENTRAR';
      sub = 'La configuracion es mala: solo ' + pct(a.probExito) +
            ' de cerrar en verde. Aplica una ronda recomendada abajo.';
    } else if (pMomento < 0.50) {
      luz = 'ambar';
      texto = 'ESPERA';
      sub = 'La configuracion aguanta (' + pct(a.probExito) + '), pero ahora mismo el evento ' +
            'va por debajo de su equilibrio. Espera al verde.';
    } else {
      luz = 'verde';
      texto = 'PUEDES ENTRAR';
      sub = 'Configuracion de ' + pct(a.probExito) + ' de exito y el evento esta en o por ' +
            'encima del equilibrio. Es de los mejores momentos disponibles.';
    }

    t.className = 'card luz ' + luz;
    $('luzTexto').textContent = texto;
    $('luzSub').textContent = sub;

    $('luzDetalle').innerHTML =
      'Medido sobre ' + stats.digits.length + ' ticks: el evento ocurre el <b>' +
      pct(m.freq, 2) + '</b> de las veces y necesita <b>' + pct(a.equilibrio, 2) +
      '</b> para cubrir el pago. Resultado medio de esta ronda: <b>' +
      usd(a.veRonda) + ' USD</b>.';
  }

  /* --------------------------- Mercado en vivo -------------------------- */

  function pintarMercado() {
    if (!stats.digits.length) return;
    var rep = stats.report(1000);
    $('precio').textContent = Number(rep.lastPrice).toFixed(estado.pipSize);

    var c = $('digito');
    c.textContent = rep.last;
    c.style.background = COLORES[rep.last];

    var b = $('barras');
    if (b.children.length !== 10) {
      b.innerHTML = '';
      for (var i = 0; i < 10; i++) {
        var d = document.createElement('div');
        d.className = 'bar';
        d.innerHTML = '<u></u><i></i><em>' + i + '</em>';
        b.appendChild(d);
      }
    }
    var mx = Math.max.apply(null, rep.pct) || 0.1;
    for (var k = 0; k < 10; k++) {
      var el = b.children[k];
      el.className = 'bar' + (k === rep.hot ? ' hot' : k === rep.cold ? ' cold' : '');
      el.querySelector('u').textContent = (rep.pct[k] * 100).toFixed(1);
      el.querySelector('i').style.height = Math.max(2, (rep.pct[k] / mx) * 100) + '%';
    }

    $('sTicks').textContent = stats.digits.length;
    var a = estado.ultimoAnalisis;
    if (a) {
      var w = window.Edge.countWins(stats.digits, cfg().tipo, cfg().barrera);
      $('sFreq').textContent = pct(w / stats.digits.length, 2);
      $('sEq').textContent = pct(a.equilibrio, 2);
    }
    $('sChi').textContent = rep.pValue === null ? '—'
      : rep.chi2.toFixed(1) + ' (' + rep.pValue.toFixed(3) + ')';
  }

  /* ----------------------------- Conexion ------------------------------- */

  function iniciar() {
    $('connDot').className = 'dot wait';
    $('estadoBadge').textContent = 'conectando';
    $('btnIniciar').disabled = true;

    api.connect(APP_ID)
      .then(function () {
        stats.reset();
        return api.ticksHistory(cfg().simbolo, 1000,
          function (t) {
            if (t.pip_size !== undefined) estado.pipSize = t.pip_size;
            stats.push(t.quote, estado.pipSize);
            pintarMercado(); pintarSemaforo();
          },
          function (h, pip) {
            if (pip !== undefined) estado.pipSize = pip;
            for (var i = 0; i < h.prices.length; i++) stats.push(h.prices[i], estado.pipSize);
            pintarMercado(); pintarSemaforo();
          });
      })
      .then(function (s) {
        estado.sub = s.reqId;
        estado.corriendo = true;
        $('connDot').className = 'dot on';
        $('estadoBadge').textContent = 'en vivo';
        $('estadoBadge').className = 'badge demo';
        $('btnIniciar').textContent = 'DETENER';
        $('btnIniciar').disabled = false;
        $('subtitle').textContent = 'Observando ' + $('simbolo').selectedOptions[0].textContent;
        pedirPagoReal();
      })
      .catch(function (e) {
        $('connDot').className = 'dot';
        $('estadoBadge').textContent = 'error';
        $('btnIniciar').disabled = false;
        $('luzTexto').textContent = 'Sin conexion';
        $('luzSub').textContent = 'No se pudo leer el mercado de Deriv: ' + e.message +
          (e.code ? ' [' + e.code + ']' : '');
      });
  }

  /* El pago verdadero lo cotiza la API; si no responde se usa el estimado. */
  function pedirPagoReal() {
    var c = cfg();
    api.proposal({
      amount: c.stake, contract_type: c.tipo, currency: 'USD',
      duration: 1, duration_unit: 't', symbol: c.simbolo,
      barrier: window.Ronda.CONTRATOS[c.tipo].barrera ? c.barrera : undefined
    }).then(function (p) {
      estado.pagoReal = p.payout / p.ask_price;
      $('notaMercado').textContent = 'Pago confirmado con la API de Deriv: x' +
        estado.pagoReal.toFixed(2) + '. Mismos datos que charts.deriv.com.';
      refrescarTodo();
    }).catch(function () {
      estado.pagoReal = null;
      $('notaMercado').textContent = 'La API no cotiza el pago sin cuenta; se usa el valor ' +
        'tipico del contrato. Los datos de mercado si son reales.';
    });
  }

  function detener() {
    if (estado.sub !== null) { api.forget(estado.sub); estado.sub = null; }
    api.disconnect();
    estado.corriendo = false;
    $('connDot').className = 'dot';
    $('estadoBadge').textContent = 'detenido';
    $('estadoBadge').className = 'badge';
    $('btnIniciar').textContent = 'INICIAR';
    pintarSemaforo();
  }

  $('btnIniciar').addEventListener('click', function () {
    if (estado.corriendo) detener(); else iniciar();
  });

  /* ------------------------------- Enlaces ------------------------------ */

  function refrescarTodo() {
    $('labBarrera').style.display =
      window.Ronda.CONTRATOS[$('tipo').value].barrera ? '' : 'none';
    analizarConfig();
    recomendar();
    pintarSemaforo();
    pintarMercado();
  }

  ['simbolo','tipo','barrera','stake','tp','sl'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      guardar();
      if (id === 'simbolo' && estado.corriendo) { detener(); iniciar(); }
      else refrescarTodo();
    });
    $(id).addEventListener('input', function () { guardar(); refrescarTodo(); });
  });

  cargar();
  refrescarTodo();
  setInterval(function () { if (estado.corriendo) pintarSemaforo(); }, 2000);
})();
