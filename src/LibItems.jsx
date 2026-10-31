export const TYPE = { decision: 'Decision', open: 'Question', assumption: 'Assumption', todo: 'To do', idea: 'Idea', fact: 'Fact', preference: 'Preference' }

export default function Items({ ids, v }) {
  return (
    <ul className="lib-items">
      {ids.map(x => v.items[x]).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date)).map(i => (
        <li key={i.id}>
          <span className="tag dashed">{TYPE[i.type]}</span>{!i.filed && i.branch !== 'none' && <span className="tag dashed" title="Placed by a rule that hasn't yet proven itself in spot checks">best guess</span>}<span className="sub">{i.date}{i.who ? ' · ' + i.who : ''}</span>
          <p>{i.text}</p>
          {i.quote && <blockquote>“{i.quote}”<cite>{i.file}{i.at ? ' at ' + i.at : ''}</cite></blockquote>}
        </li>
      ))}
    </ul>
  )
}
