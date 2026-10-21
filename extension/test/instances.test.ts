import { describe, expect, it } from 'vitest';
import { connectableOrigin, looksLikeServiceNow } from '../src/shared/instances';

describe('detecção de instância', () => {
  it('reconhece só os domínios do ServiceNow', () => {
    expect(looksLikeServiceNow('https://dev123.service-now.com/incident.do?sys_id=1')).toBe(true);
    expect(looksLikeServiceNow('https://acme.servicenowservices.com/now/nav/ui/home')).toBe(true);
    expect(looksLikeServiceNow('http://dev123.service-now.com/')).toBe(false);
  });
  it('não trata qualquer site com .do como ServiceNow', () => {
    expect(looksLikeServiceNow('https://www.exemplo.com.br/login.do')).toBe(false);
    expect(looksLikeServiceNow('https://loja.example.com/now/nav/ui/x')).toBe(false);
    expect(looksLikeServiceNow('https://evil-service-now.com.example.org/incident.do')).toBe(false);
  });
  it('aceita domínio próprio digitado nas opções, só em https', () => {
    expect(connectableOrigin('servicenow.empresa.com.br')).toBe('https://servicenow.empresa.com.br');
    expect(connectableOrigin(' https://sn.empresa.com/navpage.do ')).toBe('https://sn.empresa.com');
    expect(connectableOrigin('http://sn.empresa.com')).toBeUndefined();
    expect(connectableOrigin('https://user:pw@sn.empresa.com')).toBeUndefined();
    expect(connectableOrigin('localhost')).toBeUndefined();
    expect(connectableOrigin('')).toBeUndefined();
  });
});
