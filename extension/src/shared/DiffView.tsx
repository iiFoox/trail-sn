import { useMemo, useState } from 'preact/hooks';
import { diffLines, hunks, type Op } from './diff';

export interface DiffLabels { onlyChanges: string; whole: string; same: string; added: string; removed: string; before: string; after: string }

function Line({ o, side }: { o: Op | undefined; side?: 'a' | 'b' }) {
  if (!o) return <div class="dl blank"><span class="n" /><code /></div>;
  const n = side === 'a' ? o.a : side === 'b' ? o.b : (o.t === 'add' ? o.b : o.a);
  const sign = o.t === 'add' ? '+' : o.t === 'del' ? '−' : ' ';
  const txt = o.text || ' ';
  const body = o.mark && o.mark[1] > o.mark[0]
    ? <>{txt.slice(0, o.mark[0])}<mark>{txt.slice(o.mark[0], o.mark[1])}</mark>{txt.slice(o.mark[1])}</>
    : txt;
  return <div class={`dl ${o.t}`}><span class="n">{n}</span>{!side && <span class="s">{sign}</span>}<code>{body}</code></div>;
}

/** Diferença entre dois textos: unificada (painel estreito) ou lado a lado (janela). */
export function DiffView({ oldText, newText, split = false, labels }: { oldText: string; newText: string; split?: boolean; labels: DiffLabels }) {
  const d = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const [whole, setWhole] = useState(false);
  const parts = whole ? [{ kind: 'ops' as const, ops: d.ops }] : hunks(d.ops);
  return (
    <div class={`diff ${split ? 'split' : 'uni'}`}>
      <div class="dbar">
        <span class="stat"><b class="add">+{d.added}</b> {labels.added} · <b class="del">−{d.removed}</b> {labels.removed}</span>
        <div class="seg2 sm" role="group">
          <button aria-pressed={!whole} onClick={() => setWhole(false)}>{labels.onlyChanges}</button>
          <button aria-pressed={whole} onClick={() => setWhole(true)}>{labels.whole}</button>
        </div>
      </div>
      {split && <div class="dhead"><span>{labels.before}</span><span>{labels.after}</span></div>}
      <div class="dbody">
        {parts.map((h) => h.kind === 'gap'
          ? <button class="dgap" onClick={() => setWhole(true)}>⋯ {h.count} {labels.same}</button>
          : split ? <SplitRows ops={h.ops} /> : h.ops.map((o) => <Line o={o} />))}
      </div>
    </div>
  );
}

/** Lado a lado: linhas iguais nos dois lados; removidas à esquerda alinhadas com adicionadas à direita. */
function SplitRows({ ops }: { ops: Op[] }) {
  const rows: [Op | undefined, Op | undefined][] = [];
  for (let i = 0; i < ops.length; ) {
    const o = ops[i]!;
    if (o.t === 'eq') { rows.push([o, o]); i++; continue; }
    const dels: Op[] = [], adds: Op[] = [];
    while (i < ops.length && ops[i]!.t === 'del') dels.push(ops[i++]!);
    while (i < ops.length && ops[i]!.t === 'add') adds.push(ops[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push([dels[k], adds[k]]);
  }
  return <>{rows.map(([l, r]) => <div class="srow"><Line o={l} side="a" /><Line o={r} side="b" /></div>)}</>;
}
