'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Team } from '../types'

export default function DraftQueueEditor({
  leagueId, playerId, takenTeamIds = [], defaultOpen = false, onPick,
}: {
  leagueId: string
  playerId: string
  takenTeamIds?: string[]
  defaultOpen?: boolean
  onPick?: (team: Team) => void  // si se pasa, permite abrir panel de confirmación desde la cola
}) {
  const [open, setOpen]     = useState(defaultOpen)
  const [teams, setTeams]   = useState<Team[]>([])
  const [queue, setQueue]   = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'alpha' | 'group'>('alpha')
  const [saved, setSaved]   = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('teams').select('*').order('name'),
      supabase.from('draft_queue').select('team_id, rank').eq('player_id', playerId).order('rank'),
    ]).then(([tRes, qRes]) => {
      const allTeams = tRes.data ?? []
      setTeams(allTeams)
      const savedQueue = (qRes.data ?? []).map(r => r.team_id)
      setQueue(savedQueue)
      setLoaded(true)
    })
  }, [playerId])

  const [userEdited, setUserEdited] = useState(false)

  // Guardar con debounce — solo si el usuario modificó la cola manualmente
  useEffect(() => {
    if (!loaded || !userEdited) return
    const id = setTimeout(async () => {
      await supabase.from('draft_queue').delete().eq('player_id', playerId)
      if (queue.length) {
        await supabase.from('draft_queue').insert(
          queue.map((team_id, i) => ({ league_id: leagueId, player_id: playerId, team_id, rank: i + 1 }))
        )
      }
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    }, 800)
    return () => clearTimeout(id)
  }, [queue, leagueId, playerId, loaded, userEdited])

  const taken = new Set(takenTeamIds)
  const teamById = Object.fromEntries(teams.map(t => [t.id, t]))
  const available = teams
    .filter(t => !queue.includes(t.id) && t.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortBy === 'group'
      ? (a.group_name ?? '').localeCompare(b.group_name ?? '') || a.name.localeCompare(b.name, 'es')
      : a.name.localeCompare(b.name, 'es')
    )

  const edit = (fn: (q: string[]) => string[]) => { setUserEdited(true); setQueue(fn) }
  const add = (id: string) => edit(q => [...q, id])
  const remove = (id: string) => edit(q => q.filter(x => x !== id))
  const move = (i: number, dir: -1 | 1) => edit(q => {
    const j = i + dir
    if (j < 0 || j >= q.length) return q
    const c = [...q];[c[i], c[j]] = [c[j], c[i]]; return c
  })

  // Nº disponibles en cola (no tomados)
  const liveCount = queue.filter(id => !taken.has(id)).length

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden mb-4">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors">
        <span className="text-sm font-bold">🎯 Mi cola de preferencias {queue.length > 0 && <span className="text-[var(--text-secondary)] font-normal">({liveCount} libres)</span>}</span>
        <span className="text-[var(--text-secondary)] text-xs flex items-center gap-2">
          {saved && <span className="text-[var(--green)]">✓ Guardado</span>}
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-[var(--border)] pt-3">
          <p className="text-xs text-[var(--text-secondary)] mb-3">
            Ordena tus selecciones favoritas. Si no eliges a tiempo en tu turno, se cogerá la primera de esta lista que siga libre.
          </p>

          {/* Cola ordenada */}
          {queue.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {queue.map((id, i) => {
                const t = teamById[id]
                const isTaken = taken.has(id)
                return (
                  <div key={id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isTaken ? 'bg-[var(--bg-elevated)]/40 opacity-50' : 'bg-[var(--bg-elevated)]'}`}>
                    <span className="w-5 text-center text-xs font-bold text-[var(--accent-glow)]">{i + 1}</span>
                    {onPick && !isTaken ? (
                      <button
                        onClick={() => t && onPick(t)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-[var(--accent)] transition-colors group"
                        title="Elegir ahora"
                      >
                        <span className="text-lg">{t?.flag_emoji}</span>
                        <span className="flex-1 text-sm truncate">{t?.name}</span>
                        <span className="text-[10px] text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Elegir →</span>
                      </button>
                    ) : (
                      <>
                        <span className="text-lg">{t?.flag_emoji}</span>
                        <span className={`flex-1 text-sm truncate ${isTaken ? 'line-through' : ''}`}>{t?.name}</span>
                        {isTaken && <span className="text-[10px] text-[var(--red)]">tomada</span>}
                      </>
                    )}
                    <button onClick={() => move(i, -1)} disabled={i === 0}
                      className="text-[var(--text-secondary)] hover:text-white disabled:opacity-20 px-1">▲</button>
                    <button onClick={() => move(i, 1)} disabled={i === queue.length - 1}
                      className="text-[var(--text-secondary)] hover:text-white disabled:opacity-20 px-1">▼</button>
                    <button onClick={() => remove(id)} className="text-[var(--red)] hover:opacity-75 px-1">✕</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Disponibles para añadir */}
          <div className="flex gap-2 mb-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar selección…"
              className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]" />
            <button onClick={() => setSortBy('alpha')}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${sortBy === 'alpha' ? 'border-[var(--accent)] text-white' : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-white'}`}>
              A→Z
            </button>
            <button onClick={() => setSortBy('group')}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${sortBy === 'group' ? 'border-[var(--accent)] text-white' : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-white'}`}>
              Grupo
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto">
            {available.map(t => {
              const isTaken = taken.has(t.id)
              return (
                <button key={t.id} onClick={() => add(t.id)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left text-sm transition-colors ${
                    isTaken ? 'border-[var(--border)] opacity-40' : 'border-[var(--border)] hover:border-[var(--accent)]'}`}>
                  {t.group_name && <span className="text-[10px] text-gray-500 shrink-0 font-medium">{t.group_name}</span>}
                  <span>{t.flag_emoji}</span>
                  <span className={`truncate text-xs ${isTaken ? 'line-through' : ''}`}>{t.name}</span>
                  <span className="ml-auto text-[var(--accent-glow)]">+</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
