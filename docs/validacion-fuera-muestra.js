'use strict';
global.window = {};
require('../js/tecnico.js');
require('../js/stats.js');
require('../js/edge.js');
const T = global.window.Tecnico, E = global.window.Edge;

function serie(n, vol, seg, ini) {
  const ta = (365*24*3600)/seg, s = vol/Math.sqrt(ta), p=[ini];
  for (let i=1;i<n;i++){ let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
    const z=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
    p.push(p[i-1]*Math.exp(s*z-0.5*s*s)); }
  return p;
}
const EST = {
  'RSI 14 sobrecompra/sobreventa': (p,i,c)=>{const r=c.rsi[i]; if(r===null)return null;
    if(r<30)return'CALL'; if(r>70)return'PUT'; return null;},
  'Ruptura de Bollinger 20': (p,i)=>{const b=T.bollinger(p,20,2,i); if(!b)return null;
    if(p[i]>=b.alto)return'CALL'; if(p[i]<=b.bajo)return'PUT'; return null;},
  'Soporte y resistencia': (p,i)=>{const pv=T.pivotes(p,5,i);
    if(pv.soporte===null||pv.resistencia===null)return null;
    const r=pv.resistencia-pv.soporte; if(r<=0)return null;
    if(p[i]<=pv.soporte+r*0.1)return'CALL'; if(p[i]>=pv.resistencia-r*0.1)return'PUT'; return null;},
  'AL AZAR (linea base)': ()=>Math.random()<0.5?'CALL':'PUT'
};
const DUR=5;
function eval_(fn, ss){ let w=0,t=0;
  for(const p of ss){ const c={rsi:T.rsiSerie(p,14)};
    for(let i=60;i<p.length-DUR;i++){ const s=fn(p,i,c); if(!s)continue;
      if(s==='CALL'? p[i+DUR]>p[i] : p[i+DUR]<p[i]) w++;
      t++; i+=DUR; } }
  return {w,t,tasa:t?w/t:0};
}
function corrida(etiqueta, nSeries){
  const ss=[]; for(let i=0;i<nSeries;i++) ss.push(serie(6000,0.75,2,1000));
  const out={};
  for(const [n,f] of Object.entries(EST)) out[n]=eval_(f,ss);
  console.log('\n--- '+etiqueta+' ('+(nSeries*6000).toLocaleString('es')+' ticks nuevos) ---');
  console.log('estrategia'.padEnd(32)+'entradas'.padStart(10)+'acierto'.padStart(10)+
              'IC 95%'.padStart(18)+'p corregido'.padStart(13));
  console.log('-'.repeat(83));
  const nombres=Object.keys(EST).filter(n=>!n.startsWith('AL AZAR'));
  const pvals=nombres.map(n=>E.binomTest(out[n].w, out[n].t, 0.5));
  const adj=E.holm(pvals);
  const base=out['AL AZAR (linea base)'];
  for(const [n,r] of Object.entries(out)){
    const ci=global.window.DigitStats.wilson(r.w,r.t);
    const k=nombres.indexOf(n);
    console.log(n.padEnd(32)+r.t.toLocaleString('es').padStart(10)+
      ((r.tasa*100).toFixed(2)+'%').padStart(10)+
      ('['+(ci.low*100).toFixed(2)+', '+(ci.high*100).toFixed(2)+']').padStart(18)+
      (k>=0? adj[k].toFixed(4) : '—').padStart(13));
  }
  return out;
}
console.log('=== VALIDACION FUERA DE MUESTRA ===');
console.log('Las tres candidatas, sobre datos que nunca se usaron para elegirlas.');
console.log('p corregido por Holm: tiene que bajar de 0.05 para ser una senal.');
const a = corrida('PRUEBA 1', 40);
const b = corrida('PRUEBA 2 (otros datos distintos)', 40);
console.log('\n=== VEREDICTO ===\n');
for(const n of Object.keys(EST)){
  if(n.startsWith('AL AZAR')) continue;
  const t1=(a[n].tasa*100), t2=(b[n].tasa*100);
  const cons = (t1>50 && t2>50);
  console.log('  '+n.padEnd(32)+' prueba1 '+t1.toFixed(2)+'%  prueba2 '+t2.toFixed(2)+'%  '+
    (cons?'consistente':'NO se repite'));
}
