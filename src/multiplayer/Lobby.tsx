import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { carById } from '../game/cars'
import { carImageUrl } from '../game/carSprites'
import { countdownAt } from '../game/countdown'
import { MusicaDoLobby } from '../game/musicaDoLobby'
import { definirMusicaDesligada, lerMusicaDesligada, lerSomDesligado } from '../game/preferenciasDeSom'
import { DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES, type Difficulty } from '../game/rules'
import { serverClock, type ClockState } from './clock'
import { socket } from './socket'
import type { LobbyRoom, RoomResponse } from './types'

/** Vagas do grid. O servidor recusa o sétimo. */
const VAGAS_DO_GRID = 6

/** Por quanto tempo o botão de tirar um piloto espera a confirmação. */
const JANELA_DE_CONFIRMACAO_MS = 3_000

type LobbyProps = {
  room: LobbyRoom
  playerId: string
  clock: ClockState
  connection: 'connected' | 'reconnecting'
  notice: string
  onRoomChange: (room: LobbyRoom) => void
  onLeave: () => void
  onError: (message: string) => void
  /** Abre a garagem para trocar de carro sem sair da sala. */
  onChangeCar: () => void
}

function Lobby({ room, playerId, clock, connection, notice, onRoomChange, onLeave, onError, onChangeCar }: LobbyProps) {
  const me = room.players.find((player) => player.id === playerId)
  const souAnfitriao = room.hostId === playerId
  const rivals = room.players.filter((player) => player.id !== playerId)
  const haPilotoSemSinal = rivals.some((player) => !player.connected)
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`
  const [copied, setCopied] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  /** Piloto que o anfitrião está prestes a tirar: o primeiro toque só pergunta. */
  const [tirando, setTirando] = useState<string | null>(null)
  const [semMusica, setSemMusica] = useState(() => lerMusicaDesligada() || lerSomDesligado())
  const musicaRef = useRef<MusicaDoLobby | null>(null)

  const prontos = room.players.filter((player) => player.ready).length
  const vagas = VAGAS_DO_GRID - room.players.length
  const faltam = room.players.filter((player) => !player.ready)
  const primeiraVaga = room.players.length
  /** Com a largada marcada ou a prova em andamento, o grid está fechado. */
  const gridAberto = room.status !== 'countdown' && room.status !== 'racing'
  const podeTirar = souAnfitriao && gridAberto && connection === 'connected'

  /**
   * A faixa Turbo toca enquanto se espera o grid. Se o navegador ainda não
   * liberou o som, o próximo toque na tela libera.
   */
  useEffect(() => {
    const musica = new MusicaDoLobby(!lerMusicaDesligada() && !lerSomDesligado())
    musicaRef.current = musica
    musica.tocar()
    const destravar = () => {
      if (!musica.tocando) musica.tocar()
    }
    window.addEventListener('pointerdown', destravar)
    window.addEventListener('keydown', destravar)
    return () => {
      window.removeEventListener('pointerdown', destravar)
      window.removeEventListener('keydown', destravar)
      musica.encerrar()
      musicaRef.current = null
    }
  }, [])

  const alternarMusica = () => {
    const desligar = !semMusica
    definirMusicaDesligada(desligar)
    setSemMusica(desligar)
    musicaRef.current?.setLigada(!desligar)
  }

  // A pergunta de confirmação some sozinha: um toque perdido não pode ficar
  // armado esperando o próximo.
  useEffect(() => {
    if (!tirando) return
    const timer = window.setTimeout(() => setTirando(null), JANELA_DE_CONFIRMACAO_MS)
    return () => window.clearTimeout(timer)
  }, [tirando])

  // Enquanto a largada está agendada, mostra a contagem a partir do relógio sincronizado.
  useEffect(() => {
    if (room.status !== 'countdown' || !room.startAt) {
      setRemaining(null)
      return
    }
    const startAt = room.startAt
    const tick = () => setRemaining(countdownAt(serverClock.now(), startAt, room.countdownMs).remaining)
    tick()
    const timer = window.setInterval(tick, 100)
    return () => window.clearInterval(timer)
  }, [room.status, room.startAt, room.countdownMs])

  /**
   * Trocar a dificuldade vale para a sala inteira e desfaz as confirmações —
   * ninguém deve largar num nível que não viu. Por isso o servidor zera o
   * pronto de todos, e por isso o botão some depois que a contagem começa.
   */
  const escolherDificuldade = (difficulty: Difficulty) => {
    if (difficulty === room.difficulty || !souAnfitriao) return
    socket.emit('room:set-difficulty', { code: room.code, playerId, difficulty }, (response: RoomResponse) => {
      if (response.ok && response.room) onRoomChange(response.room)
      else onError(response.error ?? 'Não foi possível trocar a dificuldade.')
    })
  }

  const toggleReady = () => {
    socket.emit('room:set-ready', { code: room.code, playerId, ready: !me?.ready }, (response: RoomResponse) => {
      if (response.ok && response.room) onRoomChange(response.room)
      else onError(response.error ?? 'Não foi possível confirmar.')
    })
  }

  const tirarPiloto = (targetId: string) => {
    if (tirando !== targetId) return setTirando(targetId)
    setTirando(null)
    socket.emit('room:kick', { code: room.code, playerId, targetId }, (response: RoomResponse) => {
      if (response.ok && response.room) onRoomChange(response.room)
      else onError(response.error ?? 'Não foi possível tirar o piloto.')
    })
  }

  const leave = () => {
    socket.emit('room:leave')
    onLeave()
  }

  /**
   * Em rede local o endereço é http, e fora de contexto seguro o navegador não
   * oferece a área de transferência moderna. O caminho antigo ainda funciona e
   * é justamente o cenário do workshop.
   */
  const copyLink = async () => {
    const marcarCopiado = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_800)
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      return marcarCopiado()
    } catch {
      // Segue para o caminho antigo.
    }

    const campo = document.createElement('textarea')
    campo.value = shareUrl
    campo.setAttribute('readonly', '')
    campo.style.position = 'fixed'
    campo.style.opacity = '0'
    document.body.appendChild(campo)
    campo.select()
    const copiou = document.execCommand('copy')
    document.body.removeChild(campo)

    if (copiou) marcarCopiado()
    else onError('Não foi possível copiar. Use o código da sala ou o QR code.')
  }

  const headline = () => {
    if (room.status === 'countdown') return 'Largada a caminho.'
    if (room.players.length === 1) return 'Aguardando pilotos.'
    if (haPilotoSemSinal) return 'Piloto reconectando.'
    if (room.players.length === VAGAS_DO_GRID) return 'Grid completo.'
    return `${room.players.length} pilotos no grid.`
  }

  const statusLine = () => {
    if (room.status === 'countdown') return 'As cinco luzes já estão acesas em todos os aparelhos.'
    if (haPilotoSemSinal) return 'Um piloto perdeu a conexão e tem alguns segundos para voltar.'
    if (room.players.length === 1) return 'Compartilhe o código, link ou QR code com até cinco pilotos.'
    if (faltam.length === 0) return 'Todos confirmados.'
    // Com seis no grid, "esperando todos" não diz nada: o nome de quem falta, sim.
    const nomes = faltam.map((player) => (player.id === playerId ? 'você' : player.name))
    const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0]
    return `Falta confirmar: ${lista}. A largada sai assim que todos confirmarem.`
  }

  const relogio = clock.synced ? `RELÓGIO SINCRONIZADO ±${Math.round(clock.roundTrip / 2)} MS` : 'SINCRONIZANDO RELÓGIO…'

  return (
    <main className="screen lobby-screen">
      <div className="ambient-grid" />
      <section className="lobby-card">
        <p className="eyebrow">SALA DE CORRIDA</p>
        <div className="room-code"><span>CÓDIGO</span><strong>{room.code}</strong></div>

        <div className="lobby-grid">
          <div className="drivers-panel">
            <h1>{headline()}</h1>
            <p className="lobby-status">{statusLine()}</p>
            {notice && <p className="lobby-notice">{notice}</p>}

            <div className="grid-meter">
              <div className="grid-meter-bar" role="img" aria-label={`${prontos} de ${room.players.length} pilotos prontos`}>
                {Array.from({ length: VAGAS_DO_GRID }, (_, position) => {
                  const player = room.players[position]
                  const estado = !player ? 'vaga' : !player.connected ? 'sem-sinal' : player.ready ? 'pronto' : 'no-grid'
                  return <i key={position} className={estado} />
                })}
              </div>
              <span>
                <b>{prontos}/{room.players.length}</b> PRONTOS · {vagas === 0 ? 'SEM VAGAS' : vagas === 1 ? '1 VAGA' : `${vagas} VAGAS`}
              </span>
              <button
                type="button"
                className={`sound-button ${semMusica ? 'off' : ''}`}
                onClick={alternarMusica}
                aria-pressed={!semMusica}
                aria-label={semMusica ? 'Ligar a música' : 'Desligar a música'}
              >
                {semMusica ? 'MÚSICA ✕' : 'MÚSICA ♫'}
              </button>
            </div>

            <div className="driver-list">
              {Array.from({ length: VAGAS_DO_GRID }, (_, position) => {
                const player = room.players[position]
                const offline = player && !player.connected
                const carro = player ? carById(player.car) : null
                const souEu = player?.id === playerId
                const cor = carro ? ({ '--slot-accent': carro.accent }) as CSSProperties : undefined
                return (
                  <div
                    className={`driver-slot ${player ? 'occupied' : ''} ${offline ? 'offline' : ''} ${souEu ? 'me' : ''}`}
                    style={cor}
                    key={position}
                  >
                    <b>0{position + 1}</b>
                    {player ? <img className="slot-car" src={carImageUrl(player.car)} alt="" /> : <span />}
                    <div>
                      <span>
                        {player ? (souEu ? 'VOCÊ' : 'RIVAL') : 'VAGA LIVRE'}
                        {/* A regra da dificuldade fica visível: sem isso o
                            seletor desligado do outro lado parece defeito. */}
                        {player && player.id === room.hostId && <b className="host-tag">ANFITRIÃO</b>}
                      </span>
                      <strong>{player?.name ?? 'Aguardando piloto'}</strong>
                      {carro && (
                        <em style={{ color: carro.accent }} title={`${carro.driver} · ${carro.team} #${carro.number}`}>
                          <span>{carro.driver}</span>
                          <span>{'\u00a0· '}{carro.team} #{carro.number}</span>
                        </em>
                      )}
                    </div>
                    {souEu ? (
                      // Da contagem em diante o carro fica travado: os rivais já o viram no grid.
                      <button
                        type="button"
                        className="slot-change"
                        disabled={room.status === 'countdown' || connection !== 'connected'}
                        onClick={onChangeCar}
                      >
                        TROCAR
                      </button>
                    ) : player && podeTirar ? (
                      <button
                        type="button"
                        className={`slot-change slot-kick ${tirando === player.id ? 'armed' : ''}`}
                        onClick={() => tirarPiloto(player.id)}
                        aria-label={tirando === player.id ? `Confirmar: tirar ${player.name} da sala` : `Tirar ${player.name} da sala`}
                      >
                        {tirando === player.id ? 'CONFIRMAR' : 'TIRAR'}
                      </button>
                    ) : !player && position === primeiraVaga && gridAberto ? (
                      // A primeira vaga livre convida: é ali que o olho procura.
                      <button type="button" className="slot-change slot-invite" onClick={copyLink}>
                        {copied ? 'COPIADO' : 'CONVIDAR'}
                      </button>
                    ) : (
                      <span className="slot-spacer" />
                    )}
                    <i className={player?.ready ? 'ready' : ''}>
                      {offline ? 'SEM SINAL' : player?.ready ? 'PRONTO' : player ? 'NO GRID' : '—'}
                    </i>
                  </div>
                )
              })}
            </div>

            <div className="lobby-difficulty">
              <span>DIFICULDADE DA SALA</span>
              <div className="difficulty-picker" role="group" aria-label="Dificuldade da sala">
                {DIFFICULTIES.map((nivel) => (
                  <button
                    key={nivel}
                    type="button"
                    className={room.difficulty === nivel ? 'on' : ''}
                    aria-pressed={room.difficulty === nivel}
                    disabled={!souAnfitriao || room.status === 'countdown' || connection !== 'connected'}
                    onClick={() => escolherDificuldade(nivel)}
                  >
                    {DIFFICULTY_LABELS[nivel]}
                  </button>
                ))}
              </div>
              <em>
                {DIFFICULTY_NOTES[room.difficulty]}
                {!souAnfitriao && ' Quem criou a sala escolhe.'}
              </em>
            </div>

            {room.status === 'countdown' && remaining !== null ? (
              <div className="countdown-panel" role="status">
                <span>LARGADA EM</span>
                <strong>{(Math.max(0, remaining) / 1000).toFixed(1)}s</strong>
              </div>
            ) : (
              <button
                className="primary-button ready-button"
                disabled={
                  room.players.length < 2 ||
                  connection !== 'connected' ||
                  // Com alguém sem sinal ainda é possível desfazer a própria confirmação.
                  (!me?.ready && haPilotoSemSinal)
                }
                onClick={toggleReady}
              >
                {room.players.length < 2 ? 'AGUARDANDO RIVAIS' : me?.ready ? 'CANCELAR PRONTO' : 'ESTOU PRONTO'} <span>↗</span>
              </button>
            )}

            <p className={`clock-note ${clock.synced ? 'ok' : ''}`}>
              {connection === 'connected' ? relogio : 'CONEXÃO INSTÁVEL — RECONECTANDO'}
            </p>
          </div>

          <aside className="share-panel">
            <div className="qr-wrap"><QRCodeSVG value={shareUrl} size={156} bgColor="#f4f4ee" fgColor="#090d12" /></div>
            <span>APONTE A CÂMERA</span>
            <button className="copy-button" onClick={copyLink}>{copied ? 'LINK COPIADO' : 'COPIAR LINK'}</button>
          </aside>
        </div>
        <button className="text-button" onClick={leave}>SAIR DA SALA</button>
      </section>
    </main>
  )
}

export default Lobby
