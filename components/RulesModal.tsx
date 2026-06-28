'use client'

import { useState } from 'react'

export default function RulesModal({ onClose, wildcardEnabled = false }: { onClose: () => void; wildcardEnabled?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl w-full max-w-md flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex-1">
            <p className="font-black text-lg">❓ FAQ</p>
            <p className="text-xs text-[var(--text-secondary)]">IT&apos;S FÚTBOL, NOT SOCCER · Fantasy Mundial 2026</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        {/* Contenido */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          <Faq q="📋 ¿Cómo funciona el juego?" defaultOpen>
            <p>Un grupo de amigos se reparte las <b>48 selecciones</b> del Mundial 2026 mediante un draft. Cada selección tiene un único propietario durante todo el torneo (no hay traspasos).</p>
            <p>A lo largo del Mundial ganas puntos por los resultados de tus selecciones, por acertar porras y por los goles de tus jugadores destacados. Gana quien más puntos sume al final.</p>
          </Faq>

          <Faq q="🐍 ¿Cómo es el draft?">
            <p>Es un <b>draft en serpiente</b>: en la ronda 1 se elige en orden (1-2-3-4…), en la ronda 2 al revés (…-4-3-2-1), y así sucesivamente. El orden inicial es aleatorio.</p>
            <p>Termina cuando quedan menos selecciones libres que participantes.</p>
            <p><b>Prepara tu cola:</b> desde que te unes, en la sala de espera puedes ordenar tus selecciones favoritas. También puedes editarla durante el draft.</p>
          </Faq>

          <Faq q="⏱ ¿Draft con tiempo o libre?">
            <p>El admin elige antes de empezar:</p>
            <Bullet><b>Libre</b>: sin límite de tiempo por turno.</Bullet>
            <Bullet><b>Con tiempo</b> (2 min, 1 h o 24 h): si no eliges antes de que acabe tu turno, el sistema coge automáticamente <b>la primera selección disponible de tu cola</b>.</Bullet>
            <p>El autopick funciona aunque tengas la app cerrada — ideal si jugáis desde distintas zonas horarias.</p>
          </Faq>

          <Faq q="⚽ ¿Cómo se puntúa en fase de grupos?">
            <p className="font-semibold">Por resultado del partido:</p>
            <Bullet>✅ Victoria: +2 puntos al propietario del equipo ganador</Bullet>
            <Bullet>🤝 Empate: +1 punto a cada propietario. Si tienes <b>los dos equipos</b>, recibes +2 en total.</Bullet>
            <Bullet>Si una selección no tiene dueño, esos puntos no se asignan.</Bullet>

            <p className="font-semibold mt-2">🎯 Porra del marcador:</p>
            <Bullet>Antes de cada partido predices el resultado exacto (goles local - goles visitante).</Bullet>
            <Bullet>Si aciertas y tu rival no, <b>robas 1 punto</b> a tu rival.</Bullet>
            <Bullet>Si ambos aciertan o ambos fallan, no pasa nada.</Bullet>
            <Bullet>Si el rival no tiene dueño y aciertas, ganas <b>+1 pt</b> directamente.</Bullet>

            <p className="font-semibold mt-2">⭐ Jugadores destacados:</p>
            <Bullet>Eliges 3 jugadores de tu selección por partido.</Bullet>
            <Bullet>⚽ Gol (reglamentario o prórroga) = +1 · ⚽ Penalti en tanda = +0,5</Bullet>
            <Bullet>🟥 Expulsión = −1 · 🥅 Autogol = −1</Bullet>

            <p className="font-semibold mt-2">🏅 Bonificaciones por clasificación (acumulativas):</p>
            <Bullet>Octavos +1 · Cuartos +3 · Semifinales +5 · Final +8</Bullet>
            <Bullet>Campeón: +17 + los puntos que sume en la final</Bullet>
            <Bullet>Las bonificaciones se aplican <b>automáticamente</b> al terminar cada partido eliminatorio.</Bullet>
          </Faq>

          <Faq q="🏆 ¿Cómo se puntúa en eliminatorias?">
            <p className="font-semibold">Por resultado (90' + tiempo añadido):</p>
            <Bullet>✅ Victoria en tiempo reglamentario: +2 pts</Bullet>
            <Bullet>🤝 Empate al acabar el tiempo: +1 pt a cada propietario</Bullet>
            <Bullet>🏆 Equipo clasificado (pase como pase): +2 pts adicionales al propietario del que avanza</Bullet>
            <p className="text-xs text-[var(--text-secondary)] mt-1">Ejemplo: si tu equipo gana en prórroga, recibes +1 (empate en 90') + +2 (clasificado) = 3 pts por resultado.</p>

            <p className="font-semibold mt-2">⭐ Jugadores destacados (puntuación completa):</p>
            <Bullet>⚽ Gol (90' o prórroga) = +1 · ⚽ Penalti en tanda = +0,5</Bullet>
            <Bullet>🎯 Asistencia = +0,5</Bullet>
            <Bullet>🧤 Portería a cero (Portero) = +2 · 🛡️ Portería a cero (Defensa) = +1</Bullet>
            <Bullet>❌ Penalti fallado (90'/prórroga) = −0,5 · ❌ Penalti fallado (tanda) = −0,25</Bullet>
            <Bullet>🟥 Expulsión = −1 · 🥅 Autogol = −1</Bullet>

            <p className="font-semibold mt-2">🎯 Porra en eliminatorias:</p>
            <Bullet>Predices el marcador al acabar los 90' (sin contar prórroga ni penaltis).</Bullet>
            <Bullet>Funciona igual que en grupos: +1 si aciertas y el rival no.</Bullet>
          </Faq>

          <Faq q="🤝 ¿Y si hay empate a puntos?">
            <p>Se desempata por, en este orden:</p>
            <Bullet>1️⃣ Más porras acertadas</Bullet>
            <Bullet>2️⃣ Más puntos por jugadores destacados</Bullet>
            <Bullet>3️⃣ Más victorias de sus selecciones</Bullet>
            <p>Puedes tocar a cualquier jugador de la tabla para ver el <b>desglose</b> de sus puntos.</p>
          </Faq>

          <Faq q="📅 ¿Hasta cuándo puedo poner porra y jugadores?">
            <p>La porra y los 3 jugadores destacados se envían el día anterior al partido.</p>
            <Bullet>Se <b>bloquean 2 horas antes</b> del inicio. Después no se pueden cambiar.</Bullet>
            <Bullet>Recibirás un aviso en la pestaña Partidos de los encuentros sin completar (entre 24h y 2h antes).</Bullet>
            <Bullet>Las elecciones de todos los jugadores se revelan <b>1 hora antes</b> del partido.</Bullet>
          </Faq>

          <Faq q="📺 ¿Cómo se actualiza el marcador en directo?">
            <p>Los resultados se sincronizan automáticamente con una fuente de datos oficial durante los partidos.</p>
            <Bullet>Los goles y expulsiones aparecen en la tarjeta del partido en tiempo real.</Bullet>
            <Bullet>Los puntos se calculan automáticamente al terminar el partido.</Bullet>
            <Bullet>Puedes forzar una actualización con el botón 🔄 en la cabecera de la tabla.</Bullet>
          </Faq>

          <Faq q="🌍 ¿Cómo veo las fases del Mundial?">
            <p>En la pestaña <b>Mundial</b> tienes dos vistas:</p>
            <Bullet><b>Fase de grupos</b>: las 12 tablas con puntos, diferencia de goles y clasificados.</Bullet>
            <Bullet><b>Eliminatorias</b>: el cuadro en formato diagrama (de Ronda de 32 a la Final). Hasta que terminen los grupos, los cruces se muestran <b>proyectados</b> según las posiciones provisionales.</Bullet>
          </Faq>

          <Faq q="🛠 ¿Qué puedo hacer en la app?">
            <Bullet><b>Mis equipos</b>: ver tus selecciones y sus plantillas (con fotos y estadísticas). También las de otros jugadores.</Bullet>
            <Bullet><b>Partidos</b>: pestañas de pendientes (poner porra/jugadores) y finalizados (resumen de tu porra y tus jugadores).</Bullet>
            <Bullet><b>Tabla</b>: clasificación con desglose de puntos y top goleadores.</Bullet>
            <Bullet><b>Ajustes</b> (⚙️): cambiar tu nombre o salir de la liga.</Bullet>
            <Bullet>El <b>admin</b> introduce resultados, eventos de jugadores, asigna los cruces eliminatorios y otorga las bonificaciones.</Bullet>
          </Faq>

          {wildcardEnabled && (
            <Faq q="⚡ Modo Wildcard">
              <p>Si no eres propietario de ninguno de los dos equipos de una eliminatoria, puedes entrar como Wildcard y seguir compitiendo.</p>

              <p className="font-semibold mt-2">💸 Coste de entrada (según tu posición en la tabla):</p>
              <Bullet>🥇 1.º – 2.º puesto: <b>−2 puntos</b></Bullet>
              <Bullet>🥉 3.º – 5.º puesto: <b>−1 punto</b></Bullet>
              <Bullet>👥 6.º en adelante: <b>Gratis</b></Bullet>

              <p className="font-semibold mt-2">¿Qué eliges?</p>
              <Bullet><b>🏆 ¿Quién pasa?</b> El equipo que crees que se clasifica. Si aciertas: <b>+2 pts</b>.</Bullet>
              <Bullet><b>🎯 Porra:</b> Marcador exacto al acabar los 90'. Si aciertas: <b>+1 pt</b>.</Bullet>

              <p className="font-semibold mt-2">⭐ 3 jugadores destacados (puntuación igual que los propietarios):</p>
              <Bullet>⚽ Gol (90'/prórroga) = +1 · ⚽ Penalti tanda = +0,5</Bullet>
              <Bullet>🎯 Asistencia = +0,5</Bullet>
              <Bullet>🧤 Portería a cero (Portero) = +2 · 🛡️ Portería a cero (Defensa) = +1</Bullet>
              <Bullet>❌ Penalti fallado (90'/prórroga) = −0,5 · ❌ Penalti fallado (tanda) = −0,25</Bullet>
              <Bullet>🟥 Expulsión = −1 · 🥅 Autogol = −1</Bullet>
            </Faq>
          )}
        </div>
      </div>
    </div>
  )
}

function Faq({ q, children, defaultOpen = false }: { q: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors">
        <span className="font-bold text-sm">{q}</span>
        <span className="text-[var(--text-secondary)] text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-1.5 text-sm text-[var(--text-primary)]">{children}</div>
      )}
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <p className="flex gap-2"><span>•</span><span className="flex-1">{children}</span></p>
}
