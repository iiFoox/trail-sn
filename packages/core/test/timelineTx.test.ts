import { describe, expect, it } from 'vitest';
import { recordTimeline } from '../src/timeline';
import { INC, T0, build, scenario, shiftStr, tx } from './fixtures/builder';

/** Teste do dono no DEV (05/11/2026): sem sys_audit, "Registro inteiro" dizia "Nenhuma alteração auditada". */
describe('registro inteiro sem auditoria: envios de formulário guardados', () => {
  it('cada envio vira uma gravação com os campos que o formulário mudou, sem campos de outro registro', async () => {
    const s = scenario();
    s.record.sys_created_on = shiftStr(T0, -3600);
    s.record.sys_updated_on = T0;
    tx(s, shiftStr(T0, -60), 'form', `/incident.do?sys_uniqueValue=${INC.sysId}&sys_modCount=1`
      + '&sys_original.incident.description=antes&incident.description=depois'
      + '&sys_original.incident.u_ok=&incident.u_ok=true'
      + '&sys_original.incident.u_sol.u_valor=1&incident.u_sol.u_valor=2', 'pessoa');
    s.client.deny('sys_audit');
    const t = await recordTimeline(build(s), { table: 'incident', sysId: INC.sysId });
    expect(t.fromTransactions).toBe(true);
    expect(t.auditDenied).toBe(true);
    expect(t.saves).toHaveLength(1);
    expect(t.saves[0]!.user).toBe('pessoa');
    expect(t.saves[0]!.fields.map((f) => `${f.field}:${f.oldValue}>${f.newValue}`).sort()).toEqual(['description:antes>depois', 'u_ok:>true']);
  });
});
