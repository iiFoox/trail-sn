/**
 * "Quem enxerga este registro": para uma pessoa (pelo usuário, ou "eu"), se ela vê o registro e por quê —
 * regras que filtram a lista antes da consulta, regras de acesso (ACL) de tabela e de campo, domínio.
 * Limite honesto: regras com script não são avaliadas, e isso é dito.
 */
import { describeVisibility, type Visibility, type VisibilityVerdict } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { DEMO_PEOPLE, demoVisibility } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { ErrorMsg } from './ErrorMsg';
import { Fold } from './Fold';
import { demoParam, isDemo, lang } from './format';

const P = t(getPrefs().lang).p;
const U = P.ux;
const str = (x: unknown) => x as Record<string, string>;
const TONE: Record<VisibilityVerdict, string> = { ve: 'ok', provavel_ve: 'ok', nao_ve: 'bad', provavel_nao_ve: 'bad', nao_da_para_afirmar: 'unk' };

/** Os motivos do motor (códigos) em frases curtas; "filter_hides:incident query" vira "A regra "incident query" esconde...". */
export function visibilityReasons(v: Visibility): { tone: 'ok' | 'bad' | 'unk'; text: string }[] {
  const R = str(U.visWhy);
  return v.combined.why.map((code) => {
    const [k, name = ''] = code.split(/:(.*)/s);
    const text = fmt(R[k!] ?? code, { name });
    const tone = /_ok$/.test(k!) ? 'ok' : /hides|fail/.test(k!) ? 'bad' : 'unk';
    return { tone, text } as const;
  });
}

export function WhoSees({ table, sysId, field, display, origin, me, people }: { table: string; sysId: string; field: string; display: string; origin: string; me?: string; people: string[] }) {
  const auto = demoParam('visibility');
  const [user, setUser] = useState(auto && auto !== '1' ? auto : auto === '1' ? 'abel.tuter' : '');
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<Visibility>();
  const [err, setErr] = useState('');
  const run = async (u = user) => {
    const who = u.trim();
    if (!who) return;
    setSt('run');
    try {
      const out = isDemo ? await demoVisibility(who) : await send<Visibility & { error?: string }>({ type: 'visibility', origin, tabId: trackedTab(), target: { table, sysId, user: who, field } });
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  useEffect(() => { if (auto) void run(); }, []);
  const suggest = [...new Set([...(isDemo ? DEMO_PEOPLE : []), ...people])];
  const myself = me ?? (isDemo ? 'admin' : undefined);
  const name = res?.user?.name || res?.user?.userName || user;
  const verdict = res?.combined.verdict;
  const reasons = res ? visibilityReasons(res) : [];
  return (
    <div class="box vis" id="who-sees">
      <h4>{U.visTitle}</h4>
      <div class="pad small muted">{fmt(U.visHint, { rec: display })}</div>
      <div class="pad vis-in">
        <input type="search" list="trail-people" value={user} placeholder={U.visPlaceholder} aria-label={U.visPlaceholder} autocomplete="off"
          onInput={(e) => setUser((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void run(); } }} />
        <datalist id="trail-people">{suggest.map((p) => <option value={p} />)}</datalist>
        {myself && <button class="btn sm" onClick={() => { setUser(myself); void run(myself); }} title={myself}>{U.visMe}</button>}
        <button class="btn primary sm" disabled={!user.trim() || st === 'run'} onClick={() => void run()}>{Glyph.search} {U.visRun}</button>
      </div>
      {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{U.visLoading}</span></div>}
      {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /></span></div>}
      {st === 'done' && res && verdict && (
        <>
          <div class={`li vis-verdict ${TONE[verdict]}`}>
            <span class="ck">{TONE[verdict] === 'ok' ? Glyph.check : TONE[verdict] === 'bad' ? '✕' : '?'}</span>
            <div class="grow"><b>{fmt(str(U.visVerdict)[verdict] ?? '', { name, rec: display })}</b>
              {res.userRoles?.known && <div class="det">{res.userRoles.names.length ? fmt(U.visRoles, { roles: res.userRoles.names.slice(0, 8).join(', ') }) : U.visNoRoles}</div>}
              {res.notes.includes('user_inactive') && <div class="det">{U.visInactive}</div>}
            </div>
          </div>
          {reasons.length > 0 && <Fold nested cls="vis-reasons" icon={Glyph.search} title={U.foldWhy} count={reasons.length}
            hint={reasons.length > 1 ? reasons.find((x) => x.tone === (TONE[verdict] === 'ok' ? 'ok' : 'bad'))?.text ?? reasons[0]!.text : undefined}>
            {reasons.map((x) => <div class={`li vis-why ${x.tone}`}><span class={`ck ${x.tone === 'bad' ? 'x' : x.tone === 'unk' ? 'w' : ''}`}>{x.tone === 'ok' ? Glyph.check : x.tone === 'bad' ? '✕' : '?'}</span><span class="grow small">{x.text}</span></div>)}
          </Fold>}
          <div class="li"><span class="grow small muted">{U.visLimit}</span></div>
          <Fold nested open={false} icon={Glyph.shield} title={U.visDetail}>
            <div class="pad vis-detail small">{describeVisibility(res, lang)}</div>
          </Fold>
        </>
      )}
    </div>
  );
}
