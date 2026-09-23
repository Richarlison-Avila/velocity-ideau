import type { Socket } from 'socket.io-client'
import { perguntar } from './perfil'

/** Os tiers da ranqueada, do Bronze ao Mestre. */
export type Tier = 'bronze' | 'prata' | 'ouro' | 'platina' | 'diamante' | 'mestre'

/** O estado ranqueado do piloto, como o servidor o manda. */
export type PainelRanqueado = {
  temporada: string
  pl: number
  tier: Tier
  divisao: string
  colocacao: number
  corridas: number
  pico: number
  podios: number
  abandonos: number
  escudo: number
  posicao: number | null
  /** O MMR está acima dos PL: ganha mais e perde menos até alcançá-lo. */
  subindo: boolean
}

export type LinhaDaEscada = {
  posicao: number
  perfilId: string
  apelido: string
  pl: number
  divisao: string
  tier: Tier
  lenda: boolean
}

export type ResultadoRanqueado = {
  playerId: string
  perfilId: string
  apelido: string
  posto: number
  deltaPl: number
  plAntes: number
  plDepois: number
  divisao: string
  colocacao: number
  mudouDeTier: 'subiu' | 'caiu' | null
  subindo: boolean
  reduzido: boolean
  rivais: Array<{ apelido: string; chance: number; ficouAFrente: boolean | null }>
}

export type SituacaoDaRanqueada = {
  painel: PainelRanqueado
  escada: LinhaDaEscada[]
  esperaAte: number | null
  naFila: boolean
}

/**
 * Horário ranqueado: com pouca gente, é a hora marcada que junta pilotos na
 * fila — o que a Cup of the Day do Trackmania faz três vezes por dia.
 */
export const HORARIO_RANQUEADO = 'TODO DIA, DAS 20H ÀS 22H'

export async function buscarSituacao(socket: Socket): Promise<SituacaoDaRanqueada | null> {
  const resposta = await perguntar(socket, 'ranqueada:painel')
  if (!resposta.ok) return null
  return {
    painel: resposta.painel as PainelRanqueado,
    escada: (resposta.escada as LinhaDaEscada[]) ?? [],
    esperaAte: (resposta.esperaAte as number | null) ?? null,
    naFila: Boolean(resposta.naFila),
  }
}

export async function entrarNaFila(socket: Socket, piloto: { playerId: string; nome: string; carro: string }) {
  const resposta = await perguntar(socket, 'ranqueada:entrar', piloto)
  return resposta.ok ? { ok: true as const } : { ok: false as const, motivo: resposta.error ?? 'Não foi possível entrar na fila.', ate: resposta.ate as number | undefined }
}

export async function sairDaFila(socket: Socket) {
  await perguntar(socket, 'ranqueada:sair')
}

export const NOME_DO_TIER: Record<Tier, string> = {
  bronze: 'Bronze',
  prata: 'Prata',
  ouro: 'Ouro',
  platina: 'Platina',
  diamante: 'Diamante',
  mestre: 'Mestre',
}
