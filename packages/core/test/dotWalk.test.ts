import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { EmptyReferenceError, resolveDotWalk } from '../src/dotWalk';
import { RecordNotFoundError, RecordUnavailableError } from '../src/types';

/** Pedido do dono (28/10/2026): `u_iss_solicitacao.number` no formulário ficava sem ícone. */
const SRC = 'a'.repeat(32), SOL = 'b'.repeat(32), GRP = 'c'.repeat(32);
function client() {
  return new FakeRestClient()
    .rows('sys_dictionary', [
      { name: 'x_tarefa', element: 'u_iss_solicitacao', reference: 'x_solicitacao' },
      { name: 'x_solicitacao', element: 'assignment_group', reference: 'sys_user_group' },
      { name: 'x_tarefa', element: 'u_vazio', reference: 'x_solicitacao' },
    ])
    .rows('x_tarefa', [{ sys_id: SRC, u_iss_solicitacao: SOL, u_vazio: '' }])
    .rows('x_solicitacao', [{ sys_id: SOL, sys_class_name: 'x_solicitacao_rh', assignment_group: GRP }])
    .rows('x_solicitacao_rh', [{ sys_id: SOL, sys_class_name: 'x_solicitacao_rh', assignment_group: GRP }])
    .rows('sys_user_group', [{ sys_id: GRP }]);
}

describe('campos com dot-walking', () => {
  it('segue a referência até o registro apontado, na classe real dele', async () => {
    const r = await resolveDotWalk(client(), { table: 'x_tarefa', sysId: SRC, path: 'u_iss_solicitacao.number' });
    expect(r).toEqual({ table: 'x_solicitacao_rh', sysId: SOL, field: 'number', via: [{ table: 'x_tarefa', field: 'u_iss_solicitacao' }] });
  });

  it('dois níveis; sem sys_class_name fica a tabela da referência', async () => {
    const r = await resolveDotWalk(client(), { table: 'x_tarefa', sysId: SRC, path: 'u_iss_solicitacao.assignment_group.name' });
    expect(r.table).toBe('sys_user_group');
    expect(r.sysId).toBe(GRP);
    expect(r.field).toBe('name');
    expect(r.via.map((v) => v.field)).toEqual(['u_iss_solicitacao', 'assignment_group']);
  });

  it('referência em branco: erro próprio, sem investigar nada', async () => {
    await expect(resolveDotWalk(client(), { table: 'x_tarefa', sysId: SRC, path: 'u_vazio.number' })).rejects.toBeInstanceOf(EmptyReferenceError);
  });

  it('campo que não é referência, ou registro sem leitura: não encontrado', async () => {
    await expect(resolveDotWalk(client(), { table: 'x_tarefa', sysId: SRC, path: 'short_description.number' })).rejects.toBeInstanceOf(RecordNotFoundError);
    const c = client().deny('x_tarefa');
    await expect(resolveDotWalk(c, { table: 'x_tarefa', sysId: SRC, path: 'u_iss_solicitacao.number' })).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('registro que não respondeu: indisponível (vale tentar de novo)', async () => {
    const c = client().respond('x_tarefa', () => ({ rows: [], status: 500, access: 'unknown' }));
    await expect(resolveDotWalk(c, { table: 'x_tarefa', sysId: SRC, path: 'u_iss_solicitacao.number' })).rejects.toBeInstanceOf(RecordUnavailableError);
  });

  it('só GET de leitura, com nomes técnicos validados', async () => {
    await expect(resolveDotWalk(client(), { table: 'x_tarefa', sysId: SRC, path: 'u_iss_solicitacao.number^NQ' })).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
