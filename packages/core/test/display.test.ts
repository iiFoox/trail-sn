import { describe, expect, it } from 'vitest';
import { resolveDisplay } from '../src/display';
import { FakeRestClient } from '../src/client/FakeRestClient';

describe('resolveDisplay', () => {
  it('prefere o rótulo da filha no idioma escolhido e consulta documentação uma vez', async () => {
    const c = new FakeRestClient()
      .rows('sys_dictionary', [{ name: 'task', element: 'state', column_label: 'State' }])
      .rows('sys_documentation', [
        { name: 'task', element: 'state', label: 'Estado base', language: 'pt' },
        { name: 'incident', element: 'state', label: 'Incident state', language: 'en' },
        { name: 'incident', element: 'state', label: 'Situação', language: 'pt' },
      ])
      .rows('sys_choice', []);
    const q = async (table: string, query: string, fields: string[], limit: number) =>
      (await c.query({ table, query, fields, limit })).rows;
    const result = await resolveDisplay(q, ['incident', 'task'], { state: [] }, 'pt');
    expect(result.fields.state).toBe('Situação');
    expect(c.log.filter((x) => x.table === 'sys_documentation')).toHaveLength(1);
  });

  it('usa inglês na filha antes do idioma escolhido na tabela base', async () => {
    const c = new FakeRestClient()
      .rows('sys_dictionary', [{ name: 'task', element: 'state', column_label: 'Dictionary state' }])
      .rows('sys_documentation', [
        { name: 'task', element: 'state', label: 'Estado base', language: 'pt' },
        { name: 'incident', element: 'state', label: 'Incident state', language: 'en' },
      ])
      .rows('sys_choice', []);
    const q = async (table: string, query: string, fields: string[], limit: number) =>
      (await c.query({ table, query, fields, limit })).rows;
    expect((await resolveDisplay(q, ['incident', 'task'], { state: [] }, 'pt')).fields.state).toBe('Incident state');
  });

  it('volta ao dicionário quando a documentação nega acesso', async () => {
    const c = new FakeRestClient()
      .rows('sys_dictionary', [{ name: 'task', element: 'state', column_label: 'Dictionary state' }])
      .deny('sys_documentation')
      .rows('sys_choice', []);
    const q = async (table: string, query: string, fields: string[], limit: number) => {
      const r = await c.query({ table, query, fields, limit });
      if (r.access === 'denied') throw new Error('denied');
      return r.rows;
    };
    expect((await resolveDisplay(q, ['incident', 'task'], { state: [] }, 'pt')).fields.state).toBe('Dictionary state');
  });
  it('troca nomes técnicos e sys_ids pelo que aparece no formulário', async () => {
    const svc = 'a'.repeat(32);
    const q = async (t: string, query: string): Promise<Record<string, string>[]> => {
      if (t === 'sys_dictionary') return [
        { name: 'task', element: 'business_service', column_label: 'Service (task)', internal_type: 'reference', reference: 'cmdb_ci_service' },
        { name: 'incident', element: 'business_service', column_label: 'Service', internal_type: 'reference', reference: 'cmdb_ci_service' },
        { name: 'task', element: 'urgency', column_label: 'Urgency', internal_type: 'integer', reference: '' },
      ];
      if (t === 'sys_choice') return [{ name: 'incident', element: 'urgency', value: '1', label: '1 - High', language: 'en' }];
      if (t === 'cmdb_ci_service') { expect(query).toContain(svc); return [{ sys_id: svc, name: 'SAP Enterprise Services' }]; }
      return [];
    };
    const d = await resolveDisplay(q, ['incident', 'task'], { business_service: ['', svc], urgency: ['3', '1'] });
    expect(d.fields).toEqual({ business_service: 'Service', urgency: 'Urgency' });
    expect(d.refs).toEqual({ business_service: 'cmdb_ci_service' });
    expect(d.values.business_service?.[svc]).toBe('SAP Enterprise Services');
    expect(d.values.urgency?.['1']).toBe('1 - High');
  });
});
