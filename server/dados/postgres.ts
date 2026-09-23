import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { gravacaoValida } from '../../src/game/gravador.js'
import { toDifficulty, type Difficulty } from '../../src/game/rules.js'
import type { EstadoRanqueado } from '../ranqueada/rating.js'
import type {
  CorridaRanqueada,
  Dispositivo,
  EstadoDoTempo,
  LinhaDaEscada,
  LinhaDoQuadro,
  NovoTempo,
  Perfil,
  Repositorio,
  TempoRegistrado,
  Trofeu,
  VoltaRanqueada,
} from './tipos.js'

const { Pool } = pg

/** Chave do bloqueio que impede duas subidas de migrar o banco ao mesmo tempo. */
const TRAVA_DAS_MIGRACOES = 727_272

/**
 * Aplica as migrações que faltam, em ordem, cada uma numa transação.
 *
 * São arquivos SQL puros em `migracoes/`, numerados: sem ORM e sem ferramenta
 * à parte, para quem mantém o projeto ler o esquema direto no arquivo.
 */
export async function migrar(pool: pg.Pool) {
  const cliente = await pool.connect()
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [TRAVA_DAS_MIGRACOES])
    await cliente.query(
      'CREATE TABLE IF NOT EXISTS migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())',
    )
    const pasta = fileURLToPath(new URL('./migracoes/', import.meta.url))
    const arquivos = (await readdir(pasta)).filter((arquivo) => arquivo.endsWith('.sql')).sort()
    const { rows } = await cliente.query<{ nome: string }>('SELECT nome FROM migracoes')
    const feitas = new Set(rows.map((linha) => linha.nome))
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue
      const sql = await readFile(join(pasta, arquivo), 'utf8')
      try {
        await cliente.query('BEGIN')
        await cliente.query(sql)
        await cliente.query('INSERT INTO migracoes (nome) VALUES ($1)', [arquivo])
        await cliente.query('COMMIT')
      } catch (erro) {
        await cliente.query('ROLLBACK')
        throw erro
      }
    }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [TRAVA_DAS_MIGRACOES]).catch(() => undefined)
    cliente.release()
  }
}

type LinhaDeTempo = {
  id: string
  perfil_id: string
  apelido: string
  dia: string
  seed: string
  dificuldade: string
  tempo: number
  dispositivo: string
  estado: string
  criado_em: Date
  posicao?: string
}

/**
 * Colunas de um tempo. O dia sai como texto: o driver converte `date` para
 * meia-noite no fuso do servidor, e o dia da pista é o de Brasília, não o dele.
 */
const COLUNAS_DO_TEMPO = `t.id, t.perfil_id, p.apelido, to_char(t.dia, 'YYYY-MM-DD') AS dia, t.seed, t.dificuldade,
  t.tempo, t.dispositivo, t.estado, t.criado_em`

/** O melhor tempo válido de cada piloto numa semente e nível, com a posição. */
const MELHORES = `
  WITH melhores AS (
    SELECT DISTINCT ON (t.perfil_id) ${COLUNAS_DO_TEMPO}
    FROM tempos t JOIN perfis p ON p.id = t.perfil_id
    WHERE t.seed = $1 AND t.dificuldade = $2 AND t.estado = 'valido'
    ORDER BY t.perfil_id, t.tempo, t.criado_em
  )
  SELECT *, ROW_NUMBER() OVER (ORDER BY tempo, criado_em) AS posicao FROM melhores`

type LinhaDeRating = {
  mu: number
  sigma: number
  pl: number
  corridas: number
  colocacao: number
  escudo: number
  pico: number
  podios: number
  abandonos: number
  ultima_corrida: Date | null
}

const COLUNAS_DO_RATING = 'r.mu, r.sigma, r.pl, r.corridas, r.colocacao, r.escudo, r.pico, r.podios, r.abandonos, r.ultima_corrida'

/** A escada da temporada: só quem terminou a colocação, dos PL mais altos para os mais baixos. */
const ESCADA = `
  SELECT r.perfil_id, p.apelido, ${COLUNAS_DO_RATING},
    ROW_NUMBER() OVER (ORDER BY r.pl DESC, r.mu DESC) AS posicao
  FROM ratings r JOIN perfis p ON p.id = r.perfil_id
  WHERE r.temporada = $1 AND r.colocacao = 0`

function paraEstado(linha: LinhaDeRating): EstadoRanqueado {
  return {
    mmr: { mu: Number(linha.mu), sigma: Number(linha.sigma) },
    pl: linha.pl,
    corridas: linha.corridas,
    colocacao: linha.colocacao,
    escudo: linha.escudo,
    pico: linha.pico,
    podios: linha.podios,
    abandonos: linha.abandonos,
    ultimaCorrida: linha.ultima_corrida ? linha.ultima_corrida.getTime() : null,
  }
}

export class RepositorioPostgres implements Repositorio {
  readonly descricao: string

  private constructor(private readonly pool: pg.Pool, descricao: string) {
    this.descricao = descricao
  }

  /** Conecta, aplica as migrações e devolve o repositório pronto. */
  static async conectar(url: string) {
    const pool = new Pool({ connectionString: url, max: 8 })
    // Um erro num cliente ocioso — o banco reiniciou — não pode derrubar o servidor da corrida.
    pool.on('error', (erro) => console.error('Postgres:', erro.message))
    await migrar(pool)
    const endereco = new URL(url)
    return new RepositorioPostgres(pool, `Postgres em ${endereco.hostname}${endereco.pathname}`)
  }

  async criarPerfil(apelido: string, tokenHash: string): Promise<Perfil> {
    const id = randomUUID()
    const { rows } = await this.pool.query<{ criado_em: Date }>(
      'INSERT INTO perfis (id, apelido, token_hash) VALUES ($1, $2, $3) RETURNING criado_em',
      [id, apelido, tokenHash],
    )
    return { id, apelido, criadoEm: rows[0].criado_em.getTime() }
  }

  async perfilPorCredencial(id: string, tokenHash: string) {
    if (!pareceUuid(id)) return null
    const { rows } = await this.pool.query<{ id: string; apelido: string; criado_em: Date }>(
      'SELECT id, apelido, criado_em FROM perfis WHERE id = $1 AND token_hash = $2',
      [id, tokenHash],
    )
    return rows[0] ? { id: rows[0].id, apelido: rows[0].apelido, criadoEm: rows[0].criado_em.getTime() } : null
  }

  async perfil(id: string) {
    if (!pareceUuid(id)) return null
    const { rows } = await this.pool.query<{ id: string; apelido: string; criado_em: Date }>(
      'SELECT id, apelido, criado_em FROM perfis WHERE id = $1',
      [id],
    )
    return rows[0] ? { id: rows[0].id, apelido: rows[0].apelido, criadoEm: rows[0].criado_em.getTime() } : null
  }

  async renomearPerfil(id: string, apelido: string) {
    if (!pareceUuid(id)) return
    await this.pool.query('UPDATE perfis SET apelido = $2 WHERE id = $1', [id, apelido])
  }

  async registrarTempo(novo: NovoTempo): Promise<TempoRegistrado> {
    const id = randomUUID()
    await this.pool.query(
      `INSERT INTO tempos (id, perfil_id, dia, seed, dificuldade, tempo, dispositivo, estado, gravacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, novo.perfilId, novo.dia, novo.seed, novo.dificuldade, novo.tempo, novo.dispositivo, novo.estado, JSON.stringify(novo.gravacao)],
    )
    const { rows } = await this.pool.query<LinhaDeTempo>(
      `SELECT ${COLUNAS_DO_TEMPO} FROM tempos t JOIN perfis p ON p.id = t.perfil_id WHERE t.id = $1`,
      [id],
    )
    return paraTempo(rows[0])
  }

  async quadro(seed: number, dificuldade: Difficulty, limite: number): Promise<LinhaDoQuadro[]> {
    const { rows } = await this.pool.query<LinhaDeTempo>(`${MELHORES} ORDER BY posicao LIMIT $3`, [
      seed,
      dificuldade,
      Math.max(0, Math.floor(limite)),
    ])
    return rows.map(paraLinha)
  }

  async linhaDe(seed: number, dificuldade: Difficulty, perfilId: string) {
    if (!pareceUuid(perfilId)) return null
    const { rows } = await this.pool.query<LinhaDeTempo>(
      `SELECT * FROM (${MELHORES}) quadro WHERE perfil_id = $3`,
      [seed, dificuldade, perfilId],
    )
    return rows[0] ? paraLinha(rows[0]) : null
  }

  async gravacao(tempoId: string) {
    if (!pareceUuid(tempoId)) return null
    const { rows } = await this.pool.query<{ gravacao: unknown }>('SELECT gravacao FROM tempos WHERE id = $1', [tempoId])
    return rows[0] ? gravacaoValida(rows[0].gravacao) : null
  }

  async estadoRanqueado(perfilId: string, temporada: string) {
    if (!pareceUuid(perfilId)) return null
    const { rows } = await this.pool.query<LinhaDeRating>(
      `SELECT ${COLUNAS_DO_RATING} FROM ratings r WHERE r.perfil_id = $1 AND r.temporada = $2`,
      [perfilId, temporada],
    )
    return rows[0] ? paraEstado(rows[0]) : null
  }

  async estadoAnterior(perfilId: string, temporada: string) {
    if (!pareceUuid(perfilId)) return null
    const { rows } = await this.pool.query<LinhaDeRating>(
      `SELECT ${COLUNAS_DO_RATING} FROM ratings r WHERE r.perfil_id = $1 AND r.temporada < $2 ORDER BY r.temporada DESC LIMIT 1`,
      [perfilId, temporada],
    )
    return rows[0] ? paraEstado(rows[0]) : null
  }

  async registrarCorridaRanqueada(corrida: CorridaRanqueada) {
    const cliente = await this.pool.connect()
    try {
      await cliente.query('BEGIN')
      const inserida = await cliente.query(
        `INSERT INTO corridas_ranqueadas (id, temporada, sala, seed, criada_em)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0)) ON CONFLICT (id) DO NOTHING`,
        [corrida.id, corrida.temporada, corrida.sala, corrida.seed, corrida.instante],
      )
      // Já registrada: a mesma corrida não conta duas vezes.
      if (inserida.rowCount === 0) {
        await cliente.query('ROLLBACK')
        return
      }
      for (const resultado of corrida.resultados) {
        const depois = resultado.depois
        await cliente.query(
          `INSERT INTO ratings (perfil_id, temporada, mu, sigma, pl, corridas, colocacao, escudo, pico, podios, abandonos, ultima_corrida)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12 / 1000.0))
           ON CONFLICT (perfil_id, temporada) DO UPDATE SET
             mu = EXCLUDED.mu, sigma = EXCLUDED.sigma, pl = EXCLUDED.pl, corridas = EXCLUDED.corridas,
             colocacao = EXCLUDED.colocacao, escudo = EXCLUDED.escudo, pico = EXCLUDED.pico,
             podios = EXCLUDED.podios, abandonos = EXCLUDED.abandonos, ultima_corrida = EXCLUDED.ultima_corrida`,
          [
            resultado.perfilId,
            corrida.temporada,
            depois.mmr.mu,
            depois.mmr.sigma,
            depois.pl,
            depois.corridas,
            depois.colocacao,
            depois.escudo,
            depois.pico,
            depois.podios,
            depois.abandonos,
            depois.ultimaCorrida ?? corrida.instante,
          ],
        )
        await cliente.query(
          `INSERT INTO resultados_ranqueados
             (corrida_id, perfil_id, posto, desfecho, tempo, pl_antes, pl_depois, mu_antes, mu_depois, sigma_antes, sigma_depois)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            corrida.id,
            resultado.perfilId,
            resultado.posto,
            resultado.desfecho,
            resultado.tempo,
            resultado.antes.pl,
            depois.pl,
            resultado.antes.mmr.mu,
            depois.mmr.mu,
            resultado.antes.mmr.sigma,
            depois.mmr.sigma,
          ],
        )
      }
      await cliente.query('COMMIT')
    } catch (erro) {
      await cliente.query('ROLLBACK')
      throw erro
    } finally {
      cliente.release()
    }
  }

  async escada(temporada: string, limite: number): Promise<LinhaDaEscada[]> {
    const { rows } = await this.pool.query<LinhaDeRating & { perfil_id: string; apelido: string; posicao: string }>(
      `${ESCADA} ORDER BY posicao LIMIT $2`,
      [temporada, Math.max(0, Math.floor(limite))],
    )
    return rows.map((linha) => ({ perfilId: linha.perfil_id, apelido: linha.apelido, estado: paraEstado(linha), posicao: Number(linha.posicao) }))
  }

  async posicaoNaEscada(perfilId: string, temporada: string) {
    if (!pareceUuid(perfilId)) return null
    const { rows } = await this.pool.query<{ posicao: string }>(
      `SELECT posicao FROM (${ESCADA}) escada WHERE perfil_id = $2`,
      [temporada, perfilId],
    )
    return rows[0] ? Number(rows[0].posicao) : null
  }

  async corridasJuntos(perfilIds: readonly string[], desde: number, emComum: number) {
    const ids = perfilIds.filter(pareceUuid)
    if (ids.length < emComum) return 0
    const { rows } = await this.pool.query<{ quantas: string }>(
      `SELECT count(*) AS quantas FROM (
         SELECT r.corrida_id FROM resultados_ranqueados r
         JOIN corridas_ranqueadas c ON c.id = r.corrida_id
         WHERE c.criada_em >= to_timestamp($1 / 1000.0) AND r.perfil_id = ANY($2::uuid[])
         GROUP BY r.corrida_id HAVING count(*) >= $3
       ) juntos`,
      [desde, ids, emComum],
    )
    return Number(rows[0]?.quantas ?? 0)
  }

  async registrarVoltaRanqueada(volta: Omit<VoltaRanqueada, 'id' | 'apelido' | 'criadaEm'>) {
    await this.pool.query(
      `INSERT INTO voltas_ranqueadas (id, perfil_id, seed, dificuldade, tempo, mu, sigma, carro, gravacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        volta.perfilId,
        volta.seed,
        volta.dificuldade,
        volta.tempo,
        volta.mmr.mu,
        volta.mmr.sigma,
        volta.carro,
        JSON.stringify(volta.gravacao),
      ],
    )
  }

  async voltasRanqueadas(dificuldade: Difficulty, desde: number, excluirPerfil: string, limite: number) {
    const { rows } = await this.pool.query<{
      id: string
      perfil_id: string
      apelido: string
      seed: string
      dificuldade: string
      tempo: number
      mu: number
      sigma: number
      carro: string
      gravacao: unknown
      criada_em: Date
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (v.perfil_id, v.seed) v.id, v.perfil_id, p.apelido, v.seed, v.dificuldade, v.tempo,
           v.mu, v.sigma, v.carro, v.gravacao, v.criada_em
         FROM voltas_ranqueadas v JOIN perfis p ON p.id = v.perfil_id
         WHERE v.dificuldade = $1 AND v.criada_em >= to_timestamp($2 / 1000.0) AND v.perfil_id::text <> $3
         ORDER BY v.perfil_id, v.seed, v.criada_em DESC
       ) recentes ORDER BY criada_em DESC LIMIT $4`,
      [dificuldade, desde, excluirPerfil, Math.max(0, Math.floor(limite))],
    )
    return rows.flatMap((linha) => {
      const gravacao = gravacaoValida(linha.gravacao)
      if (!gravacao) return []
      return [
        {
          id: linha.id,
          perfilId: linha.perfil_id,
          apelido: linha.apelido,
          seed: Number(linha.seed),
          dificuldade: toDifficulty(linha.dificuldade),
          tempo: Number(linha.tempo),
          mmr: { mu: Number(linha.mu), sigma: Number(linha.sigma) },
          carro: linha.carro,
          gravacao,
          criadaEm: linha.criada_em.getTime(),
        },
      ]
    })
  }

  async registrarTrofeu(trofeu: Trofeu) {
    await this.pool.query(
      'INSERT INTO trofeus (id, perfil_id, dia, divisao, posicao, participantes) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), trofeu.perfilId, trofeu.dia, trofeu.divisao, trofeu.posicao, trofeu.participantes],
    )
  }

  async trofeusDe(perfilId: string) {
    if (!pareceUuid(perfilId)) return []
    const { rows } = await this.pool.query<{ perfil_id: string; dia: string; divisao: number; posicao: number; participantes: number }>(
      `SELECT perfil_id, to_char(dia, 'YYYY-MM-DD') AS dia, divisao, posicao, participantes
       FROM trofeus WHERE perfil_id = $1 ORDER BY dia DESC, posicao`,
      [perfilId],
    )
    return rows.map((linha) => ({
      perfilId: linha.perfil_id,
      dia: linha.dia,
      divisao: linha.divisao,
      posicao: linha.posicao,
      participantes: linha.participantes,
    }))
  }

  async fechar() {
    await this.pool.end()
  }
}

/** Um identificador que não é UUID nem chega ao banco: o Postgres recusaria com erro. */
function pareceUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

function paraTempo(linha: LinhaDeTempo): TempoRegistrado {
  return {
    id: linha.id,
    perfilId: linha.perfil_id,
    apelido: linha.apelido,
    dia: linha.dia,
    seed: Number(linha.seed),
    dificuldade: toDifficulty(linha.dificuldade),
    tempo: Number(linha.tempo),
    dispositivo: linha.dispositivo as Dispositivo,
    estado: linha.estado as EstadoDoTempo,
    criadoEm: linha.criado_em.getTime(),
  }
}

function paraLinha(linha: LinhaDeTempo): LinhaDoQuadro {
  return { ...paraTempo(linha), posicao: Number(linha.posicao) }
}
