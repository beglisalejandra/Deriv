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
    lastSignal: null
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
      setConn(s, 'Desconectado.');
      $('accountBadge').textContent = 'sin conectar';
      $('accountBadge').className = 'badge';
      toggleConnected(false);
    }
  };

  function toggleConnected(on) {
    $('btnConnect').disabled = on;
    $('btnDisconnect').disabled = !on;
    $('btnAnalysis').disabled = !on;
    $('btnPredict').disabled = !on;
    $('btnScan').disabled = !on;
    $('btnRun').disabled = !on;
    $('apiToken').disabled = on;
    $('appId').disabled = on;
  }

  $('btnConnect').addEventListener('click', function () {
    var token = $('apiToken').value.trim();
    var appId = $('appId').value.trim() || '1089';
    if (!token) { setConn('', 'Falta el API token.'); return; }

    setConn('conectando', 'Conectando…');
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
    render();
    $('predCard').scrollIntoView({ behavior:'smooth', block:'nearest' });
  });
  $('strategy').addEventListener('change', function () { if (!$('predCard').hidden) render(); });
  $('windowTicks').addEventListener('change', render);

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
      minTicks: 30,
      cooldownMs: 800
    };
  }

  $('btnRun').addEventListener('click', function () {
    var cfg = readConfig();
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
      ? 'Corriendo en modo ' + (engine.cfg.mode === 'real' ? 'REAL' : 'simulacion') + '…'
      : (engine.stopReason || 'El bot no esta corriendo.');
    renderResults();
  };
  engine.onTrade = function (t) {
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

  try {
    var saved = localStorage.getItem('deriv_token');
    if (saved) { $('apiToken').value = saved; $('rememberToken').checked = true; }
    var savedApp = localStorage.getItem('deriv_appid');
    if (savedApp) $('appId').value = savedApp;
  } catch (e) {}

  log('Listo. Conecta con un token de cuenta demo para empezar.');
})();
