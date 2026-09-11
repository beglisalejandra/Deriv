# Checklist de uso

El orden importa. Cada fase existe para responder una pregunta concreta antes de
pasar a la siguiente.

---

## Fase 0 — Reconocimiento (10 minutos, sin cuenta)

- [ ] Abrir la app y pulsar **«Explorar sin cuenta»**.
- [ ] Recorrer las cinco pestañas. Entender qué mide cada número antes de que haya
      dinero de por medio.
- [ ] En **Rigor**, mirar la columna `p crudo` frente a `p corregido`. Esperar a ver
      un dígito con p crudo < 0.05 y p corregido > 0.05. Aparece cada pocos minutos.
      Ese es el mecanismo entero detrás de los paneles que anuncian "78% de confianza".
- [ ] Correr el backtest: `node docs/backtest.js`.

**Pregunta que responde:** ¿entiendo qué hace la herramienta y por qué?

---

## Fase 1 — Verificar la conexión real (5 minutos, cuenta Demo)

Esta fase existe porque la app se probó completa en navegador contra una API
simulada, pero el apretón de manos con los servidores de Deriv no se pudo probar
sin una cuenta. Aquí se confirma en cinco minutos.

- [ ] Crear token en `app.deriv.com` → Configuración → **Ficha API** → *Crear token*,
      marcando **solo «Operaciones»**, sobre una cuenta **Demo**. No marques «Gestión de
      cuentas» ni «Perspectivas de aplicación»: la herramienta no las necesita, y un token
      con ellas hace mucho más daño si se filtra.
- [ ] Conectar. Comprobar que el distintivo de arriba a la derecha dice
      **`DEMO · VRTC…`** en azul. Si dice `REAL` en rojo, desconectar y revisar
      qué cuenta se usó.
- [ ] Confirmar que el precio cambia y el círculo del último dígito va rotando.
- [ ] Pestaña **Pagos** → *Escanear pagos*. Si devuelve una tabla con multiplicadores,
      la ruta de cotización funciona.
- [ ] Pestaña **Bot** → modo **Real**, `Operaciones máximas = 1`, stake 1 → *Ejecutar*.

> El último punto es el importante: con un token **Demo**, el modo «Real» envía
> órdenes de verdad contra dinero virtual. Valida la ruta completa —cotizar,
> comprar, esperar liquidación, registrar resultado— sin arriesgar nada.

- [ ] Comprobar en **Resultados** que la operación aparece con su dígito y su P/L.

**Pregunta que responde:** ¿la herramienta habla de verdad con Deriv?

**Si algo falla aquí:** lo más probable es el `App ID`. El 1089 es público y
compartido, con límites de peticiones comunes. Registra el tuyo en `api.deriv.com`
(gratis) y ponlo en el campo App ID. El segundo sospechoso es el token sin el permiso
«Operaciones».

---

## Fase 2 — Medir antes de arriesgar (días, no minutos)

Esta es la fase que casi nadie hace, y la única que produce una respuesta.

- [ ] Modo **Simulación**, puerta **desactivada**, tu estrategia preferida.
      Dejar correr hasta **300 operaciones como mínimo**. Exportar CSV.
- [ ] Repetir con la estrategia **«Matches al azar (control)»**, mismo número de
      operaciones. Exportar CSV.
- [ ] Comparar el ROI de ambas.
- [ ] Pestaña **Rigor** → tabla de calibración. Con 300 operaciones ya dice algo.

**Pregunta que responde:** ¿mi estrategia le gana a elegir al azar?

Con 300 operaciones a 10% de acierto, la **diferencia** entre dos estrategias tiene un
margen de error de ±4.8 puntos porcentuales al 95% de confianza
(`1.96 × √2 × √(0.1×0.9/300)`). Si la diferencia que ves es menor que eso, no has
medido nada todavía: sigue acumulando.

Para distinguir una ventaja pequeña —de 1 o 2 puntos, que es el tamaño que importa,
porque el equilibrio está a solo 1.2 puntos del 10%— hacen falta **miles** de
operaciones, no cientos. En concreto: distinguir un 11.2% real de un 10.0% con 80%
de potencia exige unas **5 050 operaciones**. La pestaña Rigor te dice el sesgo
mínimo detectable con la muestra que llevas acumulada en cada momento.

---

## Fase 3 — El punto de decisión

Mirar los dos CSV y responder honestamente:

- **¿Tu estrategia perdió contra el azar, o empató?**
  Ese es el resultado esperado y la respuesta a la pregunta original. Parar aquí.

- **¿Tu estrategia ganó al azar?**
  Antes de celebrar: mirar si la **puerta llegó a abrirse alguna vez** durante la
  sesión. Si nunca se abrió, la ventaja que ves es varianza, porque la puerta exige
  95% de certeza sobre la muestra completa. Seguir midiendo.

- **¿La puerta se abrió de verdad y se mantuvo abierta?**
  Entonces hay algo que merece atención. Documentarlo, repetirlo en otra franja
  horaria y en otro índice antes de darlo por bueno.

---

## Fase 4 — Si vas a operar con dinero real

- [ ] Contrato de **baja comisión**: `Differs`, `Under 9` u `Over 0` (≈1.9%) en
      lugar de `Matches` (10.7%). El capital dura 5.6 veces más.
- [ ] Stake **fijo** de 1 USD. Gestión = *Fija*, no martingala.
- [ ] **Puerta activada.**
- [ ] Stop-loss decidido antes de empezar, y en el campo.
- [ ] Objetivo de ganancia también puesto: sin él la sesión no termina nunca.

### Comprobación antes de cada sesión

- [ ] El distintivo dice lo que espero (`DEMO` azul / `REAL` rojo).
- [ ] Stake base = 1.
- [ ] Pérdida máxima puesta.
- [ ] «Operar solo cuando la puerta diga ENTRAR» marcada.
- [ ] Gestión de capital = *Fija*.

### Cuándo parar, sin excepciones

- [ ] Se alcanzó el stop-loss. No se sube y se reintenta.
- [ ] Se alcanzó el objetivo. Se retira y se cierra.
- [ ] Aparecen ganas de subir el stake para recuperar. Es la señal más fiable de
      todas y siempre significa lo mismo.

---

## Lo que el checklist no puede darte

Ninguna de estas casillas vuelve positivo el valor esperado. Con pago x8.93 sobre un
evento de 1 entre 10, cada operación vale −10.71% del stake, y eso no depende de la
configuración sino del producto. El checklist sirve para dos cosas reales: **medir
sin engañarte** y **perder despacio si decides jugar igual**.

Si en la Fase 3 el resultado es el esperado, la conclusión útil no es "ajustar los
parámetros" — es que la pregunta estaba mal planteada y el sitio donde buscar
rentabilidad es otro producto.
