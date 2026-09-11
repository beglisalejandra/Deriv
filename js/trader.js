/* =========================================================================
 * trader.js — Motor de operacion automatica (simulado y real)
 * Se expone como window.TradeEngine
 *
 * Dos modos:
 *   'sim'  -> no envia ordenes. Liquida contra el siguiente tick real usando
 *             el multiplicador de pago que cotiza la API. Sirve para medir.
 *   'real' -> proposal -> buy -> proposal_open_contract, dinero de verdad.
 * ========================================================================= */
(function (global) {
  'use strict';

  var MONEY = {
    flat:      function (base, ctx) { return base; },
    martingale:function (base, ctx) { return base * Math.pow(ctx.factor, ctx.lossStreak); },
    dalembert: function (base, ctx) { return base * (1 + ctx.lossStreak); },
    fibonacci: function (base, ctx) {
      var a = 1, b = 1;
      for (var i = 0; i < ctx.lossStreak; i++) { var t = a + b; a = b; b = t; }
      return base * a;
    }
  };

  function TradeEngine(api, stats) {
    this.api = api;
    this.stats = stats;
    this.running = false;
    this.busy = false;
    this.cfg = null;
    this.reset();
    this.onTrade = function () {};
    this.onState = function () {};
    this.onLog = function () {};
  }

  TradeEngine.prototype.reset = function () {
    this.trades = [];
    this.pnl = 0;
    this.totalStake = 0;
    this.totalPayout = 0;
    this.wins = 0;
    this.losses = 0;
    this.lossStreak = 0;
    this.winStreak = 0;
    this.maxDrawdown = 0;
    this.peakPnl = 0;
    this.stopReason = null;
  };

  TradeEngine.prototype.nextStake = function () {
    var c = this.cfg;
    var fn = MONEY[c.money] || MONEY.flat;
    var raw = fn(c.baseStake, { factor: c.factor, lossStreak: this.lossStreak });
    // El tope de pasos evita que la escalera crezca sin control.
    if (c.money !== 'flat' && this.lossStreak >= c.maxSteps) raw = c.baseStake;
    return Math.min(Math.round(raw * 100) / 100, c.maxStake);
  };

  /* Comprueba los limites ANTES de abrir una operacion. */
  TradeEngine.prototype.checkGuards = function () {
    var c = this.cfg;
    if (c.takeProfit > 0 && this.pnl >= c.takeProfit)
      return 'Objetivo de ganancia alcanzado (+' + this.pnl.toFixed(2) + ').';
    if (c.stopLoss > 0 && this.pnl <= -c.stopLoss)
      return 'Limite de perdida alcanzado (' + this.pnl.toFixed(2) + ').';
    if (c.maxTrades > 0 && this.trades.length >= c.maxTrades)
      return 'Se alcanzo el maximo de ' + c.maxTrades + ' operaciones.';
    if (c.maxLossStreak > 0 && this.lossStreak >= c.maxLossStreak)
      return 'Se alcanzaron ' + this.lossStreak + ' perdidas seguidas.';
    var next = this.nextStake();
    if (next > c.maxStake)
      return 'El siguiente stake (' + next.toFixed(2) + ') supera el tope de ' + c.maxStake.toFixed(2) + '.';
    return null;
  };

  TradeEngine.prototype.start = function (cfg) {
    if (this.running) return;
    this.cfg = cfg;
    this.running = true;
    this.stopReason = null;
    this.onState();
    this.onLog('Motor iniciado en modo ' + (cfg.mode === 'real' ? 'REAL' : 'SIMULACION') + '.');
    this._loop();
  };

  TradeEngine.prototype.stop = function (reason) {
    if (!this.running) return;
    this.running = false;
    this.stopReason = reason || 'Detenido manualmente.';
    this.onLog(this.stopReason);
    this.onState();
  };

  TradeEngine.prototype._loop = function () {
    var self = this;
    if (!this.running) return;

    var guard = this.checkGuards();
    if (guard) { this.stop(guard); return; }

    if (this.busy) { setTimeout(function () { self._loop(); }, 200); return; }
    if (this.stats.digits.length < this.cfg.minTicks) {
      setTimeout(function () { self._loop(); }, 500); return;
    }

    this.busy = true;
    this._trade()
      .catch(function (e) {
        self.onLog('Error: ' + e.message);
        if (/AuthorizationRequired|InvalidToken|insufficient/i.test(e.code || e.message || '')) {
          self.running = false;
          self.stopReason = 'Detenido por error de cuenta: ' + e.message;
          self.onState();
        }
      })
      .then(function () {
        self.busy = false;
        if (!self.running) return;
        setTimeout(function () { self._loop(); }, self.cfg.cooldownMs);
      });
  };

  TradeEngine.prototype._trade = function () {
    var self = this;
    var c = this.cfg;
    var rep = this.stats.report(c.windowTicks);
    var strat = global.DigitStats.STRATEGIES[c.strategy];
    if (!strat) return Promise.reject(new Error('Estrategia desconocida: ' + c.strategy));
    var signal = strat.run(rep);
    var stake = this.nextStake();

    var params = {
      amount: stake,
      contract_type: signal.contract_type,
      currency: c.currency,
      duration: c.duration,
      duration_unit: 't',
      symbol: c.symbol,
      barrier: signal.barrier
    };

    return this.api.proposal(params).then(function (p) {
      var payoutMult = p.payout / p.ask_price;

      // Filtro de pago minimo: el usuario pide x7/x10, aqui se hace cumplir.
      if (c.minPayoutMult > 0 && payoutMult < c.minPayoutMult) {
        self.onLog('Operacion omitida: pago x' + payoutMult.toFixed(2) +
                   ' por debajo del minimo x' + c.minPayoutMult.toFixed(2) + '.');
        return null;
      }

      if (c.mode === 'sim') return self._settleSim(signal, stake, payoutMult, rep);
      return self.api.buy(p.id, p.ask_price).then(function (b) {
        self.onLog('Compra ' + signal.contract_type +
                   (signal.barrier !== null && signal.barrier !== undefined ? ' [' + signal.barrier + ']' : '') +
                   ' por ' + stake.toFixed(2) + ' ' + c.currency + ' (pago x' + payoutMult.toFixed(2) + ').');
        return self.api.trackContract(b.contract_id).then(function (contract) {
          var won = contract.status === 'won';
          return self._record({
            mode: 'real',
            contract_type: signal.contract_type,
            barrier: signal.barrier,
            stake: Number(b.buy_price),
            payout: won ? Number(contract.payout) : 0,
            payoutMult: payoutMult,
            profit: Number(contract.profit),
            won: won,
            entry: contract.entry_tick_display_value,
            exit: contract.exit_tick_display_value,
            resultDigit: contract.exit_tick_display_value != null
              ? Number(String(contract.exit_tick_display_value).slice(-1)) : null,
            reason: signal.reason,
            contract_id: contract.contract_id
          });
        });
      });
    });
  };

  /* Simulacion: espera al siguiente tick real y liquida con las reglas de Deriv. */
  TradeEngine.prototype._settleSim = function (signal, stake, payoutMult, rep) {
    var self = this;
    var startLen = this.stats.digits.length;
    var pipSize = this.cfg.pipSize;
    return new Promise(function (resolve, reject) {
      var waited = 0;
      var iv = setInterval(function () {
        waited += 150;
        if (!self.running) { clearInterval(iv); resolve(null); return; }
        var need = self.cfg.duration;
        if (self.stats.digits.length >= startLen + need) {
          clearInterval(iv);
          var d = self.stats.digits[startLen + need - 1];
          var won = evaluate(signal.contract_type, signal.barrier, d);
          resolve(self._record({
            mode: 'sim',
            contract_type: signal.contract_type,
            barrier: signal.barrier,
            stake: stake,
            payout: won ? stake * payoutMult : 0,
            payoutMult: payoutMult,
            profit: won ? stake * payoutMult - stake : -stake,
            won: won,
            entry: rep.lastPrice,
            exit: self.stats.prices[startLen + need - 1],
            resultDigit: d,
            reason: signal.reason,
            contract_id: null
          }));
        } else if (waited > 60000) {
          clearInterval(iv);
          reject(new Error('No llegaron ticks nuevos para liquidar la simulacion.'));
        }
      }, 150);
    });
  };

  function evaluate(type, barrier, digit) {
    switch (type) {
      case 'DIGITMATCH': return digit === barrier;
      case 'DIGITDIFF':  return digit !== barrier;
      case 'DIGITOVER':  return digit > barrier;
      case 'DIGITUNDER': return digit < barrier;
      case 'DIGITEVEN':  return digit % 2 === 0;
      case 'DIGITODD':   return digit % 2 === 1;
      default: return false;
    }
  }

  TradeEngine.prototype._record = function (t) {
    t.index = this.trades.length + 1;
    t.time = new Date();
    this.trades.push(t);

    this.pnl += t.profit;
    this.totalStake += t.stake;
    this.totalPayout += t.payout;

    if (t.won) { this.wins++; this.winStreak++; this.lossStreak = 0; }
    else { this.losses++; this.lossStreak++; this.winStreak = 0; }

    if (this.pnl > this.peakPnl) this.peakPnl = this.pnl;
    var dd = this.peakPnl - this.pnl;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;

    this.onTrade(t);
    this.onState();
    return t;
  };

  TradeEngine.prototype.summary = function () {
    var n = this.trades.length;
    return {
      trades: n,
      wins: this.wins,
      losses: this.losses,
      winRate: n ? this.wins / n : 0,
      pnl: this.pnl,
      totalStake: this.totalStake,
      totalPayout: this.totalPayout,
      maxDrawdown: this.maxDrawdown,
      lossStreak: this.lossStreak,
      roi: this.totalStake ? this.pnl / this.totalStake : 0
    };
  };

  TradeEngine.prototype.toCSV = function () {
    var head = 'n,hora,modo,contrato,barrera,stake,pago,multiplo,resultado,digito,ganancia,pnl_acum\n';
    var acc = 0;
    return head + this.trades.map(function (t) {
      acc += t.profit;
      return [t.index, t.time.toISOString(), t.mode, t.contract_type,
              t.barrier === null || t.barrier === undefined ? '' : t.barrier,
              t.stake.toFixed(2), t.payout.toFixed(2), t.payoutMult.toFixed(4),
              t.won ? 'ganada' : 'perdida', t.resultDigit === null ? '' : t.resultDigit,
              t.profit.toFixed(2), acc.toFixed(2)].join(',');
    }).join('\n');
  };

  TradeEngine.MONEY = MONEY;
  TradeEngine.evaluate = evaluate;
  global.TradeEngine = TradeEngine;
})(window);
