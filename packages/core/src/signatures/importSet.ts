import { fact } from '../scoring';
import { assignedLiterals, sameVal } from '../util';
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
    const f = ctx.field;
    const writesTarget = (sc: string | undefined) => new RegExp(`\\btarget\\.${f}\\s*=[^=]|\\btarget\\.setValue\\(\\s*['"]${f}['"]`).test(sc ?? '');
    const script = (ctx.traces.transformScripts ?? []).find((t) => t.map === mapId && writesTarget(t.script));
    if (entry && entry.use_source_script === 'true') {
      facts.push(fact('references_field', 'sys_transform_entry', `o transform map calcula "${f}" por script`));
    } else if (entry) {
      facts.push(fact('references_field', 'sys_transform_entry', `o transform map grava "${f}" a partir de "${entry.source_field ?? ''}"`));
      const stage = (ctx.traces.stageRows ?? []).find((r) => r.sys_id === row.sys_id);
      const src = stage && entry.source_field && entry.source_field in stage ? stage[entry.source_field] ?? '' : undefined;
      const nv = ctx.audit.newvalue ?? '';
      if (src !== undefined && !script) {
        if (sameVal(src, nv)) facts.push(fact('sets_same_value', 'sys_import_set_row', `a linha importada trouxe "${src}"`));
        else facts.push(fact('sets_other_value', 'sys_import_set_row', `a linha importada trouxe "${src}", não "${nv}": algo no servidor mudou o valor ao gravar`));
      }
    } else if (script) {
      facts.push(fact('references_field', 'sys_transform_script', script.when === 'map' ? `o script do transform map grava "${f}"` : `o script ${script.when} do transform map grava "${f}"`));
      // O script grava valores fixos e nenhum é o valor que ficou: não foi ele (ex.: só grava para outra categoria).
      const lits = assignedLiterals(script.script, f);
      if (lits && lits.length && !lits.some((x) => sameVal(x, ctx.audit.newvalue ?? ''))) facts.push(fact('sets_other_value', 'sys_transform_script', `o script grava ${lits.map((x) => `"${x}"`).join(', ')}, não "${ctx.audit.newvalue ?? ''}"`));
    } else if (ctx.traces.transformMapsLoaded) {
      facts.push(fact('no_step_writes_field', 'sys_transform_entry', `o transform map não grava "${f}" (nem por mapeamento nem por script); outra regra reagiu à importação`));
    }
    if (row.sys_updated_by === ctx.user) facts.push(fact('user_matches', 'sys_import_set_row', `importação rodada por ${row.sys_updated_by}`));
    return evidence('import_set', { name: mapName, sysId: mapId, table: 'sys_transform_map' }, facts, gaps);
  });
};
