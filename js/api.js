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
    return !!this.ws && this.ws.readyState === 1;
  };

  DerivAPI.prototype.connect = function (appId) {
    var self = this;
    return new Promise(function (resolve, reject) {
      try { if (self.ws) { self.ws.onclose = null; self.ws.close(); } } catch (e) {}
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
    var subId = this.subIds.get(reqId);
    this.streams.delete(reqId);
    this.subIds.delete(reqId);
    if (subId && this.isOpen()) {
      try { this.ws.send(JSON.stringify({ forget: subId, req_id: ++this.reqId })); } catch (e) {}
    }
  };

  /* ---------------------- Atajos de alto nivel ---------------------- */

  DerivAPI.prototype.authorize = function (token) {
    var self = this;
    return this.send({ authorize: token }).then(function (r) {
      self.account = r.authorize;
      return r.authorize;
    });
  };

  DerivAPI.prototype.activeSymbols = function () {
    return this.send({ active_symbols: 'brief', product_type: 'basic' })
      .then(function (r) { return r.active_symbols || []; });
  };

  DerivAPI.prototype.balance = function (onUpdate) {
    return this.subscribe({ balance: 1, account: 'current' }, function (d, err) {
      if (!err && d && d.balance) onUpdate(d.balance);
    });
  };

  /* Historial + stream de ticks en una sola llamada. */
  DerivAPI.prototype.ticksHistory = function (symbol, count, onTick, onHistory) {
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
