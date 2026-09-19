import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { countdownAt } from '../game/countdown'
import { DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_NOTES, type Difficulty } from '../game/rules'
import { serverClock, type ClockState } from './clock'
import { socket } from './socket'
import type { LobbyRoom, RoomResponse } from './types'

type LobbyProps = {
  room: LobbyRoom
  playerId: string
  clock: ClockState
  connection: 'connected' | 'reconnecting'
  notice: string
  onRoomChange: (room: LobbyRoom) => void
  onLeave: () => void
  onError: (message: string) => void
}

function Lobby({ room, playerId, clock, connection, notice, onRoomChange, onLeave, onError }: LobbyProps) {
  const me = room.players.find((player) => player.id === playerId)
  const souAnfitriao = room.hostId === playerId
  const rival = room.players.find((player) => player.id !== playerId)
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`
  const [copied, setCopied] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)

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
   * pronto dos dois, e por isso o botão some depois que a contagem começa.
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
    if (room.players.length === 1) return 'Aguardando rival.'
    if (rival && !rival.connected) return 'Rival reconectando.'
    return 'Grid completo.'
  }

  const statusLine = () => {
    if (room.status === 'countdown') return 'As cinco luzes já estão acesas nos dois aparelhos.'
    if (rival && !rival.connected) return 'O rival perdeu a conexão e tem alguns segundos para voltar.'
    if (room.players.length === 1) return 'Compartilhe o código, link ou QR code com o segundo piloto.'
    return 'Confirme quando estiver pronto. O servidor marca a largada assim que os dois confirmarem.'
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

            <div className="driver-list">
              {[0, 1].map((position) => {
                const player = room.players[position]
                const offline = player && !player.connected
                return (
                  <div className={`driver-slot ${player ? 'occupied' : ''} ${offline ? 'offline' : ''}`} key={position}>
                    <b>0{position + 1}</b>
                    <div>
                      <span>
                        {player ? (player.id === playerId ? 'VOCÊ' : 'RIVAL') : 'VAGA LIVRE'}
                        {/* A regra da dificuldade fica visível: sem isso o
                            seletor desligado do outro lado parece defeito. */}
                        {player && player.id === room.hostId && <b className="host-tag">ANFITRIÃO</b>}
                      </span>
                      <strong>{player?.name ?? 'Aguardando piloto'}</strong>
                    </div>
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
                  // Com o rival sem sinal ainda é possível desfazer a própria confirmação.
                  (!me?.ready && Boolean(rival && !rival.connected))
                }
                onClick={toggleReady}
              >
                {me?.ready ? 'CANCELAR PRONTO' : 'ESTOU PRONTO'} <span>↗</span>
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
