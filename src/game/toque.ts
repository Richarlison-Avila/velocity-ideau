import type { RaceInput } from './simulation'

export type Comando = keyof RaceInput

const COMANDOS: readonly Comando[] = ['left', 'right', 'boost']

/**
 * Os comandos da corrida, de todas as origens: o teclado e cada dedo na tela.
 *
 * A física lê os comandos uma vez por quadro. Um toque curto — o pulso de
 * volante que segura a linha numa curva — pode começar e acabar entre dois
 * quadros, num engasgo, e aí não existiria para ela. Por isso todo comando
 * que liga fica pendente até o quadro seguinte consumi-lo: vale por pelo
 * menos um quadro.
 *
 * O estado é por dedo, e não por botão: dois dedos no mesmo botão não se
 * anulam quando um deles sai, e o dedo que desliza de um lado para o outro
 * leva o comando junto.
 */
export class Comandos {
  private readonly teclas: RaceInput = { left: false, right: false, boost: false }
  private readonly dedos = new Map<number, Comando>()
  private readonly pendentes: RaceInput = { left: false, right: false, boost: false }
  /** A entrada entregue à física, reaproveitada a cada quadro. */
  private readonly doQuadro: RaceInput = { left: false, right: false, boost: false }

  tecla(comando: Comando, ativa: boolean) {
    if (ativa && !this.teclas[comando]) this.pendentes[comando] = true
    this.teclas[comando] = ativa
  }

  dedoDesceu(dedo: number, comando: Comando) {
    this.dedos.set(dedo, comando)
    this.pendentes[comando] = true
  }

  /** O dedo deslizou para outro botão sem levantar. */
  dedoMudou(dedo: number, comando: Comando) {
    const antes = this.dedos.get(dedo)
    if (antes === undefined || antes === comando) return
    this.dedos.set(dedo, comando)
    this.pendentes[comando] = true
  }

  /** Devolve o comando que o dedo segurava, se segurava algum. */
  dedoSubiu(dedo: number): Comando | undefined {
    const comando = this.dedos.get(dedo)
    this.dedos.delete(dedo)
    return comando
  }

  comandoDoDedo(dedo: number): Comando | undefined {
    return this.dedos.get(dedo)
  }

  /** Algum dedo segura este comando agora. */
  dedoEm(comando: Comando) {
    for (const segurado of this.dedos.values()) if (segurado === comando) return true
    return false
  }

  segurando(comando: Comando) {
    return this.teclas[comando] || this.dedoEm(comando)
  }

  /**
   * A entrada do quadro: o que está segurado agora, mais os toques que
   * acabaram antes de a física vê-los. Esvazia os pendentes, então precisa
   * ser chamada em todo quadro — inclusive na contagem, para um toque dado
   * antes do VAI! não vazar para a largada.
   */
  consumir(): RaceInput {
    for (const comando of COMANDOS) {
      this.doQuadro[comando] = this.segurando(comando) || this.pendentes[comando]
      this.pendentes[comando] = false
    }
    return this.doQuadro
  }

  /** Solta tudo: a página perdeu o foco ou foi para o segundo plano. */
  soltarTudo() {
    this.dedos.clear()
    for (const comando of COMANDOS) {
      this.teclas[comando] = false
      this.pendentes[comando] = false
    }
  }
}

/**
 * Para que lado vai o dedo que desliza entre ‹ e ›, sem levantar.
 *
 * O dedo só troca de lado quando entra no outro botão: o vão entre os dois é
 * uma faixa neutra. Sem ela, um polegar apoiado na borda de dentro trocaria
 * de lado a cada tremida — e cada troca conta como agitação do volante, que
 * derruba a aderência.
 */
export function ladoDoDedo(
  x: number,
  atual: 'left' | 'right',
  fimDaEsquerda: number,
  inicioDaDireita: number,
): 'left' | 'right' {
  if (atual === 'left' && x >= inicioDaDireita) return 'right'
  if (atual === 'right' && x <= fimDaEsquerda) return 'left'
  return atual
}
