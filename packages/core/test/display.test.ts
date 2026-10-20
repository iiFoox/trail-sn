import { describe, expect, it } from 'vitest';
import { resolveDisplay } from '../src/display';

describe('resolveDisplay', () => {
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
