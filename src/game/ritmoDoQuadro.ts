/**
 * Ritmo e resolução do quadro, ajustados só no aparelho que não fecha o quadro.
 *
 * O custo de desenhar cresce com o quadrado da densidade do canvas, e ela é a
 * mesma para todo aparelho: um Android fraco desenha tantos pixels quanto um
 * celular topo de linha, mesmo sem chegar a 30 quadros por segundo. E a tela
 * de 120 Hz faz o laço tentar 120 quadros, que o aparelho intermediário não
 * sustenta: o ritmo sai irregular, e o celular esquenta ao longo da tarde.
 *
 * Aqui a medição decide, e só para baixo:
 * - a tela rápida que não acompanha passa a desenhar um quadro sim, outro não;
 * - abaixo de 50 quadros por segundo, a densidade desce um degrau;
 * - se a descida não encurtou o quadro, o aparelho não é limitado pelos
 *   pixels: a densidade volta e fica.
 *
 * O aparelho que já fecha o quadro não muda um pixel. Nada sobe no meio da
 * prova: subir e descer de novo seria pior que ficar.
 */

/** Densidades do canvas, da mais nítida para a mais leve. Nunca abaixo de 1. */
export const DEGRAUS_DE_DENSIDADE: readonly number[] = [2, 1.75, 1.5, 1.25, 1]

/** Intervalos acima disso são engasgo ou aba parada, não o ritmo do aparelho. */
const ENGASGO_MS = 100
/** Depois de começar ou de qualquer troca, o tempo de o quadro assentar. */
const CARENCIA_MS = 2_000
/** Quanto tempo de quadros entra em cada média. */
const JANELA_MS = 1_500
/** Abaixo de 50 quadros por segundo, a densidade desce um degrau. */
const QUADRO_LENTO_MS = 20
/** A descida precisa encurtar o quadro em pelo menos isso, senão volta e trava. */
const MELHORA_MINIMA = 0.08
/**
 * Período máximo da tela rápida: 110 Hz ou mais. Nela, 60 quadros por segundo
 * é um quadro sim, outro não; numa de 90 Hz, não seria ritmo constante.
 */
const TELA_RAPIDA_MS = 1000 / 110
/** A tela rápida não acompanha quando o quadro passa disso vezes o período dela. */
const FOLGA_DA_TELA = 1.15

export type Decisao = 'nada' | 'densidade' | 'limitar'

export class RitmoDoQuadro {
  /** A densidade do canvas agora. */
  densidade: number
  private readonly degraus: readonly number[]
  private degrau = 0
  /** A densidade voltou depois de uma descida que não rendeu: não mexe mais. */
  private travado = false
  private limitado = false
  private carenciaAte: number | null = null
  private soma = 0
  private quadros = 0
  /** O menor intervalo visto, que é o período da tela. */
  private periodoDaTela = Infinity
  /** Média antes da última descida, para saber se ela rendeu. */
  private mediaAntesDaDescida: number | null = null

  /** `densidadeDoAparelho` é a densidade que o canvas usaria sem ajuste. */
  constructor(densidadeDoAparelho: number) {
    this.densidade = densidadeDoAparelho
    this.degraus = [
      densidadeDoAparelho,
      ...DEGRAUS_DE_DENSIDADE.filter((degrau) => degrau < densidadeDoAparelho - 1e-9),
    ]
  }

  /**
   * Com a tela rápida limitada, diz se este quadro fica sem desenho. O limite
   * é meio período abaixo dos 16,7 ms, para o quadro que chega na hora certa
   * não ser pulado por um arredondamento.
   */
  pular(desdeODesenho: number) {
    return this.limitado && desdeODesenho < 1000 / 60 - this.periodoDaTela / 2
  }

  /** Registra o intervalo desde o último quadro desenhado e decide. */
  registrar(intervalo: number, agora: number): Decisao {
    if (this.carenciaAte === null) this.carenciaAte = agora + CARENCIA_MS
    if (!(intervalo > 0) || intervalo > ENGASGO_MS || agora < this.carenciaAte) return 'nada'
    if (!this.limitado) this.periodoDaTela = Math.min(this.periodoDaTela, intervalo)
    this.soma += intervalo
    this.quadros += 1
    if (this.soma < JANELA_MS) return 'nada'
    const media = this.soma / this.quadros
    this.soma = 0
    this.quadros = 0
    return this.decidir(media, agora)
  }

  private decidir(media: number, agora: number): Decisao {
    if (this.mediaAntesDaDescida !== null) {
      const rendeu = media <= this.mediaAntesDaDescida * (1 - MELHORA_MINIMA)
      this.mediaAntesDaDescida = null
      if (!rendeu) {
        // Limitado pelo processador, ou preso em 30 Hz pela economia de
        // bateria: menos pixels não ajudam, e a nitidez volta.
        this.degrau -= 1
        this.travado = true
        return this.trocar('densidade', agora)
      }
    }
    if (!this.limitado && this.periodoDaTela <= TELA_RAPIDA_MS && media > this.periodoDaTela * FOLGA_DA_TELA) {
      this.limitado = true
      return this.trocar('limitar', agora)
    }
    if (!this.travado && media > QUADRO_LENTO_MS && this.degrau < this.degraus.length - 1) {
      this.mediaAntesDaDescida = media
      this.degrau += 1
      return this.trocar('densidade', agora)
    }
    return 'nada'
  }

  private trocar(decisao: Decisao, agora: number): Decisao {
    this.densidade = this.degraus[this.degrau]
    this.carenciaAte = agora + CARENCIA_MS
    this.soma = 0
    this.quadros = 0
    return decisao
  }
}
