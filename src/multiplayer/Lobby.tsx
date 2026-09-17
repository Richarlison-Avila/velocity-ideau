import { QRCodeSVG } from 'qrcode.react'
import { socket } from './socket'
import type { LobbyRoom, RoomResponse } from './types'

type LobbyProps = {
  room: LobbyRoom
  playerId: string
  onRoomChange: (room: LobbyRoom) => void
  onLeave: () => void
  onError: (message: string) => void
}

function Lobby({ room, playerId, onRoomChange, onLeave, onError }: LobbyProps) {
  const me = room.players.find((player) => player.id === playerId)
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room.code}`

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

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl)
  }

  return (
    <main className="screen lobby-screen">
      <div className="ambient-grid" />
      <section className="lobby-card">
        <p className="eyebrow">SALA DE CORRIDA</p>
        <div className="room-code"><span>CÓDIGO</span><strong>{room.code}</strong></div>

        <div className="lobby-grid">
          <div className="drivers-panel">
            <h1>{room.players.length === 1 ? 'Aguardando rival.' : 'Grid completo.'}</h1>
            <p className="lobby-status">
              {room.status === 'ready'
                ? 'Os dois pilotos estão prontos para a largada sincronizada.'
                : room.players.length === 1
                  ? 'Compartilhe o código, link ou QR code com o segundo piloto.'
                  : 'Confirme quando estiver pronto para correr.'}
            </p>
            <div className="driver-list">
              {[0, 1].map((position) => {
                const player = room.players[position]
                return (
                  <div className={`driver-slot ${player ? 'occupied' : ''}`} key={position}>
                    <b>0{position + 1}</b>
                    <div>
                      <span>{player ? (player.id === playerId ? 'VOCÊ' : 'RIVAL') : 'VAGA LIVRE'}</span>
                      <strong>{player?.name ?? 'Aguardando piloto'}</strong>
                    </div>
                    <i className={player?.ready ? 'ready' : ''}>{player?.ready ? 'PRONTO' : player ? 'NO GRID' : '—'}</i>
                  </div>
                )
              })}
            </div>
            <button className="primary-button ready-button" disabled={room.players.length < 2} onClick={toggleReady}>
              {me?.ready ? 'CANCELAR PRONTO' : 'ESTOU PRONTO'} <span>↗</span>
            </button>
            {room.status === 'ready' && <div className="phase-note">LARGADA SINCRONIZADA ENTRA NA FASE 4</div>}
          </div>

          <aside className="share-panel">
            <div className="qr-wrap"><QRCodeSVG value={shareUrl} size={156} bgColor="#f4f4ee" fgColor="#090d12" /></div>
            <span>APONTE A CÂMERA</span>
            <button className="copy-button" onClick={copyLink}>COPIAR LINK</button>
          </aside>
        </div>
        <button className="text-button" onClick={leave}>SAIR DA SALA</button>
      </section>
    </main>
  )
}

export default Lobby
