// Bateria v2 de escopos: roda os casos de localStorage.pt_v2cases no perfil da sessão (admin ou personificado) com o
// bundle de regressão (TrailRegression) e classifica cada caso com uma letra:
//   C causa certa (tipo e nome esperados na evidência principal)
//   K candidata honesta: "quem gravou" (user_action) em grau candidato, sem nomear outra automação
//   k outra evidência só em grau candidato (sugestão fraca, não afirma)
//   W evidência provável/confirmada que não é a esperada (afirmou algo errado)
//   N registro não legível para o perfil      F campo fora do histórico do formulário (sem auditoria)
//   Z registro legível, mas nenhuma mudança no campo   E erro técnico
// Casos expectNoChange (a automação falhou e nada mudou): C quando não há mudança; W se o Trail mostrar alguma causa.
// Uso: window.__runV2('admin') — resultado em localStorage['pt_v2res_<perfil>'] (compacto) e window.__v2res.
window.__runV2 = async (perfil) => {
  const cases = JSON.parse(localStorage.pt_v2cases);
  const t0 = Date.now();
  const r = await TrailRegression.runDifferential(cases.map((c) => ({ id: c.id, table: c.table, sysId: c.sysId, field: c.field })));
  const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
  const det = [];
  let codes = '';
  for (const c of cases) {
    const it = by[c.id];
    let k;
    if (!it || !it.ok) k = /not found|not readable|indispon|unavailable/i.test(it?.error || '') ? 'N' : 'E';
    else {
      const ch = it.changes[0];
      const top = ch && ch.topEvidence;
      if (c.expectNoChange) k = !ch ? 'C' : top && top.grade !== 'candidate' && top.type !== 'user_action' ? 'W' : 'K';
      else if (!ch) k = it.fieldNotInHistory ? 'F' : 'Z';
      else if (top && top.type === c.expectedType && (!c.expectedNames.length || c.expectedNames.some((n) => top.artifactName.includes(n)))) k = 'C';
      else if (!top || (top.type === 'user_action' && top.grade === 'candidate')) k = 'K';
      else if (top.grade === 'candidate') k = 'k';
      else k = 'W';
      if (k !== 'C' && !(k === 'K' && perfil !== 'admin')) det.push(`${c.id}:${k}:${top ? `${top.type}/${top.grade}/${top.score}/${top.artifactName}` : '-'}:${it.auditFrom || ''}:${it.changeCount}`);
    }
    if (k === 'E') det.push(`${c.id}:E:${(it && it.error) || 'sem resultado'}`);
    codes += k;
  }
  const ms = r.results.map((x) => x.ms).sort((a, b) => a - b);
  const out = { perfil, n: cases.length, access: r.access, denied: r.denied, medianMs: ms[Math.floor(ms.length / 2)], p95Ms: ms[Math.floor(ms.length * 0.95)], maxMs: ms[ms.length - 1], totalS: Math.round((Date.now() - t0) / 1000), codes, det };
  localStorage['pt_v2res_' + perfil] = JSON.stringify(out);
  window.__v2res = out;
  return out;
};
'rodar-v2 ok';
