import { describe, expect, it } from 'vitest';
import { changedFields, parsePayload } from '../src/shared/versions';

const v = (script: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?><record_update table="sys_script_include"><sys_script_include action="INSERT_OR_UPDATE"><access>public</access><active>true</active><caller_access/><description>a &lt; b &amp; c</description>${extra}<name>SOWMraUtils</name><script><![CDATA[${script}]]></script><sys_mod_count>7</sys_mod_count><sys_updated_on>2026-10-26 13:57:09</sys_updated_on></sys_script_include></record_update>`;

describe('conteúdo de uma versão (sys_update_version.payload)', () => {
  it('lê campos com texto escapado, vazios e CDATA, sem os campos de controle', () => {
    const p = parsePayload(v("var x = 'a' + b;\r\n// </script> dentro do texto"));
    expect(p.description!.value).toBe('a < b & c');
    expect(p.caller_access!.value).toBe('');
    expect(p.script!.value).toBe("var x = 'a' + b;\r\n// </script> dentro do texto");
    expect(p.sys_mod_count).toBeUndefined();
  });

  it('referência traz o valor de exibição', () => {
    const p = parsePayload(v('x', '<sys_scope display_value="Global">global</sys_scope><group display_value="Rede &amp; Infra">abc</group>'));
    expect(p.group).toEqual({ value: 'abc', display: 'Rede & Infra' });
  });

  it('"]]>" dentro do script (duas seções CDATA)', () => {
    const xml = v('').replace('<![CDATA[]]>', '<![CDATA[a]]]]><![CDATA[>b]]>');
    expect(parsePayload(xml).script!.value).toBe('a]]>b');
  });

  it('só os campos que mudaram; \r\n e \n contam igual', () => {
    const a = parsePayload(v('linha 1\r\nlinha 2'));
    const b = parsePayload(v('linha 1\nlinha 2\n//quero cagar'));
    expect(changedFields(a, b).map((x) => x.field)).toEqual(['script']);
    expect(changedFields(a, parsePayload(v('linha 1\nlinha 2')))).toEqual([]);
  });

  it('XML estranho não quebra', () => {
    expect(parsePayload('')).toEqual({});
    expect(parsePayload('<html>500</html>')).toEqual({});
  });
});
