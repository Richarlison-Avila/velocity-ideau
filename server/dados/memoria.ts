import { randomUUID } from 'node:crypto'
import type { GravacaoDeVolta } from '../../src/game/gravador.js'
import type { Difficulty } from '../../src/game/rules.js'
import type { EstadoRanqueado } from '../ranqueada/rating.js'
import type {
  CorridaRanqueada,
  LinhaDaEscada,
  LinhaDoQuadro,
  NovoTempo,
  Perfil,
  Repositorio,
  TempoRegistrado,
  Trofeu,
  VoltaRanqueada,
} from './tipos.js'

type PerfilGuardado = Perfil & { tokenHash: string }
type TempoGuardado = TempoRegistrado & { gravacao: GravacaoDeVolta }

/**
 * O repositório em memória: tudo some quando o servidor para.
 *
 * É o que roda sem `DATABASE_URL` — nos testes, no desenvolvimento e no
 * workshop sem internet — e é também a referência do contrato: a mesma bateria
 * de testes roda contra ele e contra o Postgres.
 */
export class RepositorioEmMemoria implements Repositorio {
  readonly descricao = 'memória (os dados somem quando o servidor para)'
  private readonly perfis = new Map<string, PerfilGuardado>()
  private readonly tempos: TempoGuardado[] = []
  /** Estado ranqueado por temporada e piloto. */
  private readonly ratings = new Map<string, { perfilId: string; temporada: string; estado: EstadoRanqueado }>()
  private readonly corridas: Array<{ id: string; instante: number; perfis: string[] }> = []
  private readonly voltas: VoltaRanqueada[] = []
  private readonly trofeus: Trofeu[] = []

  constructor(private readonly agora: () => number = Date.now) {}

  async criarPerfil(apelido: string, tokenHash: string): Promise<Perfil> {
    const perfil: PerfilGuardado = { id: randomUUID(), apelido, criadoEm: this.agora(), tokenHash }
    this.perfis.set(perfil.id, perfil)
    return publico(perfil)
  }

  async perfilPorCredencial(id: string, tokenHash: string) {
    const perfil = this.perfis.get(id)
    return perfil && perfil.tokenHash === tokenHash ? publico(perfil) : null
  }

  async perfil(id: string) {
    const perfil = this.perfis.get(id)
    return perfil ? publico(perfil) : null
  }

  async renomearPerfil(id: string, apelido: string) {
    const perfil = this.perfis.get(id)
    if (perfil) perfil.apelido = apelido
  }

  async registrarTempo(novo: NovoTempo): Promise<TempoRegistrado> {
    const apelido = this.perfis.get(novo.perfilId)?.apelido ?? 'Piloto'
    const guardado: TempoGuardado = {
      id: randomUUID(),
      perfilId: novo.perfilId,
      apelido,
      dia: novo.dia,
      seed: novo.seed,
      dificuldade: novo.dificuldade,
      tempo: novo.tempo,
      dispositivo: novo.dispositivo,
      estado: novo.estado,
      criadoEm: this.agora(),
      gravacao: novo.gravacao,
    }
    this.tempos.push(guardado)
    return semGravacao(guardado)
  }

  async quadro(seed: number, dificuldade: Difficulty, limite: number) {
    return this.melhores(seed, dificuldade).slice(0, Math.max(0, limite))
  }

  async linhaDe(seed: number, dificuldade: Difficulty, perfilId: string) {
    return this.melhores(seed, dificuldade).find((linha) => linha.perfilId === perfilId) ?? null
  }

  async gravacao(tempoId: string) {
    return this.tempos.find((tempo) => tempo.id === tempoId)?.gravacao ?? null
  }

  async estadoRanqueado(perfilId: string, temporada: string) {
    const guardado = this.ratings.get(chaveDoRating(perfilId, temporada))
    return guardado ? copiar(guardado.estado) : null
  }

  async estadoAnterior(perfilId: string, temporada: string) {
    let anterior: { temporada: string; estado: EstadoRanqueado } | null = null
    for (const guardado of this.ratings.values()) {
      if (guardado.perfilId !== perfilId || guardado.temporada >= temporada) continue
      if (!anterior || guardado.temporada > anterior.temporada) anterior = guardado
    }
    return anterior ? copiar(anterior.estado) : null
  }

  async registrarCorridaRanqueada(corrida: CorridaRanqueada) {
    if (this.corridas.some((registrada) => registrada.id === corrida.id)) return
    for (const resultado of corrida.resultados) {
      this.ratings.set(chaveDoRating(resultado.perfilId, corrida.temporada), {
        perfilId: resultado.perfilId,
        temporada: corrida.temporada,
        estado: copiar(resultado.depois),
      })
    }
    this.corridas.push({ id: corrida.id, instante: corrida.instante, perfis: corrida.resultados.map((r) => r.perfilId) })
  }

  async escada(temporada: string, limite: number): Promise<LinhaDaEscada[]> {
    return this.escadaCompleta(temporada).slice(0, Math.max(0, limite))
  }

  async posicaoNaEscada(perfilId: string, temporada: string) {
    return this.escadaCompleta(temporada).find((linha) => linha.perfilId === perfilId)?.posicao ?? null
  }

  async corridasJuntos(perfilIds: readonly string[], desde: number, emComum: number) {
    const procurados = new Set(perfilIds)
    return this.corridas.filter(
      (corrida) => corrida.instante >= desde && corrida.perfis.filter((perfil) => procurados.has(perfil)).length >= emComum,
    ).length
  }

  async registrarVoltaRanqueada(volta: Omit<VoltaRanqueada, 'id' | 'apelido' | 'criadaEm'>) {
    this.voltas.push({
      ...volta,
      id: randomUUID(),
      apelido: this.perfis.get(volta.perfilId)?.apelido ?? 'Piloto',
      criadaEm: this.agora(),
    })
  }

  async voltasRanqueadas(dificuldade: Difficulty, desde: number, excluirPerfil: string, limite: number) {
    const vistas = new Set<string>()
    const escolhidas: VoltaRanqueada[] = []
    for (const volta of [...this.voltas].sort((a, b) => b.criadaEm - a.criadaEm)) {
      if (volta.dificuldade !== dificuldade || volta.criadaEm < desde || volta.perfilId === excluirPerfil) continue
      const chave = `${volta.perfilId}|${volta.seed}`
      if (vistas.has(chave)) continue
      vistas.add(chave)
      escolhidas.push({ ...volta, apelido: this.perfis.get(volta.perfilId)?.apelido ?? volta.apelido })
      if (escolhidas.length >= limite) break
    }
    return escolhidas
  }

  async registrarTrofeu(trofeu: Trofeu) {
    this.trofeus.push({ ...trofeu })
  }

  async trofeusDe(perfilId: string) {
    return this.trofeus
      .filter((trofeu) => trofeu.perfilId === perfilId)
      .sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : a.posicao - b.posicao))
      .map((trofeu) => ({ ...trofeu }))
  }

  async fechar() {}

  /** Quem já terminou a colocação, dos PL mais altos para os mais baixos; no empate, o MMR decide. */
  private escadaCompleta(temporada: string): LinhaDaEscada[] {
    return [...this.ratings.values()]
      .filter((guardado) => guardado.temporada === temporada && guardado.estado.colocacao === 0)
      .sort((a, b) => b.estado.pl - a.estado.pl || b.estado.mmr.mu - a.estado.mmr.mu)
      .map((guardado, indice) => ({
        perfilId: guardado.perfilId,
        apelido: this.perfis.get(guardado.perfilId)?.apelido ?? 'Piloto',
        estado: copiar(guardado.estado),
        posicao: indice + 1,
      }))
  }

  /** O melhor tempo válido de cada piloto, do mais rápido, com a posição. */
  private melhores(seed: number, dificuldade: Difficulty): LinhaDoQuadro[] {
    const porPiloto = new Map<string, TempoGuardado>()
    for (const tempo of this.tempos) {
      if (tempo.seed !== seed || tempo.dificuldade !== dificuldade || tempo.estado !== 'valido') continue
      const atual = porPiloto.get(tempo.perfilId)
      if (!atual || tempo.tempo < atual.tempo || (tempo.tempo === atual.tempo && tempo.criadoEm < atual.criadoEm)) {
        porPiloto.set(tempo.perfilId, tempo)
      }
    }
    return [...porPiloto.values()]
      .sort((a, b) => a.tempo - b.tempo || a.criadoEm - b.criadoEm)
      .map((tempo, indice) => ({
        ...semGravacao(tempo),
        apelido: this.perfis.get(tempo.perfilId)?.apelido ?? tempo.apelido,
        posicao: indice + 1,
      }))
  }
}

function chaveDoRating(perfilId: string, temporada: string) {
  return `${temporada}|${perfilId}`
}

function copiar(estado: EstadoRanqueado): EstadoRanqueado {
  return { ...estado, mmr: { ...estado.mmr } }
}

function publico({ id, apelido, criadoEm }: PerfilGuardado): Perfil {
  return { id, apelido, criadoEm }
}

function semGravacao({ gravacao: _gravacao, ...tempo }: TempoGuardado): TempoRegistrado {
  return tempo
}
