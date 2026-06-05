'use client'

export default function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl w-full max-w-md flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex-1">
            <p className="font-black text-lg">📖 Normas</p>
            <p className="text-xs text-[var(--text-secondary)]">IT&apos;S FÚTBOL, NOT SOCCER · Fantasy Mundial 2026</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        {/* Contenido */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-5 text-sm">
          <Section title="📋 ¿Cómo funciona?">
            <p>Antes del Mundial se hace un <b>draft en serpiente</b> para repartir las selecciones (ronda 1: 1-2-3…, ronda 2: …-3-2-1, y así).</p>
            <p>El draft termina cuando quedan menos selecciones libres que participantes.</p>
            <p>⚠️ No se permiten intercambios ni traspasos. Cada selección tiene un único propietario todo el torneo.</p>
          </Section>

          <Section title="⚽ Puntos por partido">
            <Bullet>✅ <b>Victoria</b>: +2 puntos</Bullet>
            <Bullet>🤝 <b>Empate</b>: +1 punto para cada propietario</Bullet>
            <Bullet>Si una selección no tiene dueño, esos puntos no se asignan.</Bullet>
          </Section>

          <Section title="🎯 Porra del marcador">
            <p>Antes de cada partido, los dos propietarios implicados predicen el resultado exacto.</p>
            <Bullet>Si aciertas → <b>robas 1 punto</b> a tu rival.</Bullet>
            <Bullet>Si ambos aciertan o ambos fallan → no pasa nada.</Bullet>
          </Section>

          <Section title="⭐ Jugadores destacados">
            <p>Antes de cada partido, cada propietario elige <b>3 jugadores de su propia selección</b>.</p>
            <Bullet>⚽ Gol en tiempo reglamentario = +1</Bullet>
            <Bullet>⚽ Gol en prórroga = +0,5</Bullet>
            <Bullet>⚽ Penalti convertido en tanda = +0,25</Bullet>
            <Bullet>🟥 Expulsión = −1</Bullet>
            <Bullet>🥅 Gol en propia = −1</Bullet>
            <p className="text-[var(--text-secondary)]">Las penalizaciones siempre valen −1 completo.</p>
          </Section>

          <Section title="🏅 Bonificaciones por clasificación">
            <p>Acumulativas:</p>
            <Bullet>Octavos → +1</Bullet>
            <Bullet>Cuartos → +3</Bullet>
            <Bullet>Semifinales → +5</Bullet>
            <Bullet>Finalista → +8</Bullet>
            <Bullet>Campeón → +17 + los puntos obtenidos en la final</Bullet>
          </Section>

          <Section title="🏆 Clasificación final">
            <p>Se suman: resultados de los partidos + puntos robados en porras + jugadores destacados + bonificaciones. Gana quien tenga más puntos al terminar el Mundial.</p>
          </Section>

          <Section title="🤝 Desempates">
            <Bullet>1️⃣ Más porras acertadas</Bullet>
            <Bullet>2️⃣ Más puntos por jugadores destacados</Bullet>
            <Bullet>3️⃣ Más victorias de sus selecciones</Bullet>
          </Section>

          <Section title="📅 Importante">
            <p>La elección de los 3 jugadores destacados y la porra deben enviarse <b>el día anterior</b> a cada partido. Una vez empieza el partido, no se pueden modificar.</p>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold mb-1.5">{title}</h3>
      <div className="space-y-1.5 text-[var(--text-primary)]">{children}</div>
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <p className="flex gap-2"><span>•</span><span className="flex-1">{children}</span></p>
}
