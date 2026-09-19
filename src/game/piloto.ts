// A extensão .js é exigida pelo Node, que roda este módulo no servidor durante
// os testes de aceitação. O Vite resolve para o arquivo .ts normalmente.
import type { RaceInput, RaceState } from './simulation.js'
import { OFF_ROAD_LIMIT } from './track.js'

/**
 * Pilotos de referência.
 *
 * Desde que a curva passou a empurrar o carro, "não tocar em nada" deixou de
 * ser uma forma válida de percorrer a pista: o carro termina na grama. Os
 * testes que tratam de outra coisa — boost, penalidade, obstáculos, chegada —
 * precisam de alguém dirigindo, senão medem uma corrida que nenhum jogador
 * faria. A alternativa seria desligar a curva nos testes, o que testaria um
 * jogo que não existe.
 *
 * São deliberadamente simples e sem ambição de ritmo: servem para descrever
 * comportamentos de jogador nos testes, não para ser rápidos. É daqui que sai
 * um adversário controlado pela máquina, se um dia houver modo treino com bot.
 */
export type Piloto = (state: RaceState) => RaceInput

/** Folga antes de corrigir, para o comando não oscilar a cada quadro. */
const ZONA_MORTA = 0.02

/**
 * Mantém o carro em uma faixa, corrigindo a força da curva como faria um
 * jogador atento. É o piloto usado quando o teste quer o carro onde o pôs.
 */
export function segurandoAFaixa(faixa = 0, boost = false): Piloto {
  return (state) => ({
    left: state.lateral > faixa + ZONA_MORTA,
    right: state.lateral < faixa - ZONA_MORTA,
    boost,
  })
}

/**
 * Corrige só quando a curva já levou o carro para perto da grama.
 *
 * É o menor esforço que ainda conta como dirigir, e por isso é ele que define
 * o piso de dificuldade: se este piloto completa a prova no tempo previsto, um
 * iniciante de celular também completa.
 */
export function noLimiteDoAsfalto(boost = false): Piloto {
  const borda = OFF_ROAD_LIMIT * 0.8
  return (state) => ({
    left: state.lateral > borda,
    right: state.lateral < -borda,
    boost,
  })
}
