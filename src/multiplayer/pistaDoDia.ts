import type { Socket } from 'socket.io-client'
import type { Medalha } from '../game/contrarrelogio'
import type { GravacaoDeVolta } from '../game/gravador'
import type { Difficulty } from '../game/rules'
import { perguntar } from './perfil'

/** Uma linha do quadro da Pista do Dia, como o servidor a manda. */
export type LinhaDoQuadro = {
  id: string
  perfilId: string
  apelido: string
  tempo: number
  dispositivo: 'teclado' | 'toque' | 'desconhecido'
  posicao: number
}

export type QuadroDoDia = {
  dia: string
  seed: number
  dificuldade: Difficulty
  limites: Record<Medalha, number>
  linhas: LinhaDoQuadro[]
  voce: LinhaDoQuadro | null
}

/** O que o servidor disse da volta: aceita, esperando conferência ou recusada. */
export type VereditoDaVolta = {
  estado: 'valido' | 'pendente' | 'recusado'
  motivo?: string
  linha: LinhaDoQuadro | null
  /** A volta valeu na classificação da Copa do Dia: a posição do piloto nela. */
  copa?: { posicao: number }
}

export async function buscarQuadro(socket: Socket): Promise<QuadroDoDia | null> {
  const resposta = await perguntar(socket, 'tt:quadro')
  return resposta.ok ? (resposta.quadro as QuadroDoDia) : null
}

/**
 * Abre uma tentativa no servidor, que passa a contar o tempo dela. Sem
 * resposta rápida, a tentativa segue só no aparelho: o recorde pessoal vale,
 * o quadro não.
 */
export async function abrirTentativa(socket: Socket, desafio?: string): Promise<{ tentativa: string; seed: number } | null> {
  if (!socket.connected) return null
  const resposta = await perguntar(socket, 'tt:iniciar', desafio ? { desafio } : undefined, 1_500)
  if (!resposta.ok || typeof resposta.tentativa !== 'string' || typeof resposta.seed !== 'number') return null
  return { tentativa: resposta.tentativa, seed: resposta.seed }
}

export async function enviarVolta(
  socket: Socket,
  volta: { tentativa: string; tempo: number; gravacao: GravacaoDeVolta; dispositivo: string; entradas?: unknown },
): Promise<VereditoDaVolta | null> {
  const resposta = await perguntar(socket, 'tt:terminar', volta, 8_000)
  if (!resposta.ok) return null
  return {
    estado: resposta.estado as VereditoDaVolta['estado'],
    motivo: resposta.motivo as string | undefined,
    linha: (resposta.linha as LinhaDoQuadro) ?? null,
    ...(resposta.copa ? { copa: resposta.copa as { posicao: number } } : {}),
  }
}

/** Um desafio da semana, como o servidor o manda: com o líder e a sua linha. */
export type ResumoDoDesafio = {
  id: string
  modificador: string
  nome: string
  descricao: string
  seed: number
  limites: Record<Medalha, number>
  lider: LinhaDoQuadro | null
  voce: LinhaDoQuadro | null
}

export async function buscarDesafios(socket: Socket): Promise<ResumoDoDesafio[] | null> {
  const resposta = await perguntar(socket, 'tt:desafios')
  return resposta.ok ? (resposta.desafios as ResumoDoDesafio[]) : null
}

/** A volta de um tempo do top do dia, para correr contra ela. */
export async function baixarFantasma(socket: Socket, tempoId: string): Promise<GravacaoDeVolta | null> {
  const resposta = await perguntar(socket, 'tt:fantasma', { tempo: tempoId }, 6_000)
  return resposta.ok ? (resposta.gravacao as GravacaoDeVolta) : null
}
