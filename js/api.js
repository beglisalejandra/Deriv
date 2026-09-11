/* =========================================================================
 * api.js — Cliente WebSocket para la API de Deriv (v3)
 * Sin dependencias. Se expone como window.DerivAPI
 * Docs: https://api.deriv.com/api-explorer
 * ========================================================================= */
(function (global) {
  'use strict';

  var ENDPOINT = 'wss://ws.derivws.com/websockets/v3';

  function DerivAPI() {
    this.ws = null;
    this.reqId = 0;
    this.pending = new Map();   // req_id -> {resolve, reject, timer}
    this.streams = new Map();   // req_id -> callback
    this.subIds = new Map();    // req_id -> subscription id (para forget)
    this.pingTimer = null;
    this.onStatus = function () {};
    this.account = null;        // respuesta de authorize
  }

  DerivAPI.prototype.isOpen = function () {
    if (this.demo) return true;
    return !!this.ws && this.ws.readyState === 1;
  };

  DerivAPI.prototype.connect = function (appId) {
    var self = this;
    return new Promise(function (resolve, reject) {
      try { if (self.ws) { self.ws.onclose = null; self.ws.close(); } } catch (e) {}
      // Salir de la demostracion local si estaba activa: de lo contrario
      // authorize devolveria la cuenta ficticia en lugar de la real.
      self.demo = false;
      if (self.demoTimer) { clearInterval(self.demoTimer); self.demoTimer = null; }
      self.account = null;
      self.pending.clear(); self.streams.clear(); self.subIds.clear();

      var url = ENDPOINT + '?app_id=' + encodeURIComponent(appId) + '&l=ES&brand=deriv';
      var ws = new WebSocket(url);
      self.ws = ws;
      self.onStatus('conectando');

      var timer = setTimeout(function () {
        try { ws.close(); } catch (e) {}
        reject(new Error('Tiempo de espera agotado al conectar con Deriv.'));
      }, 15000);

      ws.onopen = function () {
        clearTimeout(timer);
        self.onStatus('conectado');
        self._startPing();
        resolve();
      };
      ws.onerror = function () {
        clearTimeout(timer);
        reject(new Error('No se pudo abrir la conexion WebSocket. Revisa el App ID y tu red.'));
      };
      ws.onclose = function () {
        self._stopPing();
        self.account = null;
        self.onStatus('desconectado');
        self._failAll('La conexion se cerro.');
      };
      ws.onmessage = function (ev) { self._onMessage(ev); };
    });
  };

  DerivAPI.prototype.disconnect = function () {
    this.demo = false;
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = null; }
    this._stopPing();
    try { if (this.ws) this.ws.close(); } catch (e) {}
    this.ws = null;
    this.account = null;
  };

  DerivAPI.prototype._startPing = function () {
    var self = this;
    this._stopPing();
    this.pingTimer = setInterval(function () {
      if (self.isOpen()) { try { self.ws.send(JSON.stringify({ ping: 1 })); } catch (e) {} }
    }, 25000);
  };

  DerivAPI.prototype._stopPing = function () {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  };

  DerivAPI.prototype._failAll = function (msg) {
    this.pending.forEach(function (p) { clearTimeout(p.timer); p.reject(new Error(msg)); });
    this.pending.clear();
    this.streams.clear();
    this.subIds.clear();
  };

  DerivAPI.prototype._onMessage = function (ev) {
    var data;
    try { data = JSON.parse(ev.data); } catch (e) { return; }
    if (data.msg_type === 'ping' || data.msg_type === 'pong') return;

    var id = data.req_id;
    if (id === undefined) return;

    // Guardar el id de suscripcion para poder hacer forget luego.
    if (data.subscription && data.subscription.id) this.subIds.set(id, data.subscription.id);

    var p = this.pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      if (data.error) { this.streams.delete(id); p.reject(apiError(data.error)); return; }
      p.resolve(data);
    }

    var stream = this.streams.get(id);
    if (stream) {
      if (data.error) { this.streams.delete(id); stream(null, apiError(data.error)); }
      else stream(data, null);
    }
  };

  function apiError(err) {
    var e = new Error(err.message || 'Error de la API de Deriv');
    e.code = err.code;
    return e;
  }

  /* Envia una peticion puntual y resuelve con la respuesta. */
  DerivAPI.prototype.send = function (payload, timeoutMs) {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (!self.isOpen()) { reject(new Error('No hay conexion con Deriv.')); return; }
      var id = ++self.reqId;
      var msg = Object.assign({}, payload, { req_id: id });
      var timer = setTimeout(function () {
        self.pending.delete(id);
        reject(new Error('Sin respuesta de Deriv para: ' + Object.keys(payload)[0]));
      }, timeoutMs || 20000);
      self.pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try { self.ws.send(JSON.stringify(msg)); }
      catch (e) { clearTimeout(timer); self.pending.delete(id); reject(e); }
    });
  };

  /* Envia una peticion con subscribe:1. onData recibe TODOS los mensajes.
     Devuelve {reqId, first} y un metodo forget(). */
  DerivAPI.prototype.subscribe = function (payload, onData) {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (!self.isOpen()) { reject(new Error('No hay conexion con Deriv.')); return; }
      var id = ++self.reqId;
      var msg = Object.assign({}, payload, { subscribe: 1, req_id: id });
      var timer = setTimeout(function () {
        self.pending.delete(id); self.streams.delete(id);
        reject(new Error('Sin respuesta de Deriv al suscribirse.'));
      }, 20000);
      self.pending.set(id, {
        resolve: function (first) { resolve({ reqId: id, first: first }); },
        reject: reject,
        timer: timer
      });
      self.streams.set(id, onData);
      try { self.ws.send(JSON.stringify(msg)); }
      catch (e) { clearTimeout(timer); self.pending.delete(id); self.streams.delete(id); reject(e); }
    });
  };

  DerivAPI.prototype.forget = function (reqId) {
    if (this.demo) {
      if (reqId === -2 && this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = null; }
      return;
    }
    var subId = this.subIds.get(reqId);
    this.streams.delete(reqId);
    this.subIds.delete(reqId);
    if (subId && this.isOpen()) {
      try { this.ws.send(JSON.stringify({ forget: subId, req_id: ++this.reqId })); } catch (e) {}
    }
  };


  /* =======================================================================
   *  Modo demostracion — sin cuenta, sin red, sin dinero
   *
   *  Genera un flujo de ticks localmente con digitos uniformes sobre 0-9,
   *  que es el modelo del generador real de Deriv, y cotiza los contratos
   *  con la misma formula pago = (1/probabilidad) x (1 - comision).
   *  Sirve para recorrer toda la herramienta antes de tocar una cuenta.
   * ===================================================================== */

  var DEMO_SYMBOLS = [
    { symbol:'1HZ10V',  display_name:'Volatility 10 (1s) Index',  pip:0.001, base:9582.36,  pipSize:3 },
    { symbol:'1HZ25V',  display_name:'Volatility 25 (1s) Index',  pip:0.01,  base:775187.34,pipSize:2 },
    { symbol:'1HZ50V',  display_name:'Volatility 50 (1s) Index',  pip:0.01,  base:243.81,   pipSize:2 },
    { symbol:'1HZ75V',  display_name:'Volatility 75 (1s) Index',  pip:0.01,  base:78000.00, pipSize:2 },
    { symbol:'1HZ100V', display_name:'Volatility 100 (1s) Index', pip:0.01,  base:676.97,   pipSize:2 },
    { symbol:'R_75',    display_name:'Volatility 75 Index',       pip:0.0001,base:678.56,   pipSize:4 }
  ];

  DerivAPI.prototype.connectDemo = function () {
    this.disconnect();
    this.demo = true;
    this.demoTimer = null;
    this.demoPrice = 78000;
    this.account = {
      loginid: 'DEMO-LOCAL', balance: 1000, currency: 'USD', is_virtual: 1
    };
    this.onStatus('conectado');
    return Promise.resolve();
  };

  DerivAPI.prototype._demoTick = function (pipSize) {
    // Camino aleatorio en el precio, con el ultimo digito uniforme sobre 0-9
    // e independiente del anterior, igual que en el producto real.
    var step = (Math.random() - 0.5) * 2;
    this.demoPrice = Math.max(1, this.demoPrice + step);
    var unit = Math.pow(10, -pipSize);
    var digit = Math.floor(Math.random() * 10);
    var base = Math.floor(this.demoPrice / (unit * 10)) * (unit * 10);
    return Number((base + digit * unit).toFixed(pipSize));
  };

  DerivAPI.prototype._demoPayout = function (type, barrier) {
    var p = global.DigitStats.theoreticalWinProb(type, Number(barrier));
    if (!p) return null;
    // Comision real observada: ~10.7% en eventos raros, ~1.9% en los seguros.
    var edge = p <= 0.2 ? 0.1071 : p >= 0.8 ? 0.0190 : 0.1071 + ((p - 0.2) / 0.6) * (0.0190 - 0.1071);
    return (1 / p) * (1 - edge);
  };


  /* =======================================================================
   *  OAuth — el metodo oficial de Deriv para aplicaciones de terceros
   *
   *  En lugar de pegar un token a mano, se redirige al usuario a Deriv,
   *  inicia sesion alli, y Deriv devuelve a la aplicacion una credencial
   *  por cada cuenta suya. Esas credenciales si las acepta authorize.
   * ===================================================================== */

  var OAUTH_URL = 'https://oauth.deriv.com/oauth2/authorize';

  DerivAPI.redirigirAOAuth = function (appId, redirect) {
    var url = OAUTH_URL + '?app_id=' + encodeURIComponent(appId) + '&l=ES&brand=deriv';
    if (redirect) url += '&redirect_uri=' + encodeURIComponent(redirect);
    global.location.href = url;
  };

  /* Lee las cuentas que Deriv deja en la URL al volver de OAuth.
     Formato: ?acct1=VRTC123&token1=a1-xxx&cur1=USD&acct2=CR456&token2=... */
  DerivAPI.leerCuentasDeLaURL = function () {
    var params = new URLSearchParams(global.location.search);
    var cuentas = [];
    for (var i = 1; i <= 20; i++) {
      var loginid = params.get('acct' + i);
      var token = params.get('token' + i);
      if (!loginid || !token) continue;
      cuentas.push({
        loginid: loginid,
        token: token,
        currency: params.get('cur' + i) || 'USD',
        esDemo: /^VRT/i.test(loginid)
      });
    }
    return cuentas;
  };

  /* Borra las credenciales de la barra de direcciones sin recargar. */
  DerivAPI.limpiarURL = function () {
    try {
      global.history.replaceState({}, document.title,
        global.location.pathname + global.location.hash);
    } catch (e) {}
  };

  /* ---------------------- Atajos de alto nivel ---------------------- */

  DerivAPI.prototype.authorize = function (token) {
    var self = this;
    if (this.demo) return Promise.resolve(this.account);
    return this.send({ authorize: token }).then(function (r) {
      self.account = r.authorize;
      return r.authorize;
    });
  };

  DerivAPI.prototype.activeSymbols = function () {
    if (this.demo) {
      return Promise.resolve(DEMO_SYMBOLS.map(function (s) {
        return { symbol: s.symbol, display_name: s.display_name, pip: s.pip,
                 submarket: 'random_index', exchange_is_open: 1 };
      }));
    }
    return this.send({ active_symbols: 'brief', product_type: 'basic' })
      .then(function (r) { return r.active_symbols || []; });
  };

  DerivAPI.prototype.balance = function (onUpdate) {
    if (this.demo) {
      onUpdate({ balance: this.account.balance, currency: 'USD' });
      return Promise.resolve({ reqId: -1 });
    }
    return this.subscribe({ balance: 1, account: 'current' }, function (d, err) {
      if (!err && d && d.balance) onUpdate(d.balance);
    });
  };

  /* Historial + stream de ticks en una sola llamada. */
  DerivAPI.prototype.ticksHistory = function (symbol, count, onTick, onHistory) {
    if (this.demo) {
      var self = this;
      var meta = DEMO_SYMBOLS.filter(function (s) { return s.symbol === symbol; })[0] || DEMO_SYMBOLS[3];
      var ps = meta.pipSize;
      self.demoPrice = meta.base;
      if (self.demoTimer) clearInterval(self.demoTimer);
      var prices = [], times = [], now = Math.floor(Date.now() / 1000);
      for (var i = 0; i < count; i++) { prices.push(self._demoTick(ps)); times.push(now - count + i); }
      setTimeout(function () {
        if (onHistory) onHistory({ prices: prices, times: times }, ps);
        self.demoTimer = setInterval(function () {
          if (onTick) onTick({ symbol: symbol, quote: self._demoTick(ps),
                               epoch: Math.floor(Date.now() / 1000), pip_size: ps });
        }, 700);
      }, 30);
      return Promise.resolve({ reqId: -2 });
    }
    return this.subscribe({
      ticks_history: symbol,
      count: count,
      end: 'latest',
      style: 'ticks'
    }, function (d, err) {
      if (err) return;
      if (d.msg_type === 'history' && onHistory) onHistory(d.history, d.pip_size);
      else if (d.msg_type === 'tick' && onTick) onTick(d.tick);
    });
  };

  /* Cotizacion de un contrato (sin suscripcion, una sola foto). */
  DerivAPI.prototype.proposal = function (params) {
    if (this.demo) {
      var mult = this._demoPayout(params.contract_type, params.barrier);
      if (!mult) return Promise.reject(new Error('Contrato no disponible en demostracion.'));
      return Promise.resolve({
        id: 'demo', ask_price: params.amount,
        payout: Number((params.amount * mult).toFixed(2)), spot: this.demoPrice
      });
    }
    var req = {
      proposal: 1,
      amount: params.amount,
      basis: 'stake',
      contract_type: params.contract_type,
      currency: params.currency,
      duration: params.duration,
      duration_unit: params.duration_unit || 't',
      symbol: params.symbol
    };
    if (params.barrier !== undefined && params.barrier !== null && params.barrier !== '') {
      req.barrier = String(params.barrier);
    }
    return this.send(req, 15000).then(function (r) { return r.proposal; });
  };

  DerivAPI.prototype.buy = function (proposalId, price) {
    if (this.demo) {
      return Promise.reject(new Error(
        'El modo demostracion no envia ordenes. Usa el modo Simulacion del bot.'));
    }
    return this.send({ buy: proposalId, price: price }, 20000)
      .then(function (r) { return r.buy; });
  };

  /* Sigue un contrato hasta que se liquida. Resuelve con el contrato vendido. */
  DerivAPI.prototype.trackContract = function (contractId) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var reqId = null;
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (reqId !== null) self.forget(reqId);
        reject(new Error('El contrato ' + contractId + ' no se liquido a tiempo.'));
      }, 120000);

      self.subscribe({ proposal_open_contract: 1, contract_id: contractId }, function (d, err) {
        if (done) return;
        if (err) { done = true; clearTimeout(timer); reject(err); return; }
        var c = d && d.proposal_open_contract;
        if (!c) return;
        if (c.is_sold) {
          done = true;
          clearTimeout(timer);
          if (reqId !== null) self.forget(reqId);
          resolve(c);
        }
      }).then(function (s) {
        reqId = s.reqId;
        var c = s.first && s.first.proposal_open_contract;
        if (c && c.is_sold && !done) {
          done = true; clearTimeout(timer); self.forget(reqId); resolve(c);
        }
      }).catch(function (e) {
        if (done) return;
        done = true; clearTimeout(timer); reject(e);
      });
    });
  };

  global.DerivAPI = DerivAPI;
})(window);
