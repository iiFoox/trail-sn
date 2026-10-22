/**
 * "Este salvamento levou X s": o tempo da gravação que fez a mudança, onde o tempo foi gasto e o que rodou nela.
 * Lê a transação (syslog_transaction) com o motor `saveTiming`; sem acesso, diz isso com a frase do motor.
 */
import { describeSaveTiming, type Change, type Investigation, type RanItem, type SaveTiming } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { demoSaveTiming } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { ErrorMsg } from './ErrorMsg';
import { Fold } from './Fold';
import { isDemo, lang, secs } from './format';

const P = t(getPrefs().lang).p;
const U = P.ux;
const str = (x: unknown) => x as Record<string, string>;

const RAN_ICON: Record<RanItem['kind'], preact.JSX.Element> = { br_before: typeGlyph.br_before, br_after: typeGlyph.br_after, br_async: typeGlyph.br_async, event: Glyph.event, flow: Glyph.flow };
const RAN_TABLE: Record<RanItem['kind'], string> = { br_before: 'sys_script', br_after: 'sys_script', br_async: 'sys_script', event: 'sysevent', flow: 'sys_flow_context' };

export function SaveTimingCard({ r, c, origin }: { r: Investigation; c: Change; origin: string }) {
  const [res, setRes] = useState<SaveTiming>();
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setRes(undefined); setErr('');
    (async () => {
      try {
        const out = isDemo ? await demoSaveTiming(c.at, c.checkpoint)
          : await send<SaveTiming & { error?: string }>({ type: 'save-timing', origin, tabId: trackedTab(), target: { table: r.target.table, sysId: r.target.sysId, at: c.at, checkpoint: c.checkpoint } });
        if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
        if (alive) setRes(out);
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [r.target.sysId, c.at, c.checkpoint, tick]);

  if (err) return <div class="box save-card"><h4>{U.saveTitle}</h4><div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /> <button class="link" onClick={() => setTick(tick + 1)}>{U.retry}</button></span></div></div>;
  if (!res) return <div class="box save-card"><h4>{U.saveTitle}</h4><div class="li"><span class="spin" /><span class="grow muted small">{U.saveLoading}</span></div></div>;
  const total = res.totalMs;
  const p = res.parts;
  // Barra das partes: regras, banco fora das regras, permissões, navegador, rede e fila (o resto é "outros").
  const sqlOutside = p.sql !== undefined && p.rules !== undefined ? Math.max(0, p.sql - p.rules) : p.sql;
  const seg = total ? ([['rules', p.rules], ['sql', p.rules !== undefined ? undefined : sqlOutside], ['acl', p.acl], ['client', p.client], ['network', p.network], ['wait', p.wait]] as [string, number | undefined][])
    .filter(([, v]) => v !== undefined && v > 0 && v / total >= 0.04).map(([k, v]) => [k, v!] as [string, number]) : [];
  const ran = res.ran;
  return (
    <div class={`box save-card v-${res.verdict}`}>
      <h4><span class="grow">{total !== undefined ? fmt(U.saveTook, { s: secs(total) }) : U.saveTitle}</span><span class={`pill sv-${res.verdict}`}>{str(U.saveVerdict)[res.verdict]}</span></h4>
      {seg.length > 0 && (
        <div class="pad">
          <div class="sbar" role="img" aria-label={seg.map(([k, v]) => `${str(U.savePart)[k]} ${secs(v)}`).join(', ')}>
            {seg.map(([k, v]) => <i class={`p-${k}`} style={`width:${Math.max(4, Math.round((v / total!) * 100))}%`} title={`${str(U.savePart)[k]}: ${secs(v)}`} />)}
          </div>
          <div class="slegend small">{seg.map(([k, v]) => <span><i class={`p-${k}`} />{str(U.savePart)[k]} {secs(v)}</span>)}</div>
        </div>
      )}
      {/* A explicação longa fica recolhida: o cabeçalho (tempo + veredito) e a barra já respondem. */}
      {total === undefined ? <div class="pad small save-text">{describeSaveTiming(res, lang)}</div>
        : <Fold nested cls="save-detail" open={false} icon={Glyph.clock} title={U.saveDetail}><div class="pad small save-text">{describeSaveTiming(res, lang)}</div></Fold>}
      {ran.length > 0 && (
        <Fold nested cls="save-ran" icon={Glyph.rule} title={U.saveRan} count={ran.length}>
          {ran.map((x) => (
            <div class="li">
              <span class="ck">{RAN_ICON[x.kind]}</span>
              <div class="grow">
                {x.sysId ? <a href={recordLink(origin, RAN_TABLE[x.kind], x.sysId)} target="_blank" rel="noreferrer">{x.name}</a> : <span>{x.name}</span>}
                <div class="det">{str(U.saveRanKind)[x.kind]} · {x.seen ? U.saveSeen : U.saveByCond}</div>
              </div>
            </div>
          ))}
        </Fold>
      )}
      {res.txSysId && <div class="pad small"><a href={recordLink(origin, 'syslog_transaction', res.txSysId)} target="_blank" rel="noreferrer">{Glyph.open} {U.saveOpenTx}</a></div>}
    </div>
  );
}
