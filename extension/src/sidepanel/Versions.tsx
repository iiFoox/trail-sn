/**
 * Aba "Versões": as versões salvas deste registro (sys_update_version) e, para a versão escolhida, os campos que mudaram
 * em relação à anterior. Só registros de configuração guardam versões; nos outros, a aba diz isso e aponta o Histórico.
 */
import type { RecordVersion, RecordVersions } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { looksLong } from '../shared/diff';
import { changedFields, parsePayload } from '../shared/versions';
import { ErrorMsg } from './ErrorMsg';
import { DiffOverlay, DiffSummary, humanField, refLink } from './Result';

const lang = getPrefs().lang;
const P = t(lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');

const when = (s: string) => {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const sourceText = (v: RecordVersion) =>
  v.source === 'update_set' ? fmt(P.vrFromSet, { name: v.sourceName ?? '' }) : v.source === 'upgrade' ? P.vrFromUpgrade : P.vrFromOther;

export function VersionsTab({ target, origin, title }: { target: { table: string; sysId: string }; origin: string; title: string }) {
  const [res, setRes] = useState<RecordVersions>();
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(-1);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const out = isDemo ? DEMO.list : await send<RecordVersions & { error?: string }>({ type: 'versions', origin, table: target.table, sysId: target.sysId });
        if (isDemo) await new Promise((x) => setTimeout(x, 450));
        if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
        if (alive) setRes(out);
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [target.sysId]);

  if (err) return <div class="box"><div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /></span></div></div>;
  if (!res) return <div class="box"><div class="li"><span class="spin" /><span class="grow muted small">{P.vrLoading}</span></div></div>;
  if (res.access === 'denied' || res.access === 'no_filter') return <div class="box"><div class="li"><span class="ck w">!</span><span class="grow small">{P.vrDenied}</span></div></div>;
  if (!res.versions.length) return <div class="box"><div class="li"><span class="ck">i</span><span class="grow small">{P.vrNone}</span></div></div>;
  return (
    <div class="stack vr">
      <div class="muted small">{P.vrIntro}</div>
      <div class="box vr-list">
        {res.versions.map((v, i) => (
          <>
            <button class={`li vr-row ${sel === i ? 'on' : ''}`} aria-expanded={sel === i} onClick={() => setSel(sel === i ? -1 : i)}>
              <span class="grow">
                <b>{when(v.at)}</b> <span class="muted">· {v.by}</span>
                {v.state === 'current' && <span class="tag">{P.vrCurrent}</span>}
                {v.action === 'DELETE' && <span class="tag a">{P.vrDeleted}</span>}
                <small class="muted vr-src">{sourceText(v)}</small>
              </span>
              <span class="vr-chev" aria-hidden="true">{Glyph.chevron}</span>
            </button>
            {sel === i && <VersionDiff origin={origin} version={v} previous={res.versions[i + 1]} title={title} />}
          </>
        ))}
      </div>
      {res.versions.length >= 50 && <div class="muted small">{fmt(P.vrLimit, { n: res.versions.length })}</div>}
    </div>
  );
}

function VersionDiff({ origin, version, previous, title }: { origin: string; version: RecordVersion; previous?: RecordVersion; title: string }) {
  const [rows, setRows] = useState<ReturnType<typeof changedFields>>();
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<{ at: { x: number; y: number }; field: string; before: string; after: string }>();
  useEffect(() => {
    if (!previous) return;
    let alive = true;
    (async () => {
      try {
        const out = isDemo ? DEMO.payloads : await send<Record<string, string> & { error?: string }>({ type: 'version-payloads', origin, sysIds: [version.sysId, previous.sysId] });
        if (out.error) throw new Error(out.error);
        if (alive) setRows(changedFields(parsePayload(out[previous.sysId] ?? ''), parsePayload(out[version.sysId] ?? '')));
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [version.sysId]);

  const link = <a class="see" href={refLink(origin, { table: 'sys_update_version', sysId: version.sysId })} target="_blank" rel="noreferrer">{P.vrOpen} {Glyph.open}</a>;
  if (!previous) return <div class="vr-body"><div class="muted small">{P.vrFirst}</div>{link}</div>;
  if (err) return <div class="vr-body"><ErrorMsg msg={err} /></div>;
  if (!rows) return <div class="vr-body"><span class="spin" /> <span class="muted small">{P.vrReading}</span></div>;
  const show = (x: { value: string; display?: string }) => x.display || x.value || P.vrEmptyValue;
  return (
    <div class="vr-body">
      {open && <DiffOverlay at={open.at} title={`${title} · ${humanField(open.field)}`} sub={`${when(previous.at)} → ${when(version.at)}`} oldText={open.before} newText={open.after} onClose={() => setOpen(undefined)} />}
      {!rows.length && <div class="muted small">{P.vrSame}</div>}
      {rows.length > 0 && <div class="small vr-h">{P.vrChanged}</div>}
      {rows.map((r) => (
        <div class="vr-f">
          <b>{humanField(r.field)}</b> <code class="muted">{r.field}</code>
          {looksLong(r.before.value, r.after.value)
            ? <DiffSummary oldText={r.before.value} newText={r.after.value} onOpen={(x, y) => setOpen({ at: { x, y }, field: r.field, before: r.before.value, after: r.after.value })} />
            : <div class="vr-val"><span class="del">{show(r.before)}</span> → <span class="add">{show(r.after)}</span></div>}
        </div>
      ))}
      {link}
    </div>
  );
}

/** Demonstração do site: um script include com três versões; a última acrescenta um comentário e muda a descrição. */
const demoXml = (desc: string, extra: string) => `<?xml version="1.0" encoding="UTF-8"?><record_update table="sys_script_include"><sys_script_include action="INSERT_OR_UPDATE"><active>true</active><description>${desc}</description><name>IncidentUtils</name><script><![CDATA[var IncidentUtils = Class.create();
IncidentUtils.prototype = {
    initialize: function() {},
${extra}    childCount: function(id) {
        var ga = new GlideAggregate('incident');
        ga.addQuery('parent_incident', id);
        ga.addAggregate('COUNT');
        ga.query();
        return ga.next() ? ga.getAggregate('COUNT') : 0;
    },
    type: 'IncidentUtils'
};]]></script><sys_updated_on>2026-10-26 13:57:09</sys_updated_on></sys_script_include></record_update>`;
const DEMO = {
  list: {
    versions: [
      { sysId: 'a0000000000000000000000000000003', at: '2026-10-26 13:57:09', by: 'maria.souza', state: 'current', action: 'INSERT_OR_UPDATE', source: 'update_set', sourceName: 'Melhorias de incidentes' },
      { sysId: 'a0000000000000000000000000000002', at: '2026-10-21 09:12:40', by: 'joao.lima', state: 'previous', action: 'INSERT_OR_UPDATE', source: 'update_set', sourceName: 'Default' },
      { sysId: 'a0000000000000000000000000000001', at: '2026-09-23 03:47:54', by: 'system', state: 'history', action: 'INSERT_OR_UPDATE', source: 'upgrade' },
    ] as RecordVersion[],
    access: 'ok' as const,
    timing: { totalMs: 0, calls: 0 },
  } as RecordVersions,
  payloads: {
    a0000000000000000000000000000003: demoXml('Contagem de incidentes filhos (com cache)', '    // conta só os filhos ativos; ver chamado INC0012345\n'),
    a0000000000000000000000000000002: demoXml('Contagem de incidentes filhos', ''),
  } as Record<string, string>,
};
