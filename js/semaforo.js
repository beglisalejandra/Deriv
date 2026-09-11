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
  var estado = { corriendo:false, sub:null, pipSize:2, pagoReal:null,
               ultimoAnalisis:null, mejorIndice:null, escanTimer:null };

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


  /* ------------------ Escaner de pagos entre indices --------------------
     La probabilidad de acertar no se puede mover. El pago si: varia segun
     el indice. Entrar donde mejor pagan es el unico filtro de entrada que
     cambia el resultado de verdad. -------------------------------------- */

  var INDICES = ['1HZ10V','1HZ25V','1HZ50V','1HZ75V','1HZ100V','R_10','R_25','R_50','R_75','R_100'];
  var NOMBRES = {'1HZ10V':'Vol 10 (1s)','1HZ25V':'Vol 25 (1s)','1HZ50V':'Vol 50 (1s)',
                 '1HZ75V':'Vol 75 (1s)','1HZ100V':'Vol 100 (1s)','R_10':'Vol 10',
                 'R_25':'Vol 25','R_50':'Vol 50','R_75':'Vol 75','R_100':'Vol 100'};

  function escanearPagos() {
    if (!estado.corriendo) return Promise.resolve(null);
    var c = cfg();
    var lleva = window.Ronda.CONTRATOS[c.tipo].barrera;
    var out = [];
    var i = 0;

    function siguiente() {
      if (i >= INDICES.length) return Promise.resolve(out);
      var sym = INDICES[i++];
      return api.proposal({
        amount: c.stake, contract_type: c.tipo, currency: 'USD',
        duration: 1, duration_unit: 't', symbol: sym,
        barrier: lleva ? c.barrera : undefined
      }).then(function (p) {
        var mult = p.payout / p.ask_price;
        out.push({ sym: sym, nombre: NOMBRES[sym], pago: mult,
                   ve: window.Ronda.probDe(c.tipo, c.barrera) * mult - 1 });
      }).catch(function () {})
        .then(function () {
          return new Promise(function (r) { setTimeout(r, 110); }).then(siguiente);
        });
    }
    return siguiente();
  }

  function pintarEscaner(lista) {
    var cont = $('escaner');
    if (!cont) return;
    if (!lista || !lista.length) {
      cont.innerHTML = '<p class="note">Sin cotizaciones. Deriv no cotiza pagos sin cuenta, ' +
        'asi que se usan los valores tipicos del contrato.</p>';
      estado.mejorIndice = null;
      return;
    }
    lista.sort(function (a, b) { return b.pago - a.pago; });
    estado.mejorIndice = lista[0];

    var actual = cfg().simbolo;
    cont.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
      '<th>Indice</th><th>Pago</th><th>Valor esperado</th></tr></thead><tbody>' +
      lista.map(function (x, n) {
        return '<tr class="' + (x.sym === actual ? 'actual' : n === 0 ? 'good' : '') + '">' +
          '<td>' + x.nombre + (n === 0 ? ' ★' : '') + '</td>' +
          '<td><b>x' + x.pago.toFixed(2) + '</b></td>' +
          '<td class="' + (x.ve >= 0 ? 'pos' : 'neg') + '">' + (x.ve * 100).toFixed(1) + '%</td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>';

    if (lista[0].sym !== actual) {
      var mio = lista.filter(function (x) { return x.sym === actual; })[0];
      $('notaEscaner').innerHTML = 'Ahora mismo <b>' + lista[0].nombre + '</b> paga <b>x' +
        lista[0].pago.toFixed(2) + '</b>' +
        (mio ? ', frente a x' + mio.pago.toFixed(2) + ' del que tienes puesto' : '') +
        '. Cambia el indice aqui y en el desplegable <b>Market</b> del bot.';
    } else {
      $('notaEscaner').innerHTML = 'Estas en el indice que mejor paga ahora mismo: <b>x' +
        lista[0].pago.toFixed(2) + '</b>.';
    }
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
    var c = cfg();
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

    var mejor = estado.mejorIndice;
    var enMejor = !mejor || mejor.sym === c.simbolo;
    var pagoBajo = mejor && !enMejor && (mejor.pago - a.pago) > 0.15;

    var luz, texto, sub;
    if (pagoBajo) {
      luz = 'ambar';
      texto = 'CAMBIA DE INDICE';
      sub = mejor.nombre + ' paga x' + mejor.pago.toFixed(2) + ' frente a x' +
            a.pago.toFixed(2) + ' aqui. Es la unica mejora real disponible.';
      t.className = 'card luz ' + luz;
      $('luzTexto').textContent = texto;
      $('luzSub').textContent = sub;
      return;
    }
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
        escanearPagos().then(pintarEscaner);
        estado.escanTimer = setInterval(function () {
          escanearPagos().then(pintarEscaner);
        }, 45000);
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
    if (estado.escanTimer) { clearInterval(estado.escanTimer); estado.escanTimer = null; }
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
