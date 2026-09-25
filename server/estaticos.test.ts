import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as pedir, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aceita, servirSite } from './estaticos.js'

const JS = 'export const pista = "curva";\n'.repeat(400)

let raiz = ''
let servidor: Server
let porta = 0

function buscar(caminho: string, cabecalhos: Record<string, string> = {}, metodo = 'GET') {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; corpo: Buffer }>((resolve, reject) => {
    const pedido = pedir({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cabecalhos }, (resposta) => {
      const partes: Buffer[] = []
      resposta.on('data', (parte: Buffer) => partes.push(parte))
      resposta.on('end', () => resolve({ status: resposta.statusCode ?? 0, headers: resposta.headers, corpo: Buffer.concat(partes) }))
    })
    pedido.on('error', reject)
    pedido.end()
  })
}

beforeAll(async () => {
  raiz = mkdtempSync(join(tmpdir(), 'site-'))
  mkdirSync(join(raiz, 'assets'))
  mkdirSync(join(raiz, 'carros'))
  writeFileSync(join(raiz, 'index.html'), '<!doctype html><title>Corrida Fantasma</title>')
  writeFileSync(join(raiz, 'assets', 'index-abc123.js'), JS)
  writeFileSync(join(raiz, 'carros', 'senna.png'), Buffer.from([137, 80, 78, 71]))
  const app = express()
  servirSite(app, raiz)
  servidor = app.listen(0)
  await new Promise((resolve) => servidor.once('listening', resolve))
  porta = (servidor.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise((resolve) => servidor.close(resolve))
  rmSync(raiz, { recursive: true, force: true })
})

describe('site servido aos celulares', () => {
  it('o JS sai em brotli quando o navegador aceita, e guardado para sempre', async () => {
    const resposta = await buscar('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip, deflate, br' })
    expect(resposta.status).toBe(200)
    expect(resposta.headers['content-encoding']).toBe('br')
    expect(resposta.headers['content-type']).toContain('javascript')
    expect(resposta.headers.vary).toContain('Accept-Encoding')
    expect(resposta.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(resposta.corpo.length).toBeLessThan(JS.length / 5)
    expect(brotliDecompressSync(resposta.corpo).toString()).toBe(JS)
  })

  it('só gzip, sai em gzip', async () => {
    const resposta = await buscar('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip' })
    expect(resposta.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(resposta.corpo).toString()).toBe(JS)
  })

  it('sem compressão aceita, sai como está, com o mesmo cache', async () => {
    const resposta = await buscar('/assets/index-abc123.js')
    expect(resposta.headers['content-encoding']).toBeUndefined()
    expect(resposta.corpo.toString()).toBe(JS)
    expect(resposta.headers['cache-control']).toContain('immutable')
  })

  it('o HEAD tem os cabeçalhos e nenhum corpo', async () => {
    const resposta = await buscar('/assets/index-abc123.js', { 'Accept-Encoding': 'br' }, 'HEAD')
    expect(resposta.headers['content-encoding']).toBe('br')
    expect(Number(resposta.headers['content-length'])).toBeGreaterThan(0)
    expect(resposta.corpo.length).toBe(0)
  })

  it('um asset que não existe dá 404, e não o index.html', async () => {
    const resposta = await buscar('/assets/index-antigo.js', { 'Accept-Encoding': 'gzip' })
    expect(resposta.status).toBe(404)
  })

  it('o HTML é conferido a cada visita', async () => {
    const raizDoSite = await buscar('/')
    expect(raizDoSite.corpo.toString()).toContain('Corrida Fantasma')
    expect(raizDoSite.headers['cache-control']).toBe('no-cache')
    const rota = await buscar('/sala/ABC')
    expect(rota.corpo.toString()).toContain('Corrida Fantasma')
    expect(rota.headers['cache-control']).toBe('no-cache')
  })

  it('carros, vozes e fontes ficam guardados por uma hora', async () => {
    const resposta = await buscar('/carros/senna.png')
    expect(resposta.status).toBe(200)
    expect(resposta.headers['cache-control']).toBe('public, max-age=3600')
  })
})

describe('codificação aceita', () => {
  it('lê a lista do navegador, inclusive a recusa com q=0', () => {
    expect(aceita('gzip, deflate, br', 'br')).toBe(true)
    expect(aceita('gzip;q=1.0, br;q=0', 'br')).toBe(false)
    expect(aceita('GZIP', 'gzip')).toBe(true)
    expect(aceita(undefined, 'gzip')).toBe(false)
    expect(aceita('gzipper', 'gzip')).toBe(false)
  })
})
