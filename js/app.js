/* =========================================================================
 * app.js — Interfaz: conexion, panel en vivo, escaner de pagos, bot,
 *          resultados y calculadoras de realidad.
 * ========================================================================= */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var api = new window.DerivAPI();
  var stats = new window.DigitStats(5000);
  var engine = new window.TradeEngine(api, stats);

  var state = {
    symbols: [],
    symbol: '1HZ75V',
    symbolName: 'Volatility 75 (1s) Index',
    pipSize: 2,
    currency: 'USD',
    tickSub: null,
    balanceSub: null,
    analyzing: false,
    lastSignal: null,
    lastGate: null,
    payoutCache: {},
    payoutAt: 0
  };

  var DIGIT_COLORS = ['#dc2626','#ea580c','#d97706','#65a30d','#16a34a',
                      '#0d9488','#0284c7','#4f46e5','#9333ea','#db2777'];

  var FALLBACK_SYMBOLS = [
    { symbol:'1HZ10V',  display_name:'Volatility 10 (1s) Index',  pip:0.001 },
    { symbol:'1HZ25V',  display_name:'Volatility 25 (1s) Index',  pip:0.01 },
    { symbol:'1HZ50V',  display_name:'Volatility 50 (1s) Index',  pip:0.01 },
    { symbol:'1HZ75V',  display_name:'Volatility 75 (1s) Index',  pip:0.01 },
    { symbol:'1HZ100V', display_name:'Volatility 100 (1s) Index', pip:0.01 },
    { symbol:'R_10',    display_name:'Volatility 10 Index',       pip:0.001 },
    { symbol:'R_25',    display_name:'Volatility 25 Index',       pip:0.001 },
    { symbol:'R_50',    display_name:'Volatility 50 Index',       pip:0.0001 },
    { symbol:'R_75',    display_name:'Volatility 75 Index',       pip:0.0001 },
    { symbol:'R_100',   display_name:'Volatility 100 Index',      pip:0.01 }
  ];

  function log(msg) {
    var el = $('log');
    var d = document.createElement('div');
    d.textContent = new Date().toLocaleTimeString('es') + '  ' + msg;
    el.appendChild(d);
    while (el.children.length > 300) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  function money(n) { return (n < 0 ? '-' : '') + Math.abs(n).toFixed(2); }
  function pct(n) { return (n * 100).toFixed(1) + '%'; }

  /* ------------------------------ Pestañas ------------------------------ */
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (!b) return;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    b.classList.add('active');
    $('view-' + b.dataset.tab).classList.add('active');
    window.scrollTo(0, 0);
  });

  /* ----------------------------- Conexion ------------------------------- */

  function setConn(status, text) {
    var dot = $('connDot');
    dot.className = 'dot' + (status === 'conectado' ? ' on' : status === 'conectando' ? ' wait' : '');
    $('connStatus').textContent = text;
  }

  api.onStatus = function (s) {
    if (s === 'desconectado') {
      setConn(s, 'Sin iniciar.');
      $('accountBadge').textContent = 'sin iniciar';
      $('accountBadge').className = 'badge';
      toggleConnected(false);
    }
  };

  function toggleConnected(on) {
    // En demostracion local hay que poder conectar la cuenta real encima, asi
    // que el token y su boton siguen disponibles. Solo se bloquean cuando ya
    // hay una cuenta de verdad conectada.
    var bloquear = on && !api.demo;
    $('btnConnect').disabled = bloquear;
    $('apiToken').disabled = bloquear;
    $('appId').disabled = bloquear;
    $('btnDisconnect').disabled = !on;
    $('btnAnalysis').disabled = !on;
    $('btnPredict').disabled = !on;
    $('btnScan').disabled = !on;
    $('btnRun').disabled = !on;
  }

  $('btnConnect').addEventListener('click', function () {
    var token = $('apiToken').value.trim();
    var appId = $('appId').value.trim() || '1089';
    if (!token) { setConn('', 'Falta el API token.'); return; }

    setConn('conectando', 'Conectando…');
    stopTicks();
    engine.stop('Conexion cambiada de cuenta.');
    api.connect(appId)
      .then(function () { return api.authorize(token); })
      .then(function (acc) {
        state.currency = acc.currency || 'USD';
        var demo = !!acc.is_virtual;
        var badge = $('accountBadge');
        badge.textContent = (demo ? 'DEMO' : 'REAL') + ' · ' + acc.loginid;
        badge.className = 'badge ' + (demo ? 'demo' : 'real');
        setConn('conectado', 'Conectado como ' + acc.loginid + ' · saldo ' +
                Number(acc.balance).toFixed(2) + ' ' + state.currency);
        toggleConnected(true);
        log('Autorizado: ' + acc.loginid + ' (' + (demo ? 'demo' : 'real') + ').');

        if ($('rememberToken').checked) {
          try { localStorage.setItem('deriv_token', token); localStorage.setItem('deriv_appid', appId); } catch (e) {}
        } else {
          try { localStorage.removeItem('deriv_token'); } catch (e) {}
        }

        api.balance(function (b) {
          setConn('conectado', 'Conectado como ' + acc.loginid + ' · saldo ' +
                  Number(b.balance).toFixed(2) + ' ' + b.currency);
        }).then(function (s) { state.balanceSub = s.reqId; }).catch(function () {});

        return loadSymbols();
      })
      .then(function () { startTicks(); })
      .catch(function (e) {
        setConn('', 'Error: ' + e.message);
        log('Fallo de conexion: ' + e.message);
        api.disconnect();
        toggleConnected(false);
      });
  });


  $('btnDemo').addEventListener('click', function () {
    setConn('conectando', 'Iniciando demostracion local…');
    api.connectDemo()
      .then(function () { return api.authorize('demo'); })
      .then(function (acc) {
        state.currency = 'USD';
        var badge = $('accountBadge');
        badge.textContent = 'DEMOSTRACION';
        badge.className = 'badge demo';
        setConn('conectado', 'Demostracion local: ticks generados en este navegador, sin red.');
        toggleConnected(true);
        $('mode').value = 'sim';
        $('mode').dispatchEvent(new Event('change'));
        log('Modo demostracion. Los datos son simulados; ninguna orden sale de este equipo.');
        return loadSymbols();
      })
      .then(function () { startTicks(); })
      .catch(function (e) { setConn('', 'Error: ' + e.message); });
  });

  $('btnDisconnect').addEventListener('click', function () {
    engine.stop('Conexion cerrada por el usuario.');
    stopTicks();
    api.disconnect();
    toggleConnected(false);
  });

  /* ------------------------------ Simbolos ------------------------------ */

  function loadSymbols() {
    return api.activeSymbols()
      .then(function (list) {
        var digitMarkets = list.filter(function (s) {
          return s.submarket === 'random_index' && s.exchange_is_open !== 0;
        });
        state.symbols = digitMarkets.length ? digitMarkets : FALLBACK_SYMBOLS;
      })
      .catch(function () { state.symbols = FALLBACK_SYMBOLS; })
      .then(function () {
        var sel = $('symbol');
        sel.innerHTML = '';
        state.symbols.forEach(function (s) {
          var o = document.createElement('option');
          o.value = s.symbol;
          o.textContent = s.display_name;
          o.dataset.pip = s.pip;
          sel.appendChild(o);
        });
        var preferred = state.symbols.some(function (s) { return s.symbol === '1HZ75V'; })
          ? '1HZ75V' : state.symbols[0].symbol;
        sel.value = preferred;
        applySymbol();
      });
  }

  function applySymbol() {
    var sel = $('symbol');
    var opt = sel.options[sel.selectedIndex];
    if (!opt) return;
    state.symbol = opt.value;
    state.symbolName = opt.textContent;
    var pip = Number(opt.dataset.pip);
    state.pipSize = pip > 0 ? Math.round(-Math.log10(pip)) : 2;
    $('subtitle').textContent = 'Analisis en vivo de ' + state.symbolName;
  }

  $('symbol').addEventListener('change', function () {
    applySymbol();
    stats.reset();
    render();
    if (state.analyzing) { stopTicks(); startTicks(); }
  });

  /* -------------------------------- Ticks ------------------------------- */

  function startTicks() {
    if (!api.isOpen()) return;
    stopTicks();
    stats.reset();
    api.ticksHistory(state.symbol, 1000,
      function onTick(t) {
        if (t.pip_size !== undefined) state.pipSize = t.pip_size;
        stats.push(t.quote, state.pipSize);
        render();
      },
      function onHistory(h) {
        for (var i = 0; i < h.prices.length; i++) stats.push(h.prices[i], state.pipSize);
        render();
        log('Historial cargado: ' + h.prices.length + ' ticks de ' + state.symbolName + '.');
      }
    ).then(function (s) {
      state.tickSub = s.reqId;
      state.analyzing = true;
      $('btnAnalysis').textContent = 'Detener analisis';
    }).catch(function (e) { log('No se pudo abrir el stream: ' + e.message); });
  }

  function stopTicks() {
    if (state.tickSub !== null) { api.forget(state.tickSub); state.tickSub = null; }
    state.analyzing = false;
    $('btnAnalysis').textContent = 'Iniciar analisis';
  }

  $('btnAnalysis').addEventListener('click', function () {
    if (state.analyzing) { stopTicks(); log('Analisis detenido.'); }
    else startTicks();
  });

  /* ------------------------------- Render ------------------------------- */

  function render() {
    var n = Number($('windowTicks').value);
    var rep = stats.report(n);
    if (!rep.total) return;

    $('lastPrice').textContent = Number(rep.lastPrice).toFixed(state.pipSize);

    var circle = $('lastDigit');
    circle.textContent = rep.last;
    circle.style.background = DIGIT_COLORS[rep.last];
    circle.classList.add('pulse');
    setTimeout(function () { circle.classList.remove('pulse'); }, 150);

    var bars = $('digitBars');
    if (bars.children.length !== 10) {
      bars.innerHTML = '';
      for (var i = 0; i < 10; i++) {
        var b = document.createElement('div');
        b.className = 'bar';
        b.innerHTML = '<u></u><i></i><em>' + i + '</em>';
        bars.appendChild(b);
      }
    }
    var maxPct = Math.max.apply(null, rep.pct) || 0.1;
    for (var d = 0; d < 10; d++) {
      var el = bars.children[d];
      el.className = 'bar' + (d === rep.hot ? ' hot' : d === rep.cold ? ' cold' : '');
      el.querySelector('u').textContent = (rep.pct[d] * 100).toFixed(1);
      el.querySelector('i').style.height = Math.max(2, (rep.pct[d] / maxPct) * 100) + '%';
    }

    $('stTotal').textContent = rep.total;
    $('stEvenOdd').textContent = pct(rep.evenPct) + ' / ' + pct(1 - rep.evenPct);
    $('stStreak').textContent = rep.streak + '× el ' + rep.last;
    $('stChi').textContent = rep.pValue === null ? '—'
      : rep.chi2.toFixed(1) + ' (' + rep.pValue.toFixed(3) + ')';

    var note = $('uniformNote');
    if (rep.pValue === null) {
      note.textContent = 'Se necesitan al menos 30 ticks para la prueba de uniformidad.';
    } else if (rep.isSkewed) {
      note.innerHTML = '<b>p = ' + rep.pValue.toFixed(3) + '</b> — esta muestra se desvia de lo uniforme ' +
        'mas de lo habitual. Con muchas ventanas seguidas esto aparece por azar 1 de cada 20 veces.';
    } else {
      note.innerHTML = '<b>p = ' + rep.pValue.toFixed(3) + '</b> — la distribucion es compatible con ' +
        'un generador uniforme. Las diferencias entre digitos son ruido de muestreo.';
    }

    if (!$('predCard').hidden) renderPrediction(rep);

    // La puerta y el escaneo de sesgo se refrescan cada 2 s: recalcularlos en
    // cada tick no aporta nada y cotizar el pago tiene limite de peticiones.
    var now = Date.now();
    if (now - (state.gateAt || 0) > 2000) {
      state.gateAt = now;
      renderBias();
      if (state.lastSignal) evaluateGate(state.lastSignal).then(renderGate);
    }
  }

  /* ----------------------------- Prediccion ----------------------------- */

  function fillStrategies() {
    var sel = $('strategy');
    sel.innerHTML = '';
    Object.keys(window.DigitStats.STRATEGIES).forEach(function (key) {
      var o = document.createElement('option');
      o.value = key;
      o.textContent = window.DigitStats.STRATEGIES[key].label;
      sel.appendChild(o);
    });
    sel.value = 'matches_hot';
  }

  function renderPrediction(rep) {
    var key = $('strategy').value;
    var strat = window.DigitStats.STRATEGIES[key];
    var sig = strat.run(rep);
    state.lastSignal = sig;

    var typeLabel = {
      DIGITMATCH:'MATCHES', DIGITDIFF:'DIFFERS', DIGITOVER:'OVER',
      DIGITUNDER:'UNDER', DIGITEVEN:'PAR', DIGITODD:'IMPAR'
    }[sig.contract_type];

    $('predType').textContent = typeLabel;
    $('predMarket').textContent = state.symbolName;
    $('predValue').textContent = sig.barrier === null || sig.barrier === undefined ? '—' : sig.barrier;
    $('predStrategy').textContent = typeLabel;

    var obs = $('predObserved');
    obs.textContent = pct(sig.observed);

    var row = $('predDigits');
    if (row.children.length !== 10) {
      row.innerHTML = '';
      for (var i = 0; i < 10; i++) {
        var s = document.createElement('span');
        s.textContent = i;
        row.appendChild(s);
      }
    }
    for (var d = 0; d < 10; d++) {
      row.children[d].className = (d === sig.barrier) ? 'on' : '';
    }

    $('predReason').textContent = sig.reason;

    var theo = window.DigitStats.theoreticalWinProb(sig.contract_type, sig.barrier);
    var ciTxt = '';
    if (sig.ci) {
      var dentro = sig.ci.low <= theo && theo <= sig.ci.high;
      ciTxt = ' El intervalo de confianza al 95% de esa frecuencia va de ' +
        pct(sig.ci.low) + ' a ' + pct(sig.ci.high) + ', ' +
        (dentro
          ? 'e incluye el ' + pct(theo) + ' teorico: la desviacion es ruido de muestreo.'
          : 'y queda ' + (sig.ci.low > theo ? 'por encima' : 'por debajo') + ' del ' + pct(theo) +
            ' teorico. Revisando ventanas sin parar esto aparece por azar a menudo; no es una senal.');
    }
    $('predHonest').textContent =
      'Frecuencia observada = lo que ya paso en la ventana. Probabilidad real del proximo tick = ' +
      pct(theo) + ', fija por el RNG.' + ciTxt;
  }

  $('btnPredict').addEventListener('click', function () {
    $('predCard').hidden = false;
    $('gateCard').hidden = false;
    state.gateAt = 0;
    render();
    $('predCard').scrollIntoView({ behavior:'smooth', block:'nearest' });
  });
  $('strategy').addEventListener('change', function () { if (!$('predCard').hidden) render(); });
  $('windowTicks').addEventListener('change', render);


  /* ------------------------ Puerta de decision -------------------------- */

  var calib = new window.Edge.Calibration('deriv_calibracion');

  /* Pago vigente para un contrato. Se cachea: cotizar en cada tick agotaria
     el limite de peticiones de la API. */
  function payoutFor(type, barrier) {
    var key = type + '|' + barrier;
    var now = Date.now();
    if (state.payoutCache[key] && now - state.payoutAt < 20000) {
      return Promise.resolve(state.payoutCache[key]);
    }
    if (!api.isOpen()) return Promise.resolve(null);
    return api.proposal({
      amount: Number($('baseStake').value) || 1,
      contract_type: type, currency: state.currency,
      duration: Number($('duration').value) || 1, duration_unit: 't',
      symbol: state.symbol, barrier: barrier
    }).then(function (pr) {
      var mult = pr.payout / pr.ask_price;
      state.payoutCache[key] = mult;
      state.payoutAt = now;
      return mult;
    }).catch(function () { return null; });
  }

  function evaluateGate(sig) {
    return payoutFor(sig.contract_type, sig.barrier).then(function (mult) {
      if (!mult) return null;
      var all = stats.digits;
      var gate = window.Edge.evaluateEntry({
        wins: window.Edge.countWins(all, sig.contract_type, sig.barrier),
        n: all.length,
        payoutMult: mult,
        theoreticalP: window.DigitStats.theoreticalWinProb(sig.contract_type, sig.barrier),
        threshold: Number($('gateThreshold').value),
        minSample: Number($('gateMinSample').value)
      });
      gate.payoutMult = mult;
      gate.contract_type = sig.contract_type;
      gate.barrier = sig.barrier;
      state.lastGate = gate;
      return gate;
    });
  }

  function renderGate(gate) {
    var card = $('gateCard');
    card.hidden = false;
    if (!gate) {
      card.className = 'card gate';
      $('verdictText').textContent = 'Sin cotizacion';
      $('verdictSub').textContent = 'No se pudo obtener el pago vigente de la API.';
      return;
    }
    card.className = 'card gate ' + (gate.ok ? 'go' : 'nogo');
    $('verdictText').textContent = gate.decision;
    $('verdictSub').textContent = gate.ok
      ? 'La ventaja medida cubre la comision del pago.'
      : 'Entrar aqui pierde dinero en promedio.';

    $('gateProb').textContent = pct(gate.probProfitable);
    var thr = Number($('gateThreshold').value);
    $('gateMeter').style.width = Math.min(100, gate.probProfitable * 100) + '%';
    $('gateThr').style.left = (thr * 100) + '%';
    $('gateMeterNote').textContent =
      'La marca negra es el ' + (thr * 100).toFixed(0) + '% exigido. La barra debe pasarla.';

    $('gateBreakeven').textContent = (gate.breakEven * 100).toFixed(2) + '%';
    $('gateMeasured').textContent = (gate.posterior.mean * 100).toFixed(2) + '%';
    $('gateSample').textContent = gate.posterior.n + ' ticks';
    var ev = $('gateEv');
    ev.textContent = (gate.evPosterior * 100).toFixed(2) + '%';
    ev.className = gate.evPosterior >= 0 ? 'pos' : 'neg';

    $('gateReasons').innerHTML = gate.reasons.map(function (r) {
      var good = /supera el punto de equilibrio/.test(r);
      return '<li class="' + (good ? 'good' : '') + '">' + r + '</li>';
    }).join('');
  }

  ['gateThreshold','gateMinSample'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      if (state.lastSignal) evaluateGate(state.lastSignal).then(renderGate);
    });
  });

  /* ------------------------- Deteccion de sesgo ------------------------- */

  function renderBias() {
    var r = stats.counts(0);
    var scan = window.Edge.biasScan(r.counts, r.total);
    var tb = $('biasTable').querySelector('tbody');
    if (!scan.ready || r.total < 50) {
      tb.innerHTML = '<tr><td colspan="6" class="empty">Acumulando ticks (' + r.total + ').</td></tr>';
      return;
    }
    tb.innerHTML = scan.digits.map(function (d) {
      return '<tr>' +
        '<td><b>' + d.digit + '</b></td>' +
        '<td>' + d.count + '</td>' +
        '<td>' + (d.freq * 100).toFixed(2) + '%</td>' +
        '<td>' + d.pRaw.toFixed(4) + '</td>' +
        '<td>' + d.pAdj.toFixed(4) + '</td>' +
        '<td><span class="flag ' + (d.significant ? 'sig' : '') + '">' +
          (d.significant ? 'sesgo' : 'normal') + '</span></td>' +
        '</tr>';
    }).join('');

    var v = $('biasVerdict');
    if (scan.anySignificant) {
      v.textContent = 'Se detecta desviacion significativa en ' + scan.significant.length +
        ' digito(s) tras corregir por las 10 comparaciones. Con ' + scan.total +
        ' ticks, la desviacion minima detectable es de +/-' + pct(scan.detectable) +
        '. Confirmalo con mas muestra antes de actuar.';
    } else {
      var minRaw = Math.min.apply(null, scan.digits.map(function (d) { return d.pRaw; }));
      v.textContent = 'Ningun digito se desvia de forma significativa. El p-valor crudo mas bajo es ' +
        minRaw.toFixed(4) + ', que tras corregir por las 10 comparaciones queda en ' +
        scan.minAdjusted.toFixed(4) + '. Con ' + scan.total + ' ticks se detectaria un sesgo de +/-' +
        pct(scan.detectable) + ' o mayor.';
    }
  }

  /* --------------------------- Calibracion ------------------------------ */

  function renderCalibration() {
    var rep = calib.report();
    var tb = $('calibTable').querySelector('tbody');
    if (!rep.rows.length) {
      tb.innerHTML = '<tr><td colspan="5" class="empty">Sin operaciones registradas todavia.</td></tr>';
      $('calibVerdict').textContent = 'Ejecuta el bot en simulacion para llenar esta tabla.';
      return;
    }
    tb.innerHTML = rep.rows.map(function (r) {
      var cls = Math.abs(r.error) < 0.05 ? 'pos' : 'neg';
      return '<tr>' +
        '<td>' + (r.band[0] * 100).toFixed(0) + '–' + Math.min(100, r.band[1] * 100).toFixed(0) + '%</td>' +
        '<td>' + r.n + '</td>' +
        '<td>' + pct(r.stated) + '</td>' +
        '<td>' + pct(r.realized) + '</td>' +
        '<td class="' + cls + '">' + (r.error >= 0 ? '+' : '') + (r.error * 100).toFixed(1) + ' pp</td>' +
        '</tr>';
    }).join('');
    $('calibVerdict').textContent = 'Error medio de calibracion: ' + (rep.mae * 100).toFixed(1) +
      ' puntos porcentuales sobre ' + rep.total + ' operaciones. Cuanto mas cerca de 0, mas honesta ' +
      'es la probabilidad anunciada.';
  }

  $('btnResetCalib').addEventListener('click', function () {
    calib.reset(); renderCalibration(); log('Historial de calibracion borrado.');
  });

  /* ------------------------- Sostenibilidad ----------------------------- */

  function renderSustain() {
    var bankroll = Number($('suBankroll').value) || 100;
    var stake = Number($('suStake').value) || 1;
    var rows = [
      ['Matches / Over 8 / Under 1', 0.10, 8.9286],
      ['Over 7 (gana 8 y 9)',        0.20, 4.4643],
      ['Par / Impar',                0.50, 1.9500],
      ['Differs / Over 0 / Under 9', 0.90, 1.0900]
    ];
    var out = rows.map(function (r) {
      var s = window.Edge.sustainability({
        winProb: r[1], payoutMult: r[2], stake: stake, bankroll: bankroll,
        maxTrades: 5000, runs: 1200
      });
      return { name: r[0], mult: r[2], s: s };
    });
    $('sustainTable').querySelector('tbody').innerHTML = out.map(function (o) {
      return '<tr>' +
        '<td>' + o.name + '</td>' +
        '<td>x' + o.mult.toFixed(2) + '</td>' +
        '<td class="neg">' + (o.s.ev * 100).toFixed(2) + '%</td>' +
        '<td>' + (isFinite(o.s.analyticLifetime) ? Math.round(o.s.analyticLifetime) + ' ops' : '—') + '</td>' +
        '<td>' + pct(o.s.ruinRate) + '</td>' +
        '</tr>';
    }).join('');

    var best = out[out.length - 1], worst = out[0];
    var ratio = worst.s.analyticLifetime ? best.s.analyticLifetime / worst.s.analyticLifetime : 1;
    $('sustainNote').textContent =
      'Con ' + bankroll.toFixed(0) + ' USD y stake de ' + stake.toFixed(0) + ' USD, el contrato de menor ' +
      'comision dura ' + ratio.toFixed(1) + ' veces mas que el de pago alto (' +
      Math.round(best.s.analyticLifetime) + ' frente a ' + Math.round(worst.s.analyticLifetime) +
      ' operaciones). Ninguno es rentable: elegir bien alarga la sesion, no la vuelve positiva. ' +
      'La ruina mostrada es a 5000 operaciones.';
  }

  ['suBankroll','suStake'].forEach(function (id) {
    $(id).addEventListener('input', renderSustain);
  });

  /* -------------------------- Escaner de pagos -------------------------- */

  function scanCombos() {
    var combos = [
      { t:'DIGITMATCH', b:0 }, { t:'DIGITDIFF', b:0 },
      { t:'DIGITEVEN', b:null }, { t:'DIGITODD', b:null }
    ];
    for (var i = 0; i <= 8; i++) combos.push({ t:'DIGITOVER', b:i });
    for (var j = 1; j <= 9; j++) combos.push({ t:'DIGITUNDER', b:j });
    return combos;
  }

  $('btnScan').addEventListener('click', function () {
    var stake = Number($('scanStake').value);
    var target = Number($('scanTarget').value);
    var combos = scanCombos();
    var rows = [];
    var bar = $('scanProgress');
    bar.hidden = false;
    bar.firstElementChild.style.width = '0%';
    $('btnScan').disabled = true;

    var i = 0;
    function next() {
      if (i >= combos.length) {
        bar.hidden = true;
        $('btnScan').disabled = false;
        renderScan(rows, target);
        return;
      }
      var c = combos[i];
      api.proposal({
        amount: stake, contract_type: c.t, currency: state.currency,
        duration: Number($('duration').value) || 1, duration_unit: 't',
        symbol: state.symbol, barrier: c.b
      }).then(function (p) {
        var mult = p.payout / p.ask_price;
        var prob = window.DigitStats.theoreticalWinProb(c.t, c.b);
        rows.push({
          type: c.t, barrier: c.b, mult: mult, prob: prob,
          ev: window.Risk.expectedValue(prob, mult), payout: p.payout
        });
      }).catch(function (e) {
        // Combinaciones no disponibles para el simbolo: se omiten sin ruido.
      }).then(function () {
        i++;
        bar.firstElementChild.style.width = (i / combos.length * 100) + '%';
        setTimeout(next, 120);
      });
    }
    next();
  });

  function renderScan(rows, target) {
    var tb = $('scanTable').querySelector('tbody');
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="5" class="empty">No se obtuvieron cotizaciones. ' +
                     'Revisa que el mercado este abierto.</td></tr>';
      return;
    }
    rows.sort(function (a, b) { return b.mult - a.mult; });
    var names = { DIGITMATCH:'Matches', DIGITDIFF:'Differs', DIGITOVER:'Over',
                  DIGITUNDER:'Under', DIGITEVEN:'Par', DIGITODD:'Impar' };
    tb.innerHTML = rows.map(function (r) {
      var hit = target > 0 && r.mult >= target;
      return '<tr class="' + (hit ? 'good' : '') + '">' +
        '<td>' + names[r.type] + '</td>' +
        '<td>' + (r.barrier === null ? '—' : r.barrier) + '</td>' +
        '<td><b>x' + r.mult.toFixed(2) + '</b></td>' +
        '<td>' + pct(r.prob) + '</td>' +
        '<td class="' + (r.ev >= 0 ? 'pos' : 'neg') + '">' + (r.ev * 100).toFixed(2) + '%</td>' +
        '</tr>';
    }).join('');

    var best = rows.filter(function (r) { return target === 0 || r.mult >= target; });
    log('Escaner: ' + rows.length + ' combinaciones cotizadas, ' + best.length +
        ' con pago x' + target + ' o mas.');
  }

  /* --------------------------------- Bot -------------------------------- */

  $('money').addEventListener('change', function () {
    $('mgRow').hidden = this.value === 'flat';
  });

  $('mode').addEventListener('change', function () {
    $('realConfirmWrap').hidden = this.value !== 'real';
    if (this.value !== 'real') $('realConfirm').checked = false;
  });

  function readConfig() {
    return {
      mode: $('mode').value,
      symbol: state.symbol,
      currency: state.currency,
      pipSize: state.pipSize,
      strategy: $('strategy').value,
      windowTicks: Number($('windowTicks').value),
      baseStake: Number($('baseStake').value),
      duration: Number($('duration').value),
      money: $('money').value,
      factor: Number($('factor').value) || 2,
      maxSteps: Number($('maxSteps').value) || 5,
      takeProfit: Number($('takeProfit').value) || 0,
      stopLoss: Number($('stopLoss').value) || 0,
      maxStake: Number($('maxStake').value) || 20,
      maxTrades: Number($('maxTrades').value) || 0,
      maxLossStreak: Number($('maxLossStreak').value) || 0,
      minPayoutMult: Number($('minPayoutMult').value) || 0,
      requireGate: $('requireGate').checked,
      gateThreshold: Number($('gateThreshold').value),
      gateMinSample: Number($('gateMinSample').value),
      minTicks: 30,
      cooldownMs: 800
    };
  }

  $('btnRun').addEventListener('click', function () {
    var cfg = readConfig();
    if (cfg.mode === 'real' && api.demo) {
      $('botStatus').textContent = 'El modo demostracion no envia ordenes reales. ' +
        'Conecta con un token para operar, o usa el modo Simulacion.';
      log('Modo real bloqueado: estas en demostracion local.');
      return;
    }
    if (cfg.mode === 'real' && !$('realConfirm').checked) {
      $('botStatus').textContent = 'Marca la casilla de confirmacion antes de operar en real.';
      return;
    }
    if (!state.analyzing) startTicks();
    engine.start(cfg);
  });

  $('btnStop').addEventListener('click', function () { engine.stop('Detenido manualmente.'); });

  engine.onLog = log;
  engine.onState = function () {
    $('btnRun').disabled = engine.running || !api.isOpen();
    $('btnStop').disabled = !engine.running;
    $('botStatus').textContent = engine.running
      ? 'Corriendo en modo ' + (engine.cfg.mode === 'real' ? 'REAL' : 'simulacion') + '…' +
        (engine.gateBlocks ? ' Puerta cerrada ' + engine.gateBlocks + ' vez(ces); sin operar.' : '')
      : (engine.stopReason || 'El bot no esta corriendo.');
    renderResults();
    renderDiag();
  };
  engine.onGate = renderGate;
  engine.onTrade = function (t) {
    if (t.statedProb !== null && t.statedProb !== undefined) {
      calib.record(t.statedProb, t.won);
      renderCalibration();
    }
    log((t.won ? 'GANADA ' : 'perdida ') + t.contract_type +
        (t.barrier === null || t.barrier === undefined ? '' : '[' + t.barrier + ']') +
        ' digito=' + t.resultDigit + ' P/L=' + money(t.profit));
    appendTradeRow(t);
  };

  /* ----------------------------- Resultados ----------------------------- */

  function appendTradeRow(t) {
    var tb = $('tradesTable').querySelector('tbody');
    if (tb.querySelector('.empty')) tb.innerHTML = '';
    var tr = document.createElement('tr');
    tr.className = t.won ? 'win' : 'lose';
    var names = { DIGITMATCH:'Match', DIGITDIFF:'Diff', DIGITOVER:'Over',
                  DIGITUNDER:'Under', DIGITEVEN:'Par', DIGITODD:'Impar' };
    tr.innerHTML =
      '<td>' + t.index + '</td>' +
      '<td>' + names[t.contract_type] +
        (t.barrier === null || t.barrier === undefined ? '' : ' ' + t.barrier) + '</td>' +
      '<td>' + t.stake.toFixed(2) + '</td>' +
      '<td>' + (t.resultDigit === null ? '—' : t.resultDigit) + '</td>' +
      '<td>' + (t.won ? 'ganada' : 'perdida') + '</td>' +
      '<td class="' + (t.profit >= 0 ? 'pos' : 'neg') + '">' + money(t.profit) + '</td>';
    tb.insertBefore(tr, tb.firstChild);
    while (tb.children.length > 200) tb.removeChild(tb.lastChild);
  }

  function renderResults() {
    var s = engine.summary();
    $('rsTrades').textContent = s.trades;
    $('rsWinRate').textContent = s.trades ? pct(s.winRate) + ' (' + s.wins + '/' + s.trades + ')' : '—';
    $('rsStake').textContent = s.totalStake.toFixed(2);
    $('rsPayout').textContent = s.totalPayout.toFixed(2);
    var pnl = $('rsPnl');
    pnl.textContent = money(s.pnl);
    pnl.className = 'pnl ' + (s.pnl > 0 ? 'up' : s.pnl < 0 ? 'down' : '');
    $('rsRoi').textContent = s.trades ? (s.roi * 100).toFixed(1) + '%' : '—';
    $('rsStreak').textContent = s.lossStreak;
    $('rsDD').textContent = s.maxDrawdown.toFixed(2);
  }

  $('btnCsv').addEventListener('click', function () {
    if (!engine.trades.length) return;
    var blob = new Blob([engine.toCSV()], { type:'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'deriv-operaciones-' + Date.now() + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('btnResetStats').addEventListener('click', function () {
    engine.reset();
    $('tradesTable').querySelector('tbody').innerHTML =
      '<tr><td colspan="6" class="empty">Todavia no hay operaciones.</td></tr>';
    renderResults();
    log('Contadores reiniciados.');
  });




  /* --------------------- Memoria de la configuracion -------------------- */
  /* La configuracion vive en el navegador, no en la cuenta de Deriv: cambiar
     entre demo y real no la altera, y ahora tampoco la altera recargar.
     El Modo se excluye a proposito: cada sesion empieza en Simulacion, para
     que pasar a Real sea siempre un acto deliberado. */

  var CAMPOS_GUARDADOS = [
    'symbol','strategy','windowTicks','baseStake','duration','money','factor','maxSteps',
    'takeProfit','stopLoss','maxStake','maxTrades','maxLossStreak','minPayoutMult',
    'requireGate','gateThreshold','gateMinSample','scanStake','scanTarget',
    'suBankroll','suStake'
  ];

  function guardarConfig() {
    var out = {};
    CAMPOS_GUARDADOS.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      out[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    try { localStorage.setItem('deriv_config', JSON.stringify(out)); } catch (e) {}
  }

  function cargarConfig() {
    var raw;
    try { raw = localStorage.getItem('deriv_config'); } catch (e) { return false; }
    if (!raw) return false;
    var cfg;
    try { cfg = JSON.parse(raw); } catch (e) { return false; }
    Object.keys(cfg).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!cfg[id];
      else el.value = cfg[id];
    });
    // Repintar lo que depende de esos valores.
    $('money').dispatchEvent(new Event('change'));
    return true;
  }

  function olvidarConfig() {
    try { localStorage.removeItem('deriv_config'); } catch (e) {}
  }

  CAMPOS_GUARDADOS.forEach(function (id) {
    var el = $(id);
    if (el) { el.addEventListener('change', guardarConfig); el.addEventListener('input', guardarConfig); }
  });

  $('btnResetCfg').addEventListener('click', function () {
    olvidarConfig();
    location.reload();
  });

  /* --------------------- Diagnostico: por que no opera ------------------ */

  /* Revisa, en tiempo real, todo lo que puede impedir que el bot opere y lo
     dice antes de pulsar Ejecutar, no despues. */
  function renderDiag() {
    var el = $('diag'), list = $('diagList'), title = $('diagTitle');
    if (!el) return;
    var bloqueos = [], avisos = [];

    if (!api.isOpen()) {
      bloqueos.push('No estas conectado. Pulsa <b>Conectar</b> o <b>Explorar sin cuenta</b> en el Panel.');
    } else {
      if (!state.analyzing) {
        bloqueos.push('El analisis esta parado. Pulsa <b>Iniciar analisis</b> en el Panel.');
      }
      var n = stats.digits.length;
      if (n < 30) {
        bloqueos.push('Solo hay ' + n + ' ticks. Hacen falta 30 para empezar; espera unos segundos.');
      }
    }

    if ($('mode').value === 'real' && api.demo) {
      bloqueos.push('Estas en demostracion local: el modo <b>Real</b> no envia ordenes. ' +
                    'Cambia a <b>Simulacion</b> o conecta con un token.');
    }
    if ($('mode').value === 'real' && !$('realConfirm').checked && !api.demo) {
      bloqueos.push('Falta marcar la casilla de confirmacion del modo Real.');
    }

    // El filtro de pago puede ser imposible de cumplir para la estrategia elegida.
    var stratKey = $('strategy').value;
    var minPay = Number($('minPayoutMult').value) || 0;
    if (minPay > 0 && stats.digits.length) {
      var sig = window.DigitStats.STRATEGIES[stratKey].run(stats.report(Number($('windowTicks').value)));
      var justo = 1 / window.DigitStats.theoreticalWinProb(sig.contract_type, sig.barrier);
      if (minPay > justo) {
        bloqueos.push('El <b>pago minimo x' + minPay + '</b> es imposible con esta estrategia: ' +
                      'su pago justo es x' + justo.toFixed(2) + ', asi que nunca lo alcanzara. ' +
                      'Pon <b>sin filtro</b> o cambia de estrategia.');
      }
    }

    if ($('requireGate').checked) {
      bloqueos.push('La <b>puerta</b> esta activada: solo operara si una entrada supera su punto ' +
                    'de equilibrio con ' + (Number($('gateThreshold').value) * 100).toFixed(0) +
                    '% de certeza. En los indices sinteticos eso casi nunca ocurre. ' +
                    'Desmarcala si quieres que opere.');
    }

    var maxT = Number($('maxTrades').value) || 0;
    if (maxT > 0 && engine.trades.length >= maxT) {
      bloqueos.push('Ya se alcanzo el maximo de ' + maxT + ' operaciones. ' +
                    'Sube el numero o pulsa <b>Reiniciar contadores</b> en Resultados.');
    }

    var streak = Number($('maxLossStreak').value) || 0;
    if (streak > 0 && streak <= 8 && /matches|over_8|under_1/.test(stratKey)) {
      avisos.push('Con <b>' + streak + ' perdidas seguidas maximas</b> y una estrategia de ' +
                  'acierto 10%, el bot se detendra solo tras unas ' +
                  Math.round((1 - Math.pow(0.9, streak)) / (0.1 * Math.pow(0.9, streak))) +
                  ' operaciones. Pon <b>0</b> para desactivar ese limite.');
    }
    if ($('money').value === 'martingale') {
      var f = Number($('factor').value) || 2, pasos = Number($('maxSteps').value) || 5;
      var cap = 1 * (Math.pow(f, pasos) - 1) / (f - 1);
      avisos.push('Martingala x' + f + ' con ' + pasos + ' pasos: necesitas ' +
                  (cap * (Number($('baseStake').value) || 1)).toFixed(2) + ' USD para cubrir la escalera.');
    }

    if (bloqueos.length) {
      el.className = 'diag';
      title.textContent = bloqueos.length === 1
        ? 'Una cosa impide que opere:' : 'Hay ' + bloqueos.length + ' cosas que impiden que opere:';
    } else {
      el.className = 'diag ok';
      title.textContent = engine.running ? 'Operando.' : 'Listo para operar. Pulsa Ejecutar.';
    }
    list.innerHTML = bloqueos.map(function (b) { return '<li class="block">' + b + '</li>'; })
      .concat(avisos.map(function (a) { return '<li>' + a + '</li>'; })).join('');
  }

  // Cualquier cambio en los controles vuelve a evaluar el diagnostico.
  ['mode','strategy','windowTicks','baseStake','duration','money','factor','maxSteps',
   'takeProfit','stopLoss','maxStake','maxTrades','maxLossStreak','minPayoutMult',
   'requireGate','realConfirm','gateThreshold'].forEach(function (id) {
    var el = $(id);
    if (el) { el.addEventListener('change', renderDiag); el.addEventListener('input', renderDiag); }
  });
  setInterval(renderDiag, 1500);

  /* ------------------------ Configuraciones listas ---------------------- */

  function applyPreset(cfg) {
    Object.keys(cfg).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = cfg[id];
      else el.value = String(cfg[id]);
      el.dispatchEvent(new Event('change'));
    });
    render();
    guardarConfig();
    renderDiag();
    $('predCard').hidden = false;
    $('gateCard').hidden = false;
    state.gateAt = 0;
  }

  $('presetSafe').addEventListener('click', function () {
    applyPreset({
      strategy: 'differs_cold',
      windowTicks: 100,
      mode: 'sim',
      baseStake: 1,
      duration: 1,
      money: 'flat',
      takeProfit: 10,
      stopLoss: 10,
      maxStake: 5,
      maxTrades: 200,
      maxLossStreak: 0,
      minPayoutMult: 0,      // Differs paga x1.09: cualquier filtro lo bloquearia
      requireGate: true,
      gateThreshold: 0.95,
      gateMinSample: 500
    });
    log('Configuracion sostenible aplicada: Differs, stake fijo 1 USD, sin filtro de pago.');
    log('Aviso: con la puerta activada no operara, porque Differs tampoco cubre su ' +
        'punto de equilibrio. Desmarcala para medir en simulacion.');
    $('botStatus').textContent = 'Listo. Con la puerta activada no operara: lee el aviso de la Guia.';
    window.scrollTo(0, 0);
  });


  $('presetRun').addEventListener('click', function () {
    applyPreset({
      strategy: 'matches_hot',
      windowTicks: 100,
      mode: 'sim',
      baseStake: 1,
      duration: 1,
      money: 'flat',
      takeProfit: 10,
      stopLoss: 10,
      maxStake: 20,
      maxTrades: 50,
      maxLossStreak: 0,
      minPayoutMult: 7,
      requireGate: false,
      gateThreshold: 0.95,
      gateMinSample: 500
    });
    log('Configuracion operativa aplicada. El bot operara al pulsar Ejecutar.');
    $('botStatus').textContent = 'Listo. Ve a la pestana Bot y pulsa Ejecutar.';
    renderDiag();
    window.scrollTo(0, 0);
  });

  $('presetVideo').addEventListener('click', function () {
    applyPreset({
      strategy: 'matches_hot',
      windowTicks: 100,
      mode: 'sim',
      baseStake: 1,
      duration: 1,
      money: 'martingale',
      factor: 2.2,
      maxSteps: 5,
      takeProfit: 10,
      stopLoss: 10,
      maxStake: 20,
      maxTrades: 200,
      maxLossStreak: 0,
      minPayoutMult: 7,
      requireGate: false,    // el bot del video no comprueba nada antes de entrar
      gateThreshold: 0.95,
      gateMinSample: 500
    });
    log('Configuracion del video aplicada: Matches, martingala x2.2, puerta DESACTIVADA.');
    $('botStatus').textContent = 'Listo. Esta si operara, porque no comprueba nada antes de entrar.';
    window.scrollTo(0, 0);
  });

  /* ------------------------------ Realidad ------------------------------ */

  function renderEV() {
    var type = $('evType').value;
    var barrier = Number($('evBarrier').value);
    var mult = Number($('evPayout').value);
    var stake = Number($('evStake').value);
    var prob = window.DigitStats.theoreticalWinProb(type, barrier);
    var ev = window.Risk.expectedValue(prob, mult);
    var fair = 1 / prob;

    $('evOut').innerHTML =
      linea('Probabilidad de ganar', pct(prob)) +
      linea('Pago justo (sin comision)', 'x' + fair.toFixed(2)) +
      linea('Pago que ofrece Deriv', 'x' + mult.toFixed(2)) +
      linea('Ventaja de la casa', pct(1 - mult / fair)) +
      linea('Valor esperado por operacion', (ev * 100).toFixed(2) + '%',
            ev >= 0 ? 'pos' : 'neg') +
      linea('Resultado esperado con ' + stake.toFixed(2) + ' USD',
            money(ev * stake) + ' USD por operacion', ev >= 0 ? 'pos' : 'neg') +
      linea('Tras 100 operaciones', money(ev * stake * 100) + ' USD', ev >= 0 ? 'pos' : 'neg');
  }

  function linea(k, v, cls) {
    return '<div class="line"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';
  }

  function renderRisk() {
    var base = Number($('rkBase').value) || 1;
    var factor = Number($('rkFactor').value) || 2;
    var lossProb = Number($('rkLoss').value) || 0.9;
    var trials = Number($('rkTrials').value) || 100;

    var rows = window.Risk.ladder(base, factor, 12);
    $('ladderTable').querySelector('tbody').innerHTML = rows.map(function (r) {
      var p = Math.pow(lossProb, r.step);
      return '<tr><td>' + r.step + '</td><td>' + r.stake.toFixed(2) + '</td>' +
             '<td>' + r.cumulative.toFixed(2) + '</td><td>' + pct(p) + '</td></tr>';
    }).join('');

    var steps = Number($('maxSteps').value) || 5;
    var pRun = window.Risk.probOfLosingRun(lossProb, steps, trials);
    var capital = base * (Math.pow(factor, steps) - 1) / (factor - 1);
    $('rkOut').innerHTML =
      'Con factor ' + factor + ' y ' + steps + ' pasos necesitas <b>' + capital.toFixed(2) +
      ' USD</b> de capital para cubrir la escalera completa. La probabilidad de encadenar ' +
      steps + ' perdidas al menos una vez en ' + trials + ' operaciones es <b>' + pct(pRun) +
      '</b>. Cuando eso pasa, pierdes de golpe lo que ganaste en muchas operaciones previas.';
  }

  ['evType','evBarrier','evPayout','evStake'].forEach(function (id) {
    $(id).addEventListener('input', renderEV);
    $(id).addEventListener('change', renderEV);
  });
  ['rkBase','rkFactor','rkLoss','rkTrials','maxSteps'].forEach(function (id) {
    $(id).addEventListener('input', renderRisk);
    $(id).addEventListener('change', renderRisk);
  });

  /* -------------------------------- Init -------------------------------- */

  fillStrategies();
  FALLBACK_SYMBOLS.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s.symbol; o.textContent = s.display_name; o.dataset.pip = s.pip;
    $('symbol').appendChild(o);
  });
  $('symbol').value = '1HZ75V';
  applySymbol();
  renderEV();
  renderRisk();
  renderResults();
  if (cargarConfig()) { applySymbol(); log('Configuracion anterior restaurada.'); }
  $('mode').value = 'sim';
  $('mode').dispatchEvent(new Event('change'));
  renderCalibration();
  renderSustain();
  renderDiag();

  try {
    var saved = localStorage.getItem('deriv_token');
    if (saved) { $('apiToken').value = saved; $('rememberToken').checked = true; }
    var savedApp = localStorage.getItem('deriv_appid');
    if (savedApp) $('appId').value = savedApp;
  } catch (e) {}

  log('Listo. Conecta con un token de cuenta demo para empezar.');
})();
