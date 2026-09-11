# La matemática de los contratos de dígitos

Documento de referencia para entender qué calcula la app y por qué.

---

## 1. Cómo se forma el último dígito

Deriv define el último dígito sobre el precio formateado a `pip_size` decimales.
Para `Volatility 75 (1s)` con `pip_size = 2`:

```
78000.06  ->  dígito 6
78000.00  ->  dígito 0
```

La app usa exactamente esa regla (`DigitStats.lastDigit`), tomando `pip_size` del
propio stream de ticks. Calcularlo de otra forma —por ejemplo sobre el precio sin
formatear— produce dígitos distintos y estadísticas que no corresponden a nada.

Los índices de volatilidad se generan con un RNG auditado y ticks independientes.
Bajo ese modelo, cada dígito es uniforme sobre 0–9, y:

> **P(próximo dígito = d) = 0.10 para todo d, sin importar el historial.**

---

## 2. Probabilidades y pago justo

| Contrato | Gana si | Probabilidad | Pago justo |
|---|---|---|---|
| `DIGITMATCH` b | dígito = b | 0.10 | x10.00 |
| `DIGITDIFF` b | dígito ≠ b | 0.90 | x1.11 |
| `DIGITOVER` b | dígito > b | (9−b)/10 | x10/(9−b) |
| `DIGITUNDER` b | dígito < b | b/10 | x10/b |
| `DIGITEVEN` | dígito par | 0.50 | x2.00 |
| `DIGITODD` | dígito impar | 0.50 | x2.00 |

El **pago justo** es `1 / probabilidad`: el multiplicador que haría el juego neutro.

---

## 3. Valor esperado

Con `m` = multiplicador de pago y `p` = probabilidad de ganar:

```
VE = p · m − 1        (en fracción del stake)
```

Con el dato real del video (`stake 100.00 → payout 892.86`, es decir `m = 8.9286`):

```
VE = 0.10 × 8.9286 − 1 = −0.1071   →   −10.71% por operación
```

Con 1 USD por operación eso son **−0.107 USD de media cada vez**. No se nota en
10 operaciones; en 1.000 son −107 USD.

La **ventaja de la casa** es `1 − m / pago_justo = 1 − 8.9286/10 = 10.71%`.

Lo importante: **ninguna elección de dígito, ventana de análisis o momento de entrada
cambia `p`.** Solo `m` varía entre contratos, y siempre por debajo del pago justo.
Por eso la pestaña *Pagos* de la app es útil (te dice qué contrato cobra menos
comisión) y la pestaña de predicción no puede serlo (no puede mover `p`).

---

## 4. Por qué "78% de confianza" no significa nada

En el video, con **32 ticks** analizados, la app muestra dígitos al 15.6% y 6.3%,
y una confianza del 78%.

Con 32 observaciones, un dígito visto 5 veces da 15.6%. El **intervalo de Wilson al
95%** de esa proporción es aproximadamente **[6.9%, 31.8%]**. Contiene al 10% teórico
con holgura. Dicho de otro modo: esos datos son perfectamente compatibles con un
generador uniforme, y también con casi cualquier otra cosa. No distinguen nada.

La app calcula ese intervalo y lo muestra junto a cada predicción.

### La prueba de uniformidad

Para decidir si una ventana *realmente* se desvía, la app usa un test **chi-cuadrado**
con 9 grados de libertad:

```
χ² = Σ (observado − esperado)² / esperado,    esperado = total/10
```

y reporta el valor *p*. Interpretación:

- **p > 0.05** — la distribución es compatible con un generador uniforme.
- **p < 0.05** — esta muestra se desvía más de lo habitual.

Con la advertencia que la app también muestra: si miras ventanas continuamente,
**1 de cada 20 dará p < 0.05 por puro azar.** Encontrar una no es encontrar una señal.

---

## 5. Martingala

Tras `k` pérdidas seguidas, el stake es `base · f^k`. El capital acumulado para
cubrir `n` pasos es una serie geométrica:

```
capital(n) = base · (f^n − 1) / (f − 1)
```

Con `base = 1` y `f = 2.2` (el valor del video):

| pasos | capital necesario | espera media hasta esa racha | P(ocurra en 200 ops) |
|---|---|---|---|
| 5 | 42.11 USD | 7 operaciones | 100% |
| 6 | 93.65 USD | 9 operaciones | 100% |
| 7 | 207.03 USD | 11 operaciones | 100% |
| 8 | 456.47 USD | 13 operaciones | 100% |
| 10 | 2 212.49 USD | 19 operaciones | 100% |
| 12 | 10 711.67 USD | 25 operaciones | 100% |

(con `q = 0.9`, la probabilidad de perder cada operación de `Matches`)

La probabilidad de encadenar `n` pérdidas al menos una vez en `M` operaciones se
calcula con la recursión clásica de rachas, implementada en `Risk.probOfLosingRun`:

```
A(m) = A(m−1) − p · q^n · A(m−n−1)
P(racha) = 1 − A(M)
```

La espera media hasta una racha de `n` es `(1 − q^n) / (p · q^n)`.

**El punto:** la martingala no cambia el valor esperado —sigue siendo −10.71% por
operación— sino su *distribución*. Convierte "pierdo un poco muchas veces" en
"gano un poco muchas veces y lo pierdo todo de golpe". El P/L medio no mejora; la
varianza se dispara.

---

## 6. Qué queda entonces

Sobre estos contratos, ninguna combinación de parámetros tiene valor esperado
positivo — la casa cobra su comisión en cada operación y la probabilidad no se
puede mover. Lo que sí se puede elegir con criterio:

1. **Qué contrato cobra menos comisión.** `Differs` y los `Over/Under` de alta
   probabilidad rondan el −2%; `Matches` el −10.7%. Cinco veces menos sangría por
   operación. La pestaña *Pagos* lo mide en vivo.
2. **Cuánto exponer.** Stake fijo pierde despacio y de forma predecible; la
   martingala concentra el riesgo.
3. **Cuándo parar.** Objetivo de ganancia y límite de pérdida convierten una sesión
   abierta en una apuesta acotada.
4. **Medir antes de arriesgar.** El modo simulación usa ticks reales y pagos reales
   sin dinero. Cualquier estrategia que no supere a la línea base aleatoria en
   simulación tampoco lo hará en real.

Y una lectura útil del punto 1: si el objetivo es "x7 o x10", el escáner te dirá que
ese multiplicador solo existe en los contratos de ~10% de acierto, que son
precisamente los de mayor comisión. El multiplicador alto y la comisión alta son
la misma cosa vista desde dos lados.

---

## 7. La regla de decisión

Las secciones anteriores dicen por qué no hay ventaja. Esta dice **cómo se comprueba
antes de cada entrada**, que es lo que ejecuta la puerta de la app.

### Punto de equilibrio

Un contrato que paga `m` veces el stake necesita una tasa de acierto de al menos:

```
p* = 1 / m
```

Por debajo de `p*` la operación pierde dinero en promedio, por muy alto que sea el pago.
Con `m = 8.9286`, `p* = 11.20%`. El generador entrega `10.00%`. Faltan **1.20 puntos
porcentuales**, y esa es toda la historia.

### Posterior bayesiana

Con `w` aciertos en `n` intentos y un prior Beta(α₀, β₀):

```
posterior = Beta(α₀ + w, β₀ + n − w)
```

La app usa el **prior de Jeffreys, Beta(0.5, 0.5)**. Es deliberado: un prior débil deja
que manden los datos. Si alguien sospecha que el resultado viene impuesto por la
suposición previa, con n ≥ 500 el prior es irrelevante — puede comprobarlo cambiándolo.

La cifra que muestra la app es la masa de esa posterior por encima del equilibrio:

```
P(p > p* | datos) = 1 − CDF_Beta(p* ; α₀+w, β₀+n−w)
```

Se calcula con la función beta incompleta regularizada `I_x(a,b)`.

### La puerta

```
ENTRAR  ⟺  P(p > p* | datos) ≥ umbral   Y   n ≥ muestra mínima
```

Por defecto: umbral 95%, muestra mínima 500 ticks.

Las dos condiciones hacen falta. Sin la segunda, una racha corta dispara la puerta: con
12 aciertos en 100 intentos la tasa medida es 12% —por encima del 11.20% de equilibrio—
pero la certeza es solo del 61%, y el intervalo creíble al 95% va de 6.7% a 19.4%. Esos
datos no distinguen una ventaja de una racha.

### Por qué hay que corregir por comparaciones múltiples

El panel del video mira diez dígitos y anuncia el más extremo. Eso no es una prueba: es
diez pruebas, y quedarse con la mejor.

Con datos perfectamente uniformes, la probabilidad de que **algún** dígito dé p < 0.05 por
azar es:

```
1 − (1 − 0.05)^10 ≈ 40%
```

Cuatro de cada diez ventanas producirán un "hallazgo" que no existe. La pestaña *Rigor*
aplica **Holm-Bonferroni** y muestra las dos columnas, cruda y corregida, para que se vea
la diferencia. En una corrida real de 643 ticks: el dígito 1 apareció al 7.15% con
p crudo = 0.0149 —aparentemente significativo— y p corregido = 0.1485. No lo era.

### Calibración

Una probabilidad anunciada solo vale si se cumple. La app registra cada predicción con su
probabilidad declarada y el resultado real, los agrupa en bandas y compara:

```
error de calibración = frecuencia real observada − probabilidad anunciada
```

Una herramienta honesta cae sobre la diagonal. La del video anunciaba 78% sobre eventos
que ocurren el 10% de las veces: un error de 68 puntos porcentuales.

---

## 8. Kelly y el tamaño óptimo

Para una apuesta con probabilidad `p` y pago `m` (ganancia neta `b = m − 1`):

```
f* = (p·b − (1 − p)) / b
```

`f*` es la fracción del capital que maximiza el crecimiento a largo plazo.

Para Matches con `p = 0.10` y `m = 8.9286`:

```
f* = (0.10 × 7.9286 − 0.90) / 7.9286 = −0.0135
```

**Negativa.** El criterio de Kelly, que es la respuesta matemática a "cuánto apostar",
dice aquí: nada. Una fracción negativa significaría tomar el otro lado de la apuesta, que
es justo lo que hace la casa.

Todos los contratos de dígitos dan Kelly negativo. Esa es la misma conclusión de la
sección 3 expresada como decisión de tamaño en lugar de como valor esperado.
