/** Número de luzes da largada, conforme o plano. */
export const LIGHT_COUNT = 5

/** Duração padrão usada no modo treino; nas salas o servidor envia o valor oficial. */
export const DEFAULT_COUNTDOWN_MS = 5_400

export type CountdownPhase = 'prepare' | 'lights' | 'go'

export type CountdownState = {
  /** Quantas luzes vermelhas já estão acesas (0 a 5). */
  lights: number
  phase: CountdownPhase
  /** Milissegundos restantes até a largada; negativo indica largada já ocorrida. */
  remaining: number
}

/**
 * Traduz o instante oficial da largada em luzes.
 *
 * As luzes acendem uma a uma e todas se apagam exatamente em `startAt`,
 * que é o momento em que os dois carros podem andar. Como o cálculo depende
 * apenas de `startAt` e do relógio sincronizado, os dois dispositivos mostram
 * a mesma sequência mesmo recebendo o agendamento em momentos diferentes.
 */
export function countdownAt(now: number, startAt: number, countdownMs = DEFAULT_COUNTDOWN_MS): CountdownState {
  const remaining = startAt - now
  if (remaining <= 0) return { lights: 0, phase: 'go', remaining }

  const interval = countdownMs / (LIGHT_COUNT + 1)
  const lights = Math.max(0, Math.min(LIGHT_COUNT, LIGHT_COUNT + 1 - Math.ceil(remaining / interval)))
  return { lights, phase: lights === 0 ? 'prepare' : 'lights', remaining }
}

/**
 * Atraso, em segundos, com que este dispositivo entrou na corrida.
 * Serve para avisar o piloto quando a largada já aconteceu antes de a tela abrir.
 */
export function lateBy(now: number, startAt: number) {
  return Math.max(0, (now - startAt) / 1000)
}
