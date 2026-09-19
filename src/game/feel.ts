import type { RaceInput, RaceState } from './simulation.js'
import { MAX_RACE_SPEED, OFF_ROAD_LIMIT } from './track.js'

/**
 * Intensidades contínuas para a apresentação.
 *
 * A simulação decide a corrida em estados discretos — está fora da pista ou
 * não, está com boost ou não. Isso é certo para a regra, mas péssimo para o
 * olho: liga e desliga sem meio-termo. Aqui derivamos grandezas suaves entre
 * 0 e 1 para inclinação, câmera, partículas e HUD reagirem por intensidade.
 *
 * Este módulo não é uma segunda simulação: ele só lê o `RaceState` e nunca o
 * modifica, e nada que ele produz volta para a decisão da corrida.
 */

/** Velocidade máxima que o carro alcança, usada para normalizar. */
export const MAX_SPEED = MAX_RACE_SPEED

/**
 * Aceleração de referência, em km/h por segundo. A arrancada da largada passa
 * disso, então `accel` satura em 1 justamente no momento mais dramático.
 */
export const ACCEL_REFERENCE = 240

/** Constantes de tempo da suavização, em segundos. */
const TAU = {
  accel: 0.16,
  steer: 0.12,
  boost: 0.18,
  offRoad: 0.14,
  impact: 0.42,
  slipstream: 0.22,
  corner: 0.2,
}

export type FeelState = {
  /** Velocidade de 0 a 1, entre parado e o máximo do carro. */
  speed: number
  /** Aceleração de -1 a 1, suavizada. Positiva ao ganhar velocidade. */
  accel: number
  /** Esterço aparente de -1 a 1, com leve atraso em relação ao comando. */
  steer: number
  /** O quanto o boost está atuando, de 0 a 1. */
  boost: number
  /** Sobe a 1 no impacto e decai. */
  impact: number
  /** O quanto o carro está fora do asfalto, de 0 a 1. */
  offRoad: number
  /** O quanto o vácuo do rival está rendendo, de 0 a 1. */
  slipstream: number
  /** Carga lateral que a curva está impondo, de 0 a 1. */
  corner: number
  /** Velocidade do quadro anterior, para derivar a aceleração. */
  previousSpeed: number
}

export function createFeel(): FeelState {
  return {
    speed: 0,
    accel: 0,
    steer: 0,
    boost: 0,
    impact: 0,
    offRoad: 0,
    slipstream: 0,
    corner: 0,
    previousSpeed: 0,
  }
}

/**
 * Fator de aproximação independente da taxa de quadros.
 *
 * Com `dt * k` o resultado muda conforme o aparelho desenha mais ou menos
 * quadros; a exponencial dá o mesmo valor em 20 ou 144 quadros por segundo.
 */
export function approach(current: number, target: number, tau: number, dt: number) {
  if (tau <= 0) return target
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** Atualiza as intensidades a partir do estado da corrida. */
export function updateFeel(feel: FeelState, race: RaceState, input: RaceInput, dt: number) {
  const step = Math.max(0, dt)
  if (step === 0) return feel

  feel.speed = clamp(race.speed / MAX_SPEED, 0, 1)

  const bruto = (race.speed - feel.previousSpeed) / step / ACCEL_REFERENCE
  feel.previousSpeed = race.speed
  feel.accel = approach(feel.accel, clamp(bruto, -1, 1), TAU.accel, step)

  const comando = Number(input.right) - Number(input.left)
  feel.steer = approach(feel.steer, comando, TAU.steer, step)

  feel.boost = approach(feel.boost, race.boosting ? 1 : 0, TAU.boost, step)

  // Fora da pista cresce com o quanto o carro avançou para além da borda.
  const excedente = (Math.abs(race.lateral) - OFF_ROAD_LIMIT) / 0.3
  feel.offRoad = approach(feel.offRoad, clamp(excedente, 0, 1), TAU.offRoad, step)

  // Vácuo e carga de curva já saem contínuos da simulação; a suavização aqui
  // serve para o HUD e os efeitos não tremerem quando o valor oscila de um
  // quadro para o outro.
  feel.slipstream = approach(feel.slipstream, clamp(race.slipstream, 0, 1), TAU.slipstream, step)
  feel.corner = approach(feel.corner, clamp(race.cornerLoad, 0, 1), TAU.corner, step)

  feel.impact = approach(feel.impact, 0, TAU.impact, step)
  return feel
}

/** Marca um impacto: a intensidade vai a 1 e decai sozinha. */
export function registerImpact(feel: FeelState) {
  feel.impact = 1
  return feel
}
