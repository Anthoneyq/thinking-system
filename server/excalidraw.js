// Export the visible flow as an editable .excalidraw file: plain sans (fontFamily 2), clean lines (roughness 0).
export function toExcalidraw(run, positions) {
  const els = []
  let seed = 1
  const base = (type, x, y, w, h, extra = {}) => ({
    id: `${type}-${seed}`, type, x, y, width: w, height: h, angle: 0, strokeColor: '#111418', backgroundColor: 'transparent',
    fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : null, seed: seed++, version: 1, versionNonce: seed, isDeleted: false,
    boundElements: [], updated: Date.now(), link: null, locked: false, ...extra,
  })
  const text = (x, y, w, str, size, containerId = null) => base('text', x, y, w, size * 1.25 * str.split('\n').length, {
    text: str, originalText: str, fontSize: size, fontFamily: 2, textAlign: 'left', verticalAlign: 'top', containerId, lineHeight: 1.25, autoResize: true,
  })
  const wrap = (s, n = 34) => s.split(' ').reduce((acc, w) => {
    const line = acc.at(-1)
    if ((line + ' ' + w).trim().length > n) acc.push(w); else acc[acc.length - 1] = (line + ' ' + w).trim()
    return acc
  }, ['']).slice(0, 4).join('\n')

  const ids = {}
  for (const [id, p] of Object.entries(positions)) {
    const n = run.nodes[id]
    if (!n) continue
    const stroke = n.stuck ? '#E5484D' : n.status === 'waiting' ? '#2F54EB' : '#111418'
    const rect = base('rectangle', p.x, p.y, p.w, p.h, { strokeColor: stroke, strokeStyle: n.status === 'done' || n.status === 'waiting' ? 'solid' : 'dashed' })
    els.push(rect, text(p.x + 14, p.y + 12, p.w - 28, n.title, 18))
    const sum = n.out?.recommendation || n.out?.plain || n.out?.summary || n.status
    els.push(text(p.x + 14, p.y + 40, p.w - 28, wrap(String(sum)), 13))
    ids[id] = rect
  }
  for (const id of Object.keys(positions)) {
    const n = run.nodes[id]
    const from = n?.kind === 'unstick' ? [n.data.target] : n?.deps || []
    for (const d of from) {
      const a = positions[d], b = positions[id]
      if (!a || !b) continue
      const sx = a.x + a.w, sy = a.y + a.h / 2, ex = b.x, ey = b.y + b.h / 2
      els.push(base('arrow', sx, sy, ex - sx, ey - sy, {
        points: [[0, 0], [ex - sx, ey - sy]], endArrowhead: 'arrow', startArrowhead: null,
        strokeColor: n.kind === 'unstick' ? '#E5484D' : '#111418',
        startBinding: { elementId: ids[d].id, focus: 0, gap: 4 }, endBinding: { elementId: ids[id].id, focus: 0, gap: 4 },
      }))
    }
  }
  return { type: 'excalidraw', version: 2, source: 'thinking-system', elements: els, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} }
}
