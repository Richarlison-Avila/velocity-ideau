/**
 * Identificador do piloto.
 *
 * `crypto.randomUUID` só existe em contexto seguro — HTTPS ou localhost. No
 * workshop o jogo roda na rede local por http, onde a função não existe, e
 * chamá-la direto deixaria a tela em branco em todos os celulares. Por isso há
 * um caminho de reserva que não depende dela.
 */

type FonteAleatoria = Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string }

const CHAVE = 'ghost-racer-id'

/** Gera um identificador único, com ou sem as APIs de contexto seguro. */
export function novoIdentificador(fonte?: FonteAleatoria): string {
  if (typeof fonte?.randomUUID === 'function') return fonte.randomUUID()

  if (typeof fonte?.getRandomValues === 'function') {
    const bytes = fonte.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  // Último recurso: o horário somado a dois sorteios ainda é suficiente para
  // distinguir dois pilotos de uma mesma sala.
  const sorteio = () => Math.random().toString(36).slice(2, 12)
  return `${Date.now().toString(36)}${sorteio()}${sorteio()}`
}

/**
 * Identificador desta aba, criado uma vez e guardado para sobreviver a um
 * recarregamento acidental da página.
 */
export function identificadorDoPiloto(storage: Storage, fonte?: FonteAleatoria): string {
  try {
    const guardado = storage.getItem(CHAVE)
    if (guardado) return guardado
    const novo = novoIdentificador(fonte)
    storage.setItem(CHAVE, novo)
    return novo
  } catch {
    // Navegação privada pode recusar o armazenamento; a corrida continua.
    return novoIdentificador(fonte)
  }
}
