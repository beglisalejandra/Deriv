/* =========================================================================
 * semaforo.js — Planificador de rondas
 *
 * Principio de diseno: lo util funciona SIN conexion. La matematica de la
 * ronda solo necesita los parametros del bot. La conexion al mercado es un
 * extra que, si falla, no deja la pagina inservible.
 * ========================================================================= */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var api = new window.DerivAPI();
  var stats = new window.DigitStats(5000);
  var APP_ID = '1089';

  /* Lista de reserva: si la API no responde o filtra mal, el desplegable
     nunca se queda vacio, que es lo que rompio la version anterior. */
  var RESERVA = [
    { symbol:'R_10',  display_name:'Volatility 10 Index',  pip:0.001 },
    { symbol:'R_25',  display_name:'Volatility 25 Index',  pip:0.001 },
    { symbol:'R_50',  display_name:'Volatility 50 Index',  pip:0.0001 },
    { symbol:'R_75',  display_name:'Volatility 75 Index',  pip:0.0001 },
    { symbol:'R_100', display_name:'Volatility 100 Index', pip:0.01 }
  ];

  var estado = { corriendo:false, sub:null, pipSize:2, escanTimer:null,
                 cuentaTimer:null, cuentaFin:null, enVerde:false, analisis:null };

  var COLORES = ['#dc2626','#ea580c','#d97706','#65a30d','#16a34a',
                 '#0d9488','#0284c7','#4f46e5','#9333ea','#db2777'];

  function pct(x,d){ return (x*100).toFixed(d===undefined?1:d)+'%'; }
  function usd(x){ return (x<0?'-':'+')+Math.abs(x).toFixed(2); }

  /* --------------------------- Configuracion ---------------------------- */

  function cfg() {
    return {
      simbolo: $('simbolo').value,
      tipo: $('tipo').value,
      barrera: Number($('barrera').value),
      stake: Number($('stake').value) || 1,
      pago: Number($('pago').value) || null,
      tp: Number($('tp').value) || 1,
      sl: Number($('sl').value) || 1
    };
  }
  function guardar(){
    var o={}; ['simbolo','tipo','barrera','stake','pago','tp','sl']
      .forEach(function(id){ o[id]=$(id).value; });
    try{ localStorage.setItem('plan_cfg', JSON.stringify(o)); }catch(e){}
  }
  function cargar(){
    try{ var o=JSON.parse(localStorage.getItem('plan_cfg')||'{}');
      Object.keys(o).forEach(function(id){ if($(id)) $(id).value=o[id]; });
    }catch(e){}
  }

  /* Al cambiar de contrato, el pago tipico se actualiza solo. */
  function pagoSugerido(){
    var c = cfg();
    var p = window.Ronda.pagoDe(c.tipo, c.barrera);
    if (p) $('pago').value = p.toFixed(2);
  }

  /* --------------------------- El veredicto ----------------------------- */

  function calcular() {
    var c = cfg();
    $('labBarrera').style.display = window.Ronda.CONTRATOS[c.tipo].barrera ? '' : 'none';

    var a = window.Ronda.analizar(c);
    estado.analisis = a;
    if (!a) return;

    $('exitoRonda').textContent = pct(a.probExito);
    var m = $('medioRonda');
    m.textContent = usd(a.veRonda);
    m.className = 'grande ' + (a.veRonda >= 0 ? 'pos' : 'neg');

    var t = $('tarjetaLuz'), luz, texto, sub;
    if (a.probExito >= 0.55) {
      luz='verde'; texto='CONFIGURACION BUENA';
      sub = 'Mas de la mitad de las rondas asi cierran en positivo. Puedes darle a Run.';
      estado.enVerde = true;
    } else if (a.probExito >= 0.40) {
      luz='ambar'; texto='CONFIGURACION JUSTA';
      sub = 'Cierra en verde ' + pct(a.probExito) + ' de las veces. Mira abajo si hay un ' +
            'objetivo mejor con el mismo riesgo.';
      estado.enVerde = false;
    } else {
      luz='rojo'; texto='CAMBIA EL OBJETIVO';
      sub = 'Solo ' + pct(a.probExito) + ' de las rondas asi cierran en positivo. ' +
            'Abajo tienes el objetivo que lo arregla.';
      estado.enVerde = false;
    }
    t.className = 'card luz ' + luz;
    $('luzTexto').textContent = texto;
    $('luzSub').textContent = sub;

    if (estado.enVerde && estado.corriendo) arrancarCuenta(); else pararCuenta();
    recomendar(a);
  }

  /* ------------------------- La mejor ronda ----------------------------- */

  function recomendar(a) {
    var c = cfg();
    var r = window.Ronda.recomendar(c);
    if (!r) return;

    /* Un solo "mejor" enganaba: la maxima probabilidad siempre sale con el
       objetivo mas pequeno, y arriesgar 15 para ganar 1 no es un consejo.
       Se muestran tres opciones con su compensacion a la vista. */
    function cercano(tp) {
      var mejor = null, dif = 1e9;
      r.todas.forEach(function (o) {
        var d = Math.abs(o.tp - tp);
        if (d < dif) { dif = d; mejor = o; }
      });
      return mejor;
    }

    var opciones = [
      { et:'Conservadora',  o: cercano(c.sl * 0.15), nota:'Cierra en verde mas a menudo' },
      { et:'Equilibrada',   o: cercano(c.sl * 0.5),  nota:'Reparto razonable' },
      { et:'Ambiciosa',     o: cercano(c.sl * 1.5),  nota:'Paga mas, acierta menos' }
    ].filter(function (x, i, arr) {
      return x.o && arr.findIndex(function (y) { return y.o && y.o.tp === x.o.tp; }) === i;
    });

    var actualTp = c.tp;
    $('mejorRonda').innerHTML =
      '<p class="note" style="margin-bottom:.7rem">Arriesgando <b>' + c.sl.toFixed(0) +
      ' USD</b>, estas son tus tres opciones. Cuanto mas alto el objetivo, menos ' +
      'probable es alcanzarlo.</p>' +
      '<div class="opciones">' + opciones.map(function (x) {
        var act = Math.abs(x.o.tp - actualTp) < 0.01;
        return '<button class="opcion' + (act ? ' actual' : '') + '" data-tp="' + x.o.tp + '">' +
          '<span class="et">' + x.et + (act ? ' · la tuya' : '') + '</span>' +
          '<b>+' + x.o.tp.toFixed(2) + ' USD</b>' +
          '<span class="prob">' + pct(x.o.exito) + ' de exito</span>' +
          '<small>' + x.nota + ' · ' + Math.round(x.o.ops) + ' operaciones</small>' +
          '</button>';
      }).join('') + '</div>';

    Array.prototype.forEach.call($('mejorRonda').querySelectorAll('.opcion'), function (b) {
      b.addEventListener('click', function () {
        $('tp').value = b.dataset.tp; guardar(); calcular();
      });
    });

    var paso = Math.max(1, Math.ceil(r.todas.length / 10));
    var filas = r.todas.filter(function (o, i) {
      return i % paso === 0 || Math.abs(o.tp - actualTp) < 0.01; });
    $('tablaTp').querySelector('tbody').innerHTML = filas.map(function (o) {
      return '<tr class="' + (Math.abs(o.tp - actualTp) < 0.01 ? 'actual' : '') + '">' +
        '<td>+' + o.tp.toFixed(2) + '</td><td><b>' + pct(o.exito) + '</b></td>' +
        '<td class="' + (o.ve >= 0 ? 'pos' : 'neg') + '">' + usd(o.ve) + '</td>' +
        '<td>' + Math.round(o.ops) + '</td></tr>';
    }).join('');
  }

  /* --------------------------- Cuenta atras ----------------------------- */

  var VALIDEZ = 30;
  function arrancarCuenta(){
    if (estado.cuentaTimer) return;
    estado.cuentaFin = Date.now() + VALIDEZ*1000;
    $('cuenta').hidden = false;
    estado.cuentaTimer = setInterval(pintarCuenta, 200);
    pintarCuenta();
  }
  function pararCuenta(){
    if (estado.cuentaTimer){ clearInterval(estado.cuentaTimer); estado.cuentaTimer=null; }
    estado.cuentaFin = null;
    if ($('cuenta')) $('cuenta').hidden = true;
  }
  function pintarCuenta(){
    if (!estado.cuentaFin) return;
    var r = Math.max(0, estado.cuentaFin - Date.now())/1000;
    $('cuentaNum').textContent = r.toFixed(1)+'s';
    $('cuentaBarra').style.width = (r/VALIDEZ*100)+'%';
    if (r <= 0) estado.cuentaFin = Date.now() + VALIDEZ*1000;
  }

  /* ------------------------ Simbolos y mercado -------------------------- */

  function pintarSimbolos(lista){
    var sel = $('simbolo'), previo = sel.value;
    sel.innerHTML = '';
    lista.forEach(function(x){
      var o = document.createElement('option');
      o.value = x.symbol; o.textContent = x.display_name; o.dataset.pip = x.pip;
      sel.appendChild(o);
    });
    if (lista.some(function(x){ return x.symbol === previo; })) sel.value = previo;
    var opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.pip){
      var pip = Number(opt.dataset.pip);
      estado.pipSize = pip>0 ? Math.round(-Math.log10(pip)) : 2;
    }
  }

  function conectar(){
    $('btnIniciar').disabled = true;
    $('connStatus').textContent = 'Conectando…';
    $('connDot').className = 'dot wait';

    api.connect(APP_ID)
      .then(function(){ return api.activeSymbols().catch(function(){ return []; }); })
      .then(function(lista){
        var utiles = lista.filter(function(x){
          return x.submarket === 'random_index' ||
                 /^(R_[0-9]+|1HZ[0-9]+V)$/.test(x.symbol);
        });
        // Si el filtro no encuentra nada, NO se vacia el desplegable.
        if (utiles.length) pintarSimbolos(utiles);
        return api.ticksHistory($('simbolo').value, 1000,
          function(t){
            if (t.pip_size !== undefined) estado.pipSize = t.pip_size;
            stats.push(t.quote, estado.pipSize); pintarVivo();
          },
          function(h, pip){
            if (pip !== undefined) estado.pipSize = pip;
            for (var i=0;i<h.prices.length;i++) stats.push(h.prices[i], estado.pipSize);
            pintarVivo();
          });
      })
      .then(function(s){
        estado.sub = s.reqId; estado.corriendo = true;
        $('connDot').className = 'dot on';
        $('estadoBadge').textContent = 'en vivo';
        $('estadoBadge').className = 'badge demo';
        $('btnIniciar').textContent = 'Desconectar';
        $('btnIniciar').disabled = false;
        $('connStatus').textContent = 'Recibiendo ticks reales de Deriv.';
        $('vivo').hidden = false;
        escanear();
        estado.escanTimer = setInterval(escanear, 45000);
        calcular();
      })
      .catch(function(e){
        api.disconnect();
        estado.corriendo = false;
        $('connDot').className = 'dot';
        $('btnIniciar').disabled = false;
        $('connStatus').textContent = 'No se pudo conectar (' + (e.code||'') + ' ' + e.message +
          '). Los calculos de arriba siguen siendo validos.';
      });
  }

  function desconectar(){
    if (estado.escanTimer){ clearInterval(estado.escanTimer); estado.escanTimer=null; }
    if (estado.sub !== null){ api.forget(estado.sub); estado.sub=null; }
    api.disconnect();
    estado.corriendo = false;
    $('connDot').className = 'dot';
    $('estadoBadge').textContent = 'sin conexion';
    $('estadoBadge').className = 'badge';
    $('btnIniciar').textContent = 'Conectar al mercado';
    $('connStatus').textContent = 'No conectado. Los calculos de arriba ya son validos.';
    $('vivo').hidden = true;
    pararCuenta();
  }

  $('btnIniciar').addEventListener('click', function(){
    if (estado.corriendo) desconectar(); else conectar();
  });

  function pintarVivo(){
    if (!stats.digits.length) return;
    var rep = stats.report(1000), c = cfg();
    $('precio').textContent = Number(rep.lastPrice).toFixed(estado.pipSize);
    var d = $('digito'); d.textContent = rep.last; d.style.background = COLORES[rep.last];

    var b = $('barras');
    if (b.children.length !== 10){
      b.innerHTML='';
      for (var i=0;i<10;i++){ var e=document.createElement('div');
        e.className='bar'; e.innerHTML='<u></u><i></i><em>'+i+'</em>'; b.appendChild(e); }
    }
    var mx = Math.max.apply(null, rep.pct) || 0.1;
    for (var k=0;k<10;k++){
      var el=b.children[k];
      el.className='bar'+(k===rep.hot?' hot':k===rep.cold?' cold':'');
      el.querySelector('u').textContent=(rep.pct[k]*100).toFixed(1);
      el.querySelector('i').style.height=Math.max(2,(rep.pct[k]/mx)*100)+'%';
    }
    $('sTicks').textContent = stats.digits.length;
    var w = window.Edge.countWins(stats.digits, c.tipo, c.barrera);
    $('sFreq').textContent = pct(w/stats.digits.length, 2);
    if (estado.analisis) $('sEq').textContent = pct(estado.analisis.equilibrio, 2);
    $('sChi').textContent = rep.pValue===null ? '—'
      : rep.chi2.toFixed(1)+' ('+rep.pValue.toFixed(3)+')';
  }

  /* ---------------- Escaner: que indice da la mejor ronda --------------- */

  function escanear(){
    if (!estado.corriendo) return;
    var c = cfg(), lleva = window.Ronda.CONTRATOS[c.tipo].barrera;
    var syms = Array.prototype.map.call($('simbolo').options, function(o){ return o.value; });
    var out = [], i = 0;

    (function sig(){
      if (i >= syms.length) return pintarEscaner(out);
      var s = syms[i++];
      api.proposal({ amount:c.stake, contract_type:c.tipo, currency:'USD',
        duration:1, duration_unit:'t', symbol:s, barrier: lleva ? c.barrera : undefined })
        .then(function(p){
          var mult = p.payout/p.ask_price;
          var an = window.Ronda.analizar({ tipo:c.tipo, barrera:c.barrera,
                     stake:c.stake, tp:c.tp, sl:c.sl, pago:mult });
          var nom = '';
          Array.prototype.forEach.call($('simbolo').options, function(o){
            if (o.value === s) nom = o.textContent; });
          out.push({ sym:s, nombre:nom||s, pago:mult, exito: an?an.probExito:0 });
        })
        .catch(function(){})
        .then(function(){ setTimeout(sig, 110); });
    })();
  }

  function pintarEscaner(lista){
    if (!lista.length){ $('escaner').innerHTML=''; $('notaEscaner').hidden=true; return; }
    lista.sort(function(a,b){ return b.exito - a.exito; });
    var actual = $('simbolo').value;
    $('escaner').innerHTML = '<div class="table-wrap"><table><thead><tr>' +
      '<th>Indice</th><th>Exito de tu ronda</th><th>Pago</th></tr></thead><tbody>' +
      lista.map(function(x,n){
        return '<tr class="'+(x.sym===actual?'actual':n===0?'good':'')+'">' +
          '<td>'+x.nombre+(n===0?' ★':'')+'</td>' +
          '<td><b>'+pct(x.exito)+'</b></td><td>x'+x.pago.toFixed(2)+'</td></tr>';
      }).join('') + '</tbody></table></div>';

    var nota = $('notaEscaner'); nota.hidden = false;
    if (lista[0].sym !== actual){
      nota.innerHTML = 'Tu misma ronda tiene <b>'+pct(lista[0].exito)+'</b> de exito en <b>'+
        lista[0].nombre+'</b>. Cambialo aqui y en el desplegable <b>Market</b> del bot.';
    } else {
      nota.innerHTML = 'Estas en el indice que mejor ronda da: <b>'+pct(lista[0].exito)+'</b>.';
    }
    // El pago real manda sobre el estimado
    $('pago').value = lista.filter(function(x){ return x.sym===actual; })
                           .map(function(x){ return x.pago.toFixed(2); })[0] || $('pago').value;
    calcular();
  }

  /* ------------------------------ Arranque ------------------------------ */

  ['tipo','barrera','stake','pago','tp','sl'].forEach(function(id){
    $(id).addEventListener('input', function(){ guardar(); calcular(); });
    $(id).addEventListener('change', function(){ guardar(); calcular(); });
  });
  $('tipo').addEventListener('change', function(){ pagoSugerido(); guardar(); calcular(); });
  $('simbolo').addEventListener('change', function(){
    guardar();
    if (estado.corriendo){ desconectar(); conectar(); }
  });

  pintarSimbolos(RESERVA);
  cargar();
  calcular();
})();
