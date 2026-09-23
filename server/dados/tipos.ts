import type { GravacaoDeVolta } from '../../src/game/gravador.js'
import type { Difficulty } from '../../src/game/rules.js'
import type { Desfecho, EstadoRanqueado } from '../ranqueada/rating.js'

/**
 * O que o servidor guarda entre uma partida e outra.
 *
 * As salas continuam na memória, como sempre: vivem o tempo de uma corrida e
 * morrem com ela. O que precisa sobreviver — o perfil do piloto, os tempos da
 * Pista do Dia, a ranqueada — passa por esta interface, que tem duas
 * implementações: o Postgres, em produção, e a memória, nos testes, no
 * desenvolvimento sem banco e no workshop offline. Sem `DATABASE_URL` o jogo
 * casual funciona exatamente como antes.
 */

/** Um perfil leve: apelido e um segredo que só o aparelho do piloto conhece. */
export type Perfil = {
  id: string
  apelido: string
  criadoEm: number
}

/** Como o tempo foi feito: o controle entra no quadro, para a diferença ser visível. */
export type Dispositivo = 'teclado' | 'toque' | 'desconhecido'

/**
 * Situação de um tempo do contrarrelógio.
 *
 * Pendente é o tempo bom demais para ser aceito de olhos fechados — abaixo do
 * piloto de referência, ou com volante suspeito —, que só entra no quadro
 * depois de conferido.
 */
export type EstadoDoTempo = 'valido' | 'pendente' | 'recusado'

export type NovoTempo = {
  perfilId: string
  dia: string
  seed: number
  dificuldade: Difficulty
  tempo: number
  dispositivo: Dispositivo
  estado: EstadoDoTempo
  gravacao: GravacaoDeVolta
}

export type TempoRegistrado = {
  id: string
  perfilId: string
  apelido: string
  dia: string
  seed: number
  dificuldade: Difficulty
  tempo: number
  dispositivo: Dispositivo
  estado: EstadoDoTempo
  criadoEm: number
}

/** Uma linha do quadro: o melhor tempo válido de cada piloto. */
export type LinhaDoQuadro = TempoRegistrado & { posicao: number }

export interface RepositorioDePerfis {
  criarPerfil(apelido: string, tokenHash: string): Promise<Perfil>
  /** O perfil, se o segredo bater. */
  perfilPorCredencial(id: string, tokenHash: string): Promise<Perfil | null>
  perfil(id: string): Promise<Perfil | null>
  renomearPerfil(id: string, apelido: string): Promise<void>
}

export interface RepositorioDeTempos {
  registrarTempo(novo: NovoTempo): Promise<TempoRegistrado>
  /** O melhor tempo válido de cada piloto numa semente e nível, do mais rápido. */
  quadro(seed: number, dificuldade: Difficulty, limite: number): Promise<LinhaDoQuadro[]>
  /** A linha de um piloto no quadro, ou null se ele não tem tempo válido ali. */
  linhaDe(seed: number, dificuldade: Difficulty, perfilId: string): Promise<LinhaDoQuadro | null>
  /** A volta gravada de um tempo. */
  gravacao(tempoId: string): Promise<GravacaoDeVolta | null>
}

/** Uma corrida ranqueada, com o antes e o depois de cada piloto. */
export type CorridaRanqueada = {
  id: string
  temporada: string
  sala: string
  seed: number
  instante: number
  resultados: Array<{
    perfilId: string
    posto: number
    desfecho: Desfecho
    tempo: number | null
    antes: EstadoRanqueado
    depois: EstadoRanqueado
  }>
}

/** Uma volta ranqueada guardada, para virar fantasma de quem ficou sozinho na fila. */
export type VoltaRanqueada = {
  id: string
  perfilId: string
  apelido: string
  seed: number
  dificuldade: Difficulty
  tempo: number
  /** O MMR que o piloto tinha quando correu: é ele, congelado, que entra no rating. */
  mmr: { mu: number; sigma: number }
  carro: string
  gravacao: GravacaoDeVolta
  criadaEm: number
}

/** Um troféu da Copa do Dia: pódio de uma divisão. Só cosmético. */
export type Trofeu = { perfilId: string; dia: string; divisao: number; posicao: number; participantes: number }

/** Uma linha da escada da temporada: só quem já terminou a colocação. */
export type LinhaDaEscada = { perfilId: string; apelido: string; estado: EstadoRanqueado; posicao: number }

export interface RepositorioRanqueado {
  /** O estado de um piloto numa temporada, ou null se ele ainda não correu nela. */
  estadoRanqueado(perfilId: string, temporada: string): Promise<EstadoRanqueado | null>
  /** O estado da temporada mais recente antes desta: é dele que sai o reset suave. */
  estadoAnterior(perfilId: string, temporada: string): Promise<EstadoRanqueado | null>
  /**
   * Guarda a corrida, os resultados e o estado novo de cada piloto, tudo ou
   * nada. Registrar a mesma corrida duas vezes não muda nada.
   */
  registrarCorridaRanqueada(corrida: CorridaRanqueada): Promise<void>
  /** A escada da temporada, dos PL mais altos para os mais baixos. */
  escada(temporada: string, limite: number): Promise<LinhaDaEscada[]>
  /** A posição de um piloto na escada, ou null se ele ainda está em colocação. */
  posicaoNaEscada(perfilId: string, temporada: string): Promise<number | null>
  /**
   * Quantas corridas desde um instante tiveram pelo menos `emComum` destes
   * pilotos juntos. É a conta do retorno decrescente contra quem combina
   * resultado.
   */
  corridasJuntos(perfilIds: readonly string[], desde: number, emComum: number): Promise<number>
  /** Guarda a volta de uma corrida ranqueada. */
  registrarVoltaRanqueada(volta: Omit<VoltaRanqueada, 'id' | 'apelido' | 'criadaEm'>): Promise<void>
  /**
   * As voltas mais recentes de um nível desde um instante, a mais nova de cada
   * piloto em cada semente, sem as de um piloto (o que procura fantasmas).
   */
  voltasRanqueadas(dificuldade: Difficulty, desde: number, excluirPerfil: string, limite: number): Promise<VoltaRanqueada[]>
  /** Guarda um troféu da Copa. */
  registrarTrofeu(trofeu: Trofeu): Promise<void>
  /** Os troféus de um piloto, do mais recente. */
  trofeusDe(perfilId: string): Promise<Trofeu[]>
}

export interface Repositorio extends RepositorioDePerfis, RepositorioDeTempos, RepositorioRanqueado {
  /** Onde os dados moram, para o registro da subida do servidor. */
  readonly descricao: string
  fechar(): Promise<void>
}
