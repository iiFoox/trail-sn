import { listInstances } from './instances';

/**
 * O painel e a diferença são recursos acessíveis pela web (o painel flutuante e a janela da diferença são iframes na
 * página do ServiceNow), e qualquer site poderia embuti-los: mostrariam o resultado de outra aba e aceitariam cliques
 * por baixo de outra página. Dentro de um iframe, só abrem se todos os quadros acima forem da própria extensão ou de
 * uma instância conectada. Fora da extensão (demonstração do site, com as APIs do Chrome simuladas), sempre abrem.
 */
export async function embedAllowed(): Promise<boolean> {
  if (window.top === window || !location.protocol.endsWith('-extension:')) return true;
  const above = [...(location.ancestorOrigins ?? [])];
  if (!above.length) return false;
  const connected = new Set((await listInstances().catch(() => [])).map((i) => i.origin));
  return above.every((o) => o === location.origin || connected.has(o));
}
