import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'

/** As fontes que existem de fato em public/fontes, pelo endereço com que o site as pede. */
const FONTES = Object.keys(import.meta.glob('/public/fontes/*.woff2')).map((caminho) => caminho.replace(/^\/public/, ''))

describe('fontes pré-carregadas no index.html', () => {
  it('toda fonte do preload existe em public/fontes', () => {
    const preloads = [...indexHtml.matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"/g)].map((achado) => achado[1])
    expect(preloads.length).toBeGreaterThan(0)
    // Um nome trocado por `npm run fontes` viraria um download perdido.
    for (const endereco of preloads) expect(FONTES).toContain(endereco)
  })
})
