import type { Socket } from 'socket.io-client'

/**
 * O perfil do piloto, guardado no aparelho.
 *
 * Não há cadastro: na primeira conexão o servidor cria o perfil com o nome do
 * piloto e devolve um segredo, que fica aqui. Nas visitas seguintes o aparelho
 * entra com ele. O `playerId` da sala continua por aba, como sempre — é o que
 * deixa testar vários pilotos em várias abas —; o perfil é um só por aparelho,
 * e é ele que tem tempo no quadro e ponto na ranqueada.
 */

export type PerfilGuardado = { id: string; segredo: string }
export type PerfilPublico = { id: string; apelido: string }

const CHAVE = 'corrida-perfil'

/** Quanto esperar o servidor responder antes de seguir sem perfil. */
const ESPERA_MS = 4_000

type Armazenamento = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function armazenamento(): Armazenamento | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

export function lerPerfilGuardado(guardado: Armazenamento | null = armazenamento()): PerfilGuardado | null {
  try {
    const bruto = guardado?.getItem(CHAVE)
    if (!bruto) return null
    const dados = JSON.parse(bruto) as Partial<PerfilGuardado>
    return typeof dados.id === 'string' && typeof dados.segredo === 'string' ? { id: dados.id, segredo: dados.segredo } : null
  } catch {
    return null
  }
}

export function guardarPerfil(perfil: PerfilGuardado, guardado: Armazenamento | null = armazenamento()) {
  try {
    guardado?.setItem(CHAVE, JSON.stringify(perfil))
  } catch {
    // Sem armazenamento o perfil vale só até fechar a página.
  }
}

export function esquecerPerfil(guardado: Armazenamento | null = armazenamento()) {
  try {
    guardado?.removeItem(CHAVE)
  } catch {
    // Nada a fazer.
  }
}

/**
 * Código de recuperação: o par inteiro, para levar o perfil a outro aparelho.
 *
 * Quem tem o código tem o perfil — a tela avisa isso ao mostrá-lo.
 */
export function codigoDeRecuperacao(perfil: PerfilGuardado) {
  return `${perfil.id}.${perfil.segredo}`
}

export function perfilDoCodigo(codigo: string): PerfilGuardado | null {
  const limpo = codigo.trim()
  const ponto = limpo.indexOf('.')
  if (ponto <= 0 || ponto === limpo.length - 1) return null
  return { id: limpo.slice(0, ponto), segredo: limpo.slice(ponto + 1) }
}

type Resposta = { ok: boolean; error?: string } & Record<string, unknown>

/** Emite e espera a resposta do servidor, com prazo. Sem resposta, `{ ok: false }`. */
export function perguntar(socket: Socket, evento: string, dados?: unknown, esperaMs = ESPERA_MS): Promise<Resposta> {
  return new Promise((resolve) => {
    const prazo = setTimeout(() => resolve({ ok: false, error: 'O servidor não respondeu.' }), esperaMs)
    socket.emit(evento, dados, (resposta: Resposta) => {
      clearTimeout(prazo)
      resolve(resposta ?? { ok: false })
    })
  })
}

/**
 * Entra no perfil guardado ou cria um novo, com o apelido dado.
 *
 * Um perfil guardado que o servidor não conhece mais — o banco foi zerado, ou
 * era um servidor sem banco que reiniciou — é trocado por um novo.
 */
export async function entrarNoPerfil(socket: Socket, apelido: string): Promise<PerfilPublico | null> {
  const guardado = lerPerfilGuardado()
  if (guardado) {
    const entrada = await perguntar(socket, 'perfil:entrar', guardado)
    if (entrada.ok && entrada.perfil) return entrada.perfil as PerfilPublico
    if (entrada.error === 'O servidor não respondeu.') return null
  }
  const criado = await perguntar(socket, 'perfil:criar', { apelido })
  if (!criado.ok || !criado.perfil || typeof criado.segredo !== 'string') return null
  const perfil = criado.perfil as PerfilPublico
  guardarPerfil({ id: perfil.id, segredo: criado.segredo })
  return perfil
}
