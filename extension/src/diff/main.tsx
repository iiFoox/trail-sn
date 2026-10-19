import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../shared/ui.css';
import { bootPage, getPrefs } from '../shared/prefs';
import { t } from '../shared/i18n';
import { TrailMark } from '../shared/icons';
import { DiffView } from '../shared/DiffView';

bootPage();
const P = t(getPrefs().lang).p;
type Payload = { title: string; sub: string; oldText: string; newText: string };

/** Janela larga com a diferença lado a lado; o painel deixa o conteúdo na sessão e passa a chave pela URL. */
function DiffPage() {
  const [d, setD] = useState<Payload>();
  useEffect(() => {
    const k = new URLSearchParams(location.search).get('k') ?? '';
    void chrome.storage.session.get(k).then((o) => { setD(o[k] as Payload | undefined); document.title = `Trail · ${(o[k] as Payload | undefined)?.title ?? ''}`; });
  }, []);
  return (
    <>
      <header class="topbar"><div class="brand"><span class="mark"><TrailMark /></span>Trail</div>{d && <span class="host">{d.title} · {d.sub}</span>}</header>
      <main class="wrap wide">
        {d ? <DiffView split oldText={d.oldText} newText={d.newText} labels={{ onlyChanges: P.diffOnly, whole: P.diffWhole, same: P.diffSame, added: P.diffAdded, removed: P.diffRemoved, before: P.diffBefore, after: P.diffAfter }} /> : <div class="muted">…</div>}
      </main>
    </>
  );
}
render(<DiffPage />, document.getElementById('app')!);
