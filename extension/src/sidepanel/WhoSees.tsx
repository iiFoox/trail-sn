/**
 * "Quem enxerga este registro" (recolhido até abrir): para uma pessoa (pelo nome, pelo usuário, ou "eu"), se ela vê o registro e por quê —
 * regras que filtram a lista antes da consulta, regras de acesso (ACL) de tabela e de campo, domínio.
 * Limite honesto: regras com script não são avaliadas, e isso é dito.
 */
import { describeVisibility, type UserMatch, type UserSearch, type Visibility, type VisibilityVerdict } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DEMO_PEOPLE, demoFindUsers, demoVisibility } from '../shared/demo';
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

/** Sugestões enquanto digita: pessoas ativas pelo nome, sobrenome ou user_name (mesma busca do motor), com intervalo. */
function useUserSuggest(origin: string, text: string, skip: boolean): { list: UserMatch[]; busy: boolean } {
  const [list, setList] = useState<UserMatch[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = text.trim();
    // A partir de 3 letras e 600 ms depois da última tecla: cada busca percorre a sys_user (centenas de milhares de
    // pessoas numa empresa grande).
    if (skip || q.length < 3) { setList([]); setBusy(false); return undefined; }
    let alive = true;
    setBusy(true);
    const id = setTimeout(async () => {
      try {
        const out = isDemo ? await demoFindUsers(q) : await send<UserSearch & { error?: string }>({ type: 'find-users', origin, text: q });
        if (alive) setList(out?.users ?? []);
      } catch { if (alive) setList([]); }
      if (alive) setBusy(false);
    }, 600);
    return () => { alive = false; clearTimeout(id); };
  }, [origin, text, skip]);
  return { list, busy };
}

const personLabel = (u: UserMatch) => u.name || u.userName || u.sysId;

export function WhoSees({ table, sysId, field, display, origin, me, people }: { table: string; sysId: string; field: string; display: string; origin: string; me?: string; people: string[] }) {
  const auto = demoParam('visibility');
  const [user, setUser] = useState(auto && auto !== '1' ? auto : auto === '1' ? 'abel.tuter' : '');
  // Pessoa escolhida na lista (o texto mostra o nome; a análise vai pelo sys_id).
  const [picked, setPicked] = useState<UserMatch>();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<Visibility>();
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const run = async (u: string = picked?.sysId ?? user) => {
    const who = u.trim();
    if (!who) return;
    setOpen(false);
    setSt('run');
    try {
      const out = isDemo ? await demoVisibility(who) : await send<Visibility & { error?: string }>({ type: 'visibility', origin, tabId: trackedTab(), target: { table, sysId, user: who, field } });
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  useEffect(() => { if (auto) void run(); }, []);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, []);
  const { list: found, busy } = useUserSuggest(origin, user, !!picked || !open);
  // Sem texto: as pessoas que aparecem neste registro (e as do demo).
  const recent: UserMatch[] = [...new Set([...(isDemo ? DEMO_PEOPLE : []), ...people])].map((u) => ({ sysId: u, userName: u }));
  const list = user.trim().length >= 2 ? found : recent.filter((u) => !user || u.userName!.startsWith(user));
  const choose = (u: UserMatch) => { setPicked(u); setUser(personLabel(u)); setOpen(false); void run(u.sysId === u.userName ? u.userName : u.sysId); };
  const myself = me ?? (isDemo ? 'admin' : undefined);
  const name = res?.user?.name || res?.user?.userName || user;
  const verdict = res?.combined.verdict;
  const reasons = res ? visibilityReasons(res) : [];
  const notFound = res?.notes.includes('user_not_found');
  const ambiguous = res?.notes.includes('user_ambiguous') ? res.candidates ?? [] : [];
  return (
    <Fold cls="vis" id="who-sees" title={U.visTitle} open={!!auto} hint={st === 'done' && verdict && !notFound && !ambiguous.length ? fmt(str(U.visVerdict)[verdict] ?? '', { name, rec: display }) : undefined}>
      <div class="pad vis-in" ref={box}>
        <div class="vis-field">
          <input type="search" value={user} placeholder={U.visPlaceholder} aria-label={U.visPlaceholder} autocomplete="off" role="combobox" aria-expanded={open && list.length > 0} aria-autocomplete="list"
            onFocus={() => setOpen(true)}
            onInput={(e) => { setUser((e.target as HTMLInputElement).value); setPicked(undefined); setHi(0); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(list.length - 1, h + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
              else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
              else if (e.key === 'Enter') { e.preventDefault(); const o = open && list.length > 0 && hi >= 0 ? list[hi] : undefined; if (o && (found.length > 0 || !user.trim())) choose(o); else void run(); }
            }} />
          {open && (list.length > 0 || busy) && (
            <ul class="combo-list vis-sug" role="listbox">
              {busy && !list.length && <li class="muted small">{U.visSearching}</li>}
              {list.map((u, i) => (
                <li role="option" aria-selected={i === hi} class={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); choose(u); }}>
                  <span class="cl">{personLabel(u)}</span>{u.userName && u.userName !== personLabel(u) && <span class="ck2">{u.userName}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {myself && <button class="btn sm" onClick={() => { setPicked(undefined); setUser(myself); void run(myself); }} title={myself}>{U.visMe}</button>}
        <button class="btn primary sm" disabled={!user.trim() || st === 'run'} onClick={() => void run()}>{Glyph.search} {U.visRun}</button>
      </div>
      {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{U.visLoading}</span></div>}
      {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /></span></div>}
      {st === 'done' && res && notFound && <div class="li vis-verdict unk"><span class="ck w">?</span><b class="grow">{U.visNotFound}</b></div>}
      {st === 'done' && res && ambiguous.length > 0 && (
        <div class="li vis-pick"><span class="ck w">?</span><div class="grow"><b>{U.visPick}</b>
          <div class="vis-cands">{ambiguous.map((u) => <button class="btn sm" onClick={() => choose(u)}>{personLabel(u)}{u.userName && <small class="muted"> · {u.userName}</small>}</button>)}</div>
        </div></div>
      )}
      {st === 'done' && res && verdict && !notFound && !ambiguous.length && (
        <>
          <div class={`li vis-verdict ${TONE[verdict]}`}>
            <span class="ck">{TONE[verdict] === 'ok' ? Glyph.check : TONE[verdict] === 'bad' ? '✕' : '?'}</span>
            <div class="grow"><b>{fmt(str(U.visVerdict)[verdict] ?? '', { name, rec: display })}</b>
              {res.userRoles?.known && <div class="det">{res.userRoles.names.length ? fmt(U.visRoles, { roles: res.userRoles.names.slice(0, 8).join(', ') }) : U.visNoRoles}</div>}
              {res.notes.includes('user_inactive') && <div class="det">{U.visInactive}</div>}
            </div>
          </div>
          {/* Os motivos, o limite e o detalhe ficam juntos em "Por quê", recolhido. */}
          <Fold nested cls="vis-reasons" icon={Glyph.search} title={U.foldWhy} count={reasons.length || undefined} open={false}>
            {reasons.map((x) => <div class={`li vis-why ${x.tone}`}><span class={`ck ${x.tone === 'bad' ? 'x' : x.tone === 'unk' ? 'w' : ''}`}>{x.tone === 'ok' ? Glyph.check : x.tone === 'bad' ? '✕' : '?'}</span><span class="grow small">{x.text}</span></div>)}
            <div class="li"><span class="grow small muted">{U.visLimit}</span></div>
            <Fold nested open={false} cls="vis-detail-fold" icon={Glyph.shield} title={U.visDetail}>
              <div class="pad vis-detail small">{describeVisibility(res, lang)}</div>
            </Fold>
          </Fold>
        </>
      )}
    </Fold>
  );
}
