# Operar en bot.deriv.com — sin token, sin App ID

`bot.deriv.com` es el bot oficial de Deriv. Entras con tu cuenta de siempre: no hace
falta token, ni registrar aplicaciones, ni copiar identificadores. Ejecuta solo.

Esta guía replica la configuración del video de referencia.

---

## 1. Entrar

Abre **bot.deriv.com**. Si ya tienes sesión en Deriv, entra directo.

Arriba a la izquierda aparece tu cuenta. **Cambia a la cuenta Demo** antes de nada:
pulsa el selector de cuenta y elige la virtual. Verás el saldo cambiar a 10.000 USD.

---

## 2. La vía rápida: Quick Strategy

Es un formulario. No hay que construir ni importar nada.

Pulsa el botón rojo **Quick strategy**. Te ofrecerá varias estrategias:

| Estrategia | Qué hace |
|---|---|
| **Martingale** | Multiplica el stake tras cada pérdida. Es la del video |
| **D'Alembert** | Suma una unidad tras perder, resta una tras ganar. Más suave |
| **Oscar's Grind** | Sube solo tras ganar. La más conservadora |

Elige la que quieras y rellena:

| Campo | Valor sugerido |
|---|---|
| **Market** | Derived → Continuous Indices → **Volatility 75 (1s) Index** |
| **Trade type** | Digits → **Matches/Differs** |
| **Contract type** | **Matches** |
| **Initial stake** | `1` |
| **Duration** | `1` tick |
| **Profit threshold** | `10` — para al ganar esa cantidad |
| **Loss threshold** | `20` — para al perderla |
| **Martingale factor** | `2` (si elegiste Martingale) |

Pulsa **Run** y el bot empieza.

> El dígito de predicción: en Quick Strategy puede que no haya campo para elegirlo.
> Si lo necesitas, usa la vía de abajo con el Bot Builder.

---

## 3. La vía completa: importar un bot

En el repo hay tres bots listos:

- **`bots/differs-3-perdidas.xml`** — Differs con parada automatica a las 3 perdidas
  seguidas. Es el que cumple el requisito de no encadenar mas de tres fallos.


- **`bots/matches-stake-fijo.xml`** — Matches con stake constante de 1 USD.
  Pago alto, pero encadena tres perdidas cada cuatro operaciones.
- **`bots/matches-martingala.xml`** — la réplica exacta del video, martingala x2.2 con
  tope de 5 pasos.

### Descargarlos

Entra en el repositorio, abre la carpeta `bots`, pulsa el archivo, y luego el botón
**Download raw file**. Guárdalo en tu dispositivo.

### Importarlos

En bot.deriv.com, pulsa el **icono de carpeta** de la barra lateral izquierda →
**Local** → elige el archivo descargado.

Los bloques aparecerán en el lienzo.

### Ajustar las variables

En el bloque azul **Variables at start** puedes cambiar:

| Variable | Qué es |
|---|---|
| `stake` / `stake_base` | Cuánto pones por operación |
| `prediccion` | El dígito al que apuestas, de 0 a 9 |
| `objetivo_ganancia` | A cuánto ganado se detiene |
| `limite_perdida` | A cuánto perdido se detiene |
| `martingala` | Por cuánto multiplica tras perder |
| `pasos_maximos` | Cuántas veces multiplica antes de reiniciar |

Para cambiar un valor, pulsa sobre el número y escribe el nuevo.

Luego **Run**.

---

## 4. Mirar los resultados

Abajo hay tres pestañas:

- **Summary** — resumen de la sesión
- **Transactions** — cada operación con su entrada, salida y resultado
- **Journal** — el registro de lo que va haciendo

Ahí es donde en el video se veía `Total stake 100.00 USD / Total payout 892.86 USD`.

---

## 5. Usar las dos herramientas a la vez

El bot de Deriv ejecuta, pero no analiza. Puedes tener el analizador abierto en otra
pestaña para estudiar el comportamiento de los dígitos, el escáner de pagos y las
calculadoras de riesgo, mientras el bot opera.

---

## Antes de pasar a la cuenta real

- Déjalo correr en **Demo** varias sesiones y mira los resultados en *Transactions*.
- Recuerda lo que dice `docs/matematica.md`: cada operación de `Matches` con pago x8.93
  tiene un valor esperado de **−10.71%** del stake. El bot ejecuta bien; lo que no puede
  hacer es cambiar esa cifra.
- El `Loss threshold` es el único control que de verdad te protege. Ponlo siempre.


---

## Cuantas perdidas seguidas esperar segun el contrato

La probabilidad de encadenar tres fallos depende solo del contrato elegido, no de
cuanto se analice antes de entrar, porque cada tick es independiente del anterior.

| Contrato | Gana | P(3 seguidas) | Ocurre cada | Pago |
|---|---|---|---|---|
| Matches | 10% | **72.90%** | 4 operaciones | x8.93 |
| Over 7 | 20% | 51.20% | 5 operaciones | x4.46 |
| Par / Impar | 50% | 12.50% | 14 operaciones | x1.95 |
| **Differs** | 90% | **0.10%** | **1 110 operaciones** | x1.09 |

Con Differs, a unos dos segundos por operacion, una racha de tres aparece cada
**37 minutos** de funcionamiento continuo. Con Matches, cada siete segundos.

El precio de esa estabilidad es el pago: cada acierto suma 0.09 y cada fallo resta
1.00, asi que hacen falta doce aciertos para cubrir un fallo. El valor esperado pasa
de -10.7% por operacion a **-1.9%**. Pierde cinco veces mas despacio; no gana.
