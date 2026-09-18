import { describe, expect, it } from 'vitest'
import { identificadorDoPiloto, novoIdentificador } from './identity'

/** Armazenamento de mentira, para não depender do navegador nos testes. */
function memoria(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial))
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void dados.set(chave, valor),
    removeItem: (chave: string) => void dados.delete(chave),
    clear: () => dados.clear(),
    key: () => null,
    length: 0,
  } as Storage
}

const comRandomUUID = {
  randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  getRandomValues: <T extends ArrayBufferView>(array: T) => array,
}

/** O que o navegador oferece em http na rede local: sem randomUUID. */
const semContextoSeguro = {
  getRandomValues: <T extends ArrayBufferView>(array: T) => {
    const bytes = new Uint8Array(array.buffer)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37 + 11) % 256
    return array
  },
}

describe('identificador do piloto', () => {
  it('usa randomUUID quando o navegador oferece', () => {
    expect(novoIdentificador(comRandomUUID)).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('funciona em rede local, onde randomUUID não existe', () => {
    const id = novoIdentificador(semContextoSeguro)
    expect(id).toHaveLength(32)
    expect(id).toMatch(/^[0-9a-f]+$/)
  })

  it('funciona mesmo sem nenhuma API de sorteio', () => {
    const id = novoIdentificador(undefined)
    expect(id.length).toBeGreaterThan(12)
  })

  it('não repete o identificador entre dois pilotos', () => {
    const gerados = new Set(Array.from({ length: 500 }, () => novoIdentificador(undefined)))
    expect(gerados.size).toBe(500)
  })

  it('guarda o identificador para sobreviver a um recarregamento', () => {
    const storage = memoria()
    const primeiro = identificadorDoPiloto(storage, semContextoSeguro)
    const segundo = identificadorDoPiloto(storage, semContextoSeguro)
    expect(segundo).toBe(primeiro)
  })

  it('aproveita um identificador já guardado', () => {
    const storage = memoria({ 'ghost-racer-id': 'piloto-existente' })
    expect(identificadorDoPiloto(storage, comRandomUUID)).toBe('piloto-existente')
  })

  it('continua funcionando se o armazenamento for recusado', () => {
    const bloqueado = {
      getItem: () => {
        throw new Error('navegação privada')
      },
      setItem: () => {
        throw new Error('navegação privada')
      },
    } as unknown as Storage

    expect(identificadorDoPiloto(bloqueado, semContextoSeguro)).toHaveLength(32)
  })
})
