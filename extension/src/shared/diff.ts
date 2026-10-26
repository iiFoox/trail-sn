/**
 * Diferença linha a linha entre dois textos (scripts, descrições longas), sem dependências.
 * LCS clássico por linha; acima de ~4 milhões de células cai para um corte por prefixo/sufixo comum,
 * que ainda mostra o trecho alterado de forma honesta.
 */
export type Op = { t: 'eq' | 'del' | 'add'; text: string; a?: number; b?: number; /** trecho alterado dentro da linha, para destacar */ mark?: [number, number] };
export interface Diff { ops: Op[]; added: number; removed: number }

export function looksLong(a: string, b: string): boolean {
  return a.includes('\n') || b.includes('\n') || a.length > 80 || b.length > 80;
}

export function diffLines(oldText: string, newText: string): Diff {
  const A = oldText.replace(/\r\n/g, '\n').split('\n');
  const B = newText.replace(/\r\n/g, '\n').split('\n');
  // Prefixo e sufixo comuns saem antes do LCS (é o caso mais comum: uma mudança no meio do script).
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a = A.slice(pre, A.length - suf), b = B.slice(pre, B.length - suf);
  const mid: Op[] = a.length * b.length > 4_000_000 ? [...a.map((text) => ({ t: 'del' as const, text })), ...b.map((text) => ({ t: 'add' as const, text }))] : lcs(a, b);
  const ops: Op[] = [...A.slice(0, pre).map((text) => ({ t: 'eq' as const, text })), ...mid, ...A.slice(A.length - suf).map((text) => ({ t: 'eq' as const, text }))];
  // Numeração das linhas nos dois lados.
  let na = 0, nb = 0;
  for (const o of ops) {
    if (o.t !== 'add') o.a = ++na;
    if (o.t !== 'del') o.b = ++nb;
  }
  markPairs(ops);
  return { ops, added: ops.filter((o) => o.t === 'add').length, removed: ops.filter((o) => o.t === 'del').length };
}

function lcs(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'eq', text: a[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ t: 'del', text: a[i++]! });
    else out.push({ t: 'add', text: b[j++]! });
  }
  while (i < n) out.push({ t: 'del', text: a[i++]! });
  while (j < m) out.push({ t: 'add', text: b[j++]! });
  return out;
}

/** Linhas removidas seguidas de adicionadas: marca só o pedaço que mudou dentro de cada par. */
function markPairs(ops: Op[]): void {
  for (let i = 0; i < ops.length; ) {
    if (ops[i]!.t !== 'del') { i++; continue; }
    let d = i; while (d < ops.length && ops[d]!.t === 'del') d++;
    let e = d; while (e < ops.length && ops[e]!.t === 'add') e++;
    const pairs = Math.min(d - i, e - d);
    for (let k = 0; k < pairs; k++) {
      const x = ops[i + k]!, y = ops[d + k]!;
      let p = 0; while (p < x.text.length && p < y.text.length && x.text[p] === y.text[p]) p++;
      let s = 0; while (s < x.text.length - p && s < y.text.length - p && x.text[x.text.length - 1 - s] === y.text[y.text.length - 1 - s]) s++;
      x.mark = [p, x.text.length - s];
      y.mark = [p, y.text.length - s];
    }
    i = e;
  }
}

/** As primeiras linhas que mudaram, sem as em branco (uma linha vazia acrescentada não diz nada sobre a mudança). */
export function changedLines(d: Diff, max = 3): Op[] {
  const changed = d.ops.filter((o) => o.t !== 'eq');
  const filled = changed.filter((o) => o.text.trim());
  return (filled.length ? filled : changed).slice(0, max);
}

/** Agrupa em trechos com algumas linhas de contexto; o resto vira "N linhas iguais". */
export type Hunk = { kind: 'ops'; ops: Op[] } | { kind: 'gap'; count: number; from: number };
export function hunks(ops: Op[], context = 3): Hunk[] {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => { if (o.t !== 'eq') for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true; });
  const out: Hunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (keep[i]) { const start = i; while (i < ops.length && keep[i]) i++; out.push({ kind: 'ops', ops: ops.slice(start, i) }); }
    else { const start = i; while (i < ops.length && !keep[i]) i++; out.push({ kind: 'gap', count: i - start, from: start }); }
  }
  return out;
}
