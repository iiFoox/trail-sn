import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../shared/ui.css';
import { listInstances, type InstanceSettings } from '../shared/instances';
import { send } from '../shared/messages';

function Options() {
  const [list, setList] = useState<InstanceSettings[]>([]);
  const refresh = () => void listInstances().then(setList);
  useEffect(refresh, []);

  return (
    <div class="wrap">
      <h1>Trail · Opções</h1>
      <h2>Instâncias ativadas</h2>
      {list.length === 0 && <p class="muted">Nenhuma. Abra uma instância ServiceNow e clique em "Ativar nesta instância" no ícone da extensão.</p>}
      <table>
        {list.map((i) => (
          <tr>
            <td><code>{i.origin}</code></td>
            <td class="muted">{new Date(i.enabledAt).toLocaleString()}</td>
            <td class="row">
              <button onClick={() => send({ type: 'clear-cache', origin: i.origin })}>Limpar cache</button>
              <button onClick={async () => { await send({ type: 'deactivate', origin: i.origin }); await chrome.permissions.remove({ origins: [`${i.origin}/*`] }).catch(() => undefined); refresh(); }}>Desativar</button>
            </td>
          </tr>
        ))}
      </table>
      <h2>Privacidade</h2>
      <p class="muted">A extensão só faz leituras (GET) na instância em que foi ativada, com a sua sessão. Nada sai do navegador; não há telemetria. O cache de metadados fica em memória de sessão e some ao fechar o navegador.</p>
    </div>
  );
}

render(<Options />, document.getElementById('app')!);
