import { fact } from '../scoring';
import { evidence, type Signature } from './context';

/**
 * Importação (Import Set + transform map): a linha de staging guarda o registro de destino (sys_target_sys_id)
 * e foi transformada no instante da mudança. O mapeamento do campo no transform map fecha a ligação.
 */
export const importSet: Signature = (ctx) => {
  // Várias linhas do mesmo transform map (ex.: criação e atualização) são uma só causa: fica a mais próxima da mudança.
  const at = Date.parse(ctx.at.replace(' ', 'T') + 'Z');
  const dist = (r: { sys_updated_on?: string }) => Math.abs(Date.parse((r.sys_updated_on ?? '').replace(' ', 'T') + 'Z') - at) || 0;
  const best = new Map<string, NonNullable<typeof ctx.traces.importRows>[number]>();
  for (const r of ctx.traces.importRows ?? []) {
    const k = r.sys_transform_map ?? '';
    const cur = best.get(k);
    if (!cur || dist(r) < dist(cur)) best.set(k, r);
  }
  return [...best.values()].map((row) => {
    const mapId = row.sys_transform_map ?? '';
    const mapName = row['sys_transform_map.name'] || 'Transform map';
    const entry = (ctx.traces.transformEntries ?? []).find((e) => e.map === mapId);
    const facts = [fact('trace_names_artifact', 'sys_import_set_row', `linha da importação ${row['sys_import_set.number'] ?? ''} transformada às ${row.sys_updated_on} (${row.sys_import_state ?? ''})`)];
    const gaps: string[] = [];
    if (entry) facts.push(fact('references_field', 'sys_transform_entry', `o transform map grava "${ctx.field}" a partir de "${entry.source_field ?? ''}"`));
    else if (ctx.traces.transformMapsLoaded) gaps.push('o transform map não mapeia este campo diretamente; pode ter vindo de um script de transformação');
    if (row.sys_updated_by === ctx.user) facts.push(fact('user_matches', 'sys_import_set_row', `importação rodada por ${row.sys_updated_by}`));
    return evidence('import_set', { name: mapName, sysId: mapId, table: 'sys_transform_map' }, facts, gaps);
  });
};
