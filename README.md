# Digits Trading Analytics — Deriv

Las dos herramientas del video, reconstruidas y **unificadas en una sola app web**:
el analizador de dígitos en vivo y el bot que ejecuta las operaciones.

No hay que instalar nada, no hay build, no hay dependencias. Es HTML + JavaScript.

---

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `index.html` + `css/` + `js/` | **La app.** Decisión de entrada + análisis en vivo + escáner de pagos + bot + rigor estadístico |
| `bots/matches-stake-fijo.xml` | Bot para `bot.deriv.com` con stake constante y límites |
| `bots/matches-martingala.xml` | Réplica del bot del video (martingala x2.2) |
| `docs/backtest.js` | Simulación Monte Carlo que mide cuánto dura cada plan |
| `docs/matematica.md` | Los números detrás de todo esto |

En el video eran dos apps separadas que se comunicaban con un "Bot Connection String".
Aquí no hace falta: la misma página que analiza es la que compra, así que no hay
token que copiar entre pantallas ni dos dispositivos abiertos a la vez.

---

## Cómo usarla

### 1. Abrir la app

**Opción A — GitHub Pages** (recomendada, funciona desde el móvil):
en el repo → *Settings* → *Pages* → *Source: Deploy from a branch* → rama `claude/zen-cori-njevfm`, carpeta `/ (root)`.
En un minuto tendrás una URL como `https://beglisalejandra.github.io/Deriv/`.

**Opción B — local:**
```bash
git clone https://github.com/beglisalejandra/Deriv.git
cd Deriv
python3 -m http.server 8000
# abrir http://localhost:8000
```

### 2. Crear el API token

En `app.deriv.com` → **Configuración** → **API token** → marcar **Read** y **Trade** → crear.

Empieza con una cuenta **Demo**. La app muestra un distintivo rojo `REAL` o azul `DEMO`
arriba a la derecha para que nunca haya duda de dónde estás operando.

### 3. Operar

1. **Panel** → pegar el token → *Conectar*. Elegir índice y estrategia → *Iniciar análisis* → *Predecir*.
   Aparece la **decisión de entrada**: `ENTRAR` o `NO ENTRAR`, con el porcentaje de
   probabilidad de que esa entrada concreta sea rentable.
2. **Pagos** → *Escanear pagos*. Cotiza en vivo las ~21 combinaciones de contrato y te dice
   cuáles pagan **x7, x9 o más** con stake de 1, 3 o 5 USD. Esta pestaña responde
   directamente a lo que pediste.
3. **Bot** → elegir modo, stake y límites → *Ejecutar*. La casilla **«operar solo cuando la
   puerta diga ENTRAR»** viene activada: el motor no envía ninguna orden si la entrada no
   supera el punto de equilibrio con la certeza exigida.
4. **Rigor** → detección de sesgo por dígito y tabla de calibración.
5. **Resultados** → P/L, tasa de acierto, caída máxima, exportar CSV.

---

## Sobre el "x7 o x10"

En el video, la pestaña de transacciones muestra:

```
Total stake    100.00 USD
Total payout   892.86 USD
```

Eso es **x8.93 en una sola operación**. Pero ese número es el **pago**, no la tasa de
acierto. `Matches` con un dígito acierta **1 de cada 10 veces**. El pago justo de un
evento 1-en-10 sería x10.00 exacto; Deriv paga x8.93. Esa diferencia —**10.7%**— es la
comisión de la casa, y se cobra en cada operación.

La app trae un **escáner de pagos** que cotiza los multiplicadores reales contra la API
y calcula el valor esperado de cada uno, para que elijas con los números a la vista.

### Lo que mide el backtest

`docs/backtest.js` corre las mismas estrategias de la app contra un RNG uniforme,
200.000 operaciones cada una:

```
estrategia                                   aciertos   teorico       ROI
-------------------------------------------------------------------------
Matches — dígito más frecuente                 10.03%    10.00%   -10.42%
Matches — dígito menos frecuente               10.01%    10.00%   -10.67%
Differs — contra el dígito menos frecuente     90.09%    90.00%    -1.80%
Over 8 — solo gana el 9                         9.93%    10.00%   -11.30%
Par / Impar                                    49.89%    50.00%    -6.52%
Matches al azar (control)                       9.94%    10.00%   -11.25%
```

La línea que importa es la última. **Elegir el dígito "más caliente" acierta 10.03%.
Elegirlo al azar acierta 9.94%.** Son el mismo número dentro del margen de error.
El análisis de frecuencias no mejora nada, porque los ticks de los índices de
volatilidad son independientes: el generador no recuerda los dígitos anteriores.

Por eso la app incluye la estrategia **"Matches al azar (control)"**: es la línea base
contra la que puedes comparar cualquier otra en modo simulación, con tus propios datos.

### Sesiones completas, 5.000 simulaciones de 200 operaciones, banca 100 USD

```
plan                                en ganancia   quiebra   P/L medio       peor
------------------------------------------------------------------------------
1 USD fija                               25.84%     2.26%      -21.64    -100.00
3 USD fija                               24.26%    58.62%      -45.14     -99.85
5 USD fija                               16.90%    78.16%      -52.27    -100.00
1 USD martingala x2.2 (tope 5)           10.76%    88.42%      -39.53     -99.99
1 USD martingala x2.2 (tope 8)            6.46%    98.82%      -33.34     -99.98
1 USD martingala x2.2 (sin tope)          8.26%   100.00%      -52.11     -98.34
```

La martingala x2.2 del video no reduce el riesgo: lo concentra. Cambia muchas
pérdidas pequeñas por una pérdida total menos frecuente. Para cubrir 8 pasos
partiendo de 1 USD hacen falta **456 USD**, y con 90% de probabilidad de perder
cada operación, encadenar 8 pérdidas ocurre de media **cada 13 operaciones**.

Corre el backtest tú mismo:
```bash
node docs/backtest.js
```

---

## Qué hace la app que las del video no hacían

- **Modo simulación por defecto.** Liquida contra los ticks reales del mercado, con el
  multiplicador que cotiza la API, pero sin dinero. Puedes medir una estrategia durante
  horas antes de arriesgar un dólar.
- **Prueba chi-cuadrado de uniformidad** sobre la ventana de análisis. Si una
  distribución realmente se desvía, lo dice con un valor *p*; si no, lo dice también.
  Sustituye al "78% de confianza" del video, que no salía de ningún cálculo.
- **Intervalos de confianza de Wilson** sobre la frecuencia observada: con 32 ticks,
  un dígito al 15.6% tiene un intervalo que va de ~7% a ~32%. Es decir, no distingue
  nada.
- **Escáner de pagos** con el valor esperado real de cada contrato.
- **Límites de riesgo que se cumplen**: objetivo de ganancia, pérdida máxima, stake
  máximo, operaciones máximas, racha perdedora máxima y pago mínimo exigido. El motor
  los comprueba antes de cada operación, no después.
- **Exportación CSV** de todas las operaciones.

---

## La decisión de entrada

Pediste que la herramienta indique el porcentaje de probabilidad de éxito al momento de
entrar. Eso está construido, pero la cifra útil no es "probabilidad de acertar" — es esta:

> **P( tasa de acierto real > tasa de equilibrio | los datos observados )**

Porque acertar no basta: hay que acertar **por encima del punto donde el pago cubre la
comisión**. Ese punto es `1 / multiplicador de pago`:

| Contrato | Pago | Hay que acertar | El RNG da | Diferencia |
|---|---|---|---|---|
| Matches | x8.93 | **11.20%** | 10.00% | −1.20 pp |
| Over 8 | x8.93 | **11.20%** | 10.00% | −1.20 pp |
| Par / Impar | x1.95 | **51.28%** | 50.00% | −1.28 pp |
| Differs | x1.09 | **91.74%** | 90.00% | −1.74 pp |

La app calcula la posterior bayesiana de la tasa real con un **prior de Jeffreys
Beta(0,5, 0,5)** — deliberadamente débil, para que manden los datos y no la suposición
previa — y de ahí sale el porcentaje que ves en la barra.

### La puerta

La casilla del bot hace cumplir la decisión: **no se envía ninguna orden mientras la
probabilidad de rentabilidad no supere el umbral** (95% por defecto) con muestra
suficiente (500 ticks por defecto).

Esto es lo que pediste como "garantizar un margen de efectividad": está implementado como
una condición que se verifica antes de cada orden, no como una promesa.

### La puerta no es un "no" fijo

`docs/backtest.js` la somete a prueba contra dos fuentes — una uniforme y otra con un
sesgo real inyectado del 8% — 300 sesiones de 300 operaciones cada una:

```
escenario                            operadas  bloqueadas   acierto   P/L medio
------------------------------------------------------------------------------
RNG justo, SIN puerta                   300.0         0.0    10.00%      -32.04
RNG justo, CON puerta                     2.4       297.6     8.67%       -0.55
Sesgo real 8%, SIN puerta               300.0         0.0    14.76%       95.35
Sesgo real 8%, CON puerta               218.3        81.7    17.12%      115.52
```

Sobre un generador uniforme bloquea el 99% de las entradas y la pérdida media pasa de
−32.04 a −0.55. Sobre una fuente con ventaja real **deja operar, y además mejora el
resultado** (+115.52 frente a +95.35), porque también descarta las entradas flojas dentro
del flujo sesgado.

Es un detector que responde a la evidencia. Si el mercado cambiara y apareciera una
ventaja explotable, la puerta se abriría sola.

---

## Sobre "rentable y sostenible"

Hay que separar las dos palabras, porque una es alcanzable y la otra no.

**Rentable — no es posible en estos contratos.** No por falta de técnica: por aritmética.
El valor esperado es `p × pago − 1`. Deriv fija el pago por debajo de `1/p` en todas las
combinaciones, así que el producto es menor que 1 en todas. Ninguna elección de dígito,
ventana, horario o gestión de capital mueve `p`, porque los ticks son independientes. La
martingala tampoco: cambia la *forma* de la pérdida, no su valor esperado.

La pestaña **Rigor** te deja comprobarlo tú, no creerme a mí: prueba cada dígito contra el
10% teórico y corrige por las diez comparaciones simultáneas. Sin esa corrección, mirar
diez dígitos y quedarse con el más extremo produce un "hallazgo" casi siempre — es
exactamente el mecanismo que genera el "78% de confianza" del video.

**Sostenible — esto sí es controlable, y mucho.** La pestaña *Realidad* mide cuánto dura
el capital según el contrato:

| Contrato | Pago | VE | Vida media (100 USD, stake 1) | Ruina |
|---|---|---|---|---|
| Matches / Over 8 | x8.93 | −10.71% | 933 operaciones | 99.7% |
| Par / Impar | x1.95 | −2.50% | 4 000 operaciones | 75.8% |
| Differs / Under 9 | x1.09 | −1.90% | 5 263 operaciones | 47.4% |

Elegir el contrato de menor comisión multiplica por **5,6** la duración de la sesión. Eso
es real y está medido. Pero alarga la sesión, no la vuelve positiva.

**Si el objetivo es rentabilidad sostenida, el producto equivocado es el de dígitos**, no
la configuración. Las opciones binarias de cuota fija tienen la comisión incorporada en el
pago. Instrumentos donde el resultado no está fijado de antemano (los CFD de Deriv sobre
divisas o materias primas, por ejemplo) no tienen esa garantía estructural en contra — lo
que tampoco los hace fáciles ni convierte a nadie en rentable por defecto; solo significa
que ahí el problema es de habilidad y no de aritmética cerrada.

---

## Los bots XML

Para quien prefiera `bot.deriv.com`: *Bot Builder* → icono de carpeta → **Local** →
elegir el archivo de `bots/`.

- `matches-stake-fijo.xml` — stake constante, con objetivo y límite de pérdida.
- `matches-martingala.xml` — la réplica del video, x2.2 con tope de 5 pasos.

Ambos son XML de Blockly bien formados y siguen el esquema de DBot, pero **no los he
podido importar en `bot.deriv.com` para verificarlos** (requiere sesión con cuenta).
Ábrelos primero y comprueba que los bloques aparecen completos antes de darle a *Run*.
La app web sí está probada en navegador.

Variables a ajustar dentro del bot: `stake_base`, `prediccion` (0–9), `martingala`,
`pasos_maximos`.

---

## Seguridad

- El token se queda en tu navegador. La casilla "recordar" lo guarda en `localStorage`
  **sin cifrar** — no la marques en un dispositivo compartido.
- Un token con permiso `Trade` puede operar con tu dinero. No lo compartas, y revócalo
  desde `app.deriv.com` si lo pegaste en algún sitio que no controlas.
- `app_id 1089` es el ID público de pruebas. Para uso continuo registra el tuyo en
  `api.deriv.com` — el público tiene límites de peticiones compartidos.

---

Esto es una herramienta de análisis y ejecución, no asesoría financiera. Los contratos
de dígitos tienen valor esperado negativo en todas las combinaciones que ofrece Deriv;
no existe una configuración de estos parámetros que lo vuelva positivo. Empieza en Demo.
