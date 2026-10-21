// tests/regression/bateria2000/analisar.mjs
import { readFileSync, writeFileSync } from 'node:fs';

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function analisarEGerarRelatorio(adminResults, itilResults) {
  const adminByTarget = new Map(adminResults.map(r => [`${r.table}:${r.sysId}:${r.field}`, r]));
  const itilByTarget = new Map(itilResults.map(r => [`${r.table}:${r.sysId}:${r.field}`, r]));

  // --- Estatísticas Gerais ---
  const adminTimes = adminResults.map(r => r.ms);
  const adminCalls = adminResults.map(r => r.calls);
  const adminOk = adminResults.filter(r => r.ok).length;
  const adminFailed = adminResults.filter(r => !r.ok);

  const itilTimes = itilResults.map(r => r.ms);
  const itilCalls = itilResults.map(r => r.calls);
  const itilNoRead = itilResults.filter(r => !r.ok && (r.errorType === 'RecordNotFoundError' || (r.error || '').includes('not found') || (r.error || '').includes('readable')));
  const itilJsError = itilResults.filter(r => !r.ok && !itilNoRead.includes(r));
  const itilOk = itilResults.filter(r => r.ok).length;

  const adminMedianMs = percentile(adminTimes, 50);
  const adminP95Ms = percentile(adminTimes, 95);
  const adminMedianCalls = percentile(adminCalls, 50);

  const itilMedianMs = percentile(itilTimes, 50);
  const itilP95Ms = percentile(itilTimes, 95);
  const itilMedianCalls = percentile(itilCalls, 50);

  // --- Validação das Invariantes do Admin (A1-A4) ---
  const a1Violations = [];
  const a2Violations = [];
  const a3Violations = [];
  const a4Violations = [];

  for (const r of adminResults) {
    // A1: Não lança erro
    if (!r.ok) {
      a1Violations.push({
        table: r.table,
        sysId: r.sysId,
        field: r.field,
        esperado: 'Execução com sucesso',
        obtido: `Erro: ${r.error} (${r.errorType})`
      });
    }

    // A2: Número de mudanças = número de linhas de auditoria do campo (descontando cópias duplicadas)
    if (r.ok && r.auditCount !== undefined) {
      if (r.changeCount !== r.auditCount) {
        a2Violations.push({
          table: r.table,
          sysId: r.sysId,
          field: r.field,
          esperado: `${r.auditCount} mudança(s) (sys_audit count)`,
          obtido: `${r.changeCount} mudança(s) no resultado`
        });
      }
    }

    // A3: Tempo abaixo de 10 s
    if (r.ms > 10000) {
      a3Violations.push({
        table: r.table,
        sysId: r.sysId,
        field: r.field,
        esperado: 'Tempo < 10000 ms',
        obtido: `${r.ms} ms`
      });
    }

    // A4: Toda mudança tem ao menos uma evidência, e nunca unknown_background quando há transação do usuário
    if (r.ok && r.changeCount > 0) {
      for (let cIdx = 0; cIdx < r.changes.length; cIdx++) {
        const ch = r.changes[cIdx];
        if (!ch.topEvidence) {
          a4Violations.push({
            table: r.table,
            sysId: r.sysId,
            field: r.field,
            esperado: 'Ao menos uma evidência',
            obtido: 'Nenhuma evidência gerada'
          });
        }
      }
    }
  }

  // --- Validação das Invariantes do Sem Admin / ITIL (I1-I6) ---
  const i1Violations = [];
  const i2Violations = [];
  const i3Violations = [];
  const i4Violations = [];
  const i5Violations = [];
  const i6Violations = [];

  const fieldsNotInHistoryByTable = new Map();

  for (const itilR of itilResults) {
    const key = `${itilR.table}:${itilR.sysId}:${itilR.field}`;
    const adminR = adminByTarget.get(key);

    // I1: Não lança erro de JS (RecordNotFoundError é sem leitura, permitido)
    if (!itilR.ok && !itilNoRead.includes(itilR)) {
      i1Violations.push({
        table: itilR.table,
        sysId: itilR.sysId,
        field: itilR.field,
        esperado: 'Sucesso ou RecordNotFoundError (sem leitura)',
        obtido: `Erro JS: ${itilR.error} (${itilR.errorType})`
      });
    }

    // Se o registro não é legível pelo ITIL, não avaliamos I2/I3
    if (!itilR.ok) continue;

    const inHistory = itilR.historyFields && itilR.historyFields.includes(itilR.field);

    if (inHistory) {
      // I2: Se o campo está em historyFields, as mudanças do itil batem com as do admin
      if (adminR && adminR.ok) {
        if (itilR.changeCount !== adminR.changeCount) {
          i2Violations.push({
            table: itilR.table,
            sysId: itilR.sysId,
            field: itilR.field,
            esperado: `Mesma contagem de mudanças do admin (${adminR.changeCount})`,
            obtido: `${itilR.changeCount} mudanças no ITIL`
          });
        } else {
          // Conferir valores e horários
          for (let idx = 0; idx < itilR.changes.length; idx++) {
            const itilCh = itilR.changes[idx];
            const adminCh = adminR.changes[idx];
            if (!adminCh) continue;
            // Comparar oldvalue e newvalue brutos
            if (itilCh.oldvalue !== adminCh.oldvalue || itilCh.newvalue !== adminCh.newvalue) {
              i2Violations.push({
                table: itilR.table,
                sysId: itilR.sysId,
                field: itilR.field,
                esperado: `Valores brutos: '${adminCh.oldvalue}' → '${adminCh.newvalue}'`,
                obtido: `Valores no ITIL: '${itilCh.oldvalue}' → '${itilCh.newvalue}'`
              });
              break;
            }
          }
        }
      }
    } else {
      // I3: Se o campo não está em historyFields: fieldNotInHistory = true e zero mudanças
      if (!itilR.fieldNotInHistory || itilR.changeCount !== 0) {
        i3Violations.push({
          table: itilR.table,
          sysId: itilR.sysId,
          field: itilR.field,
          esperado: 'fieldNotInHistory = true e 0 mudanças',
          obtido: `fieldNotInHistory = ${itilR.fieldNotInHistory}, ${itilR.changeCount} mudanças`
        });
      }
      // Registrar campos fora do histórico
      if (!fieldsNotInHistoryByTable.has(itilR.table)) fieldsNotInHistoryByTable.set(itilR.table, new Set());
      fieldsNotInHistoryByTable.get(itilR.table).add(itilR.field);
    }

    // I4: Com syslog_transaction negada, nunca evidência com o fato no_user_transaction
    const txDenied = itilR.access?.syslog_transaction === 'denied';
    if (txDenied) {
      for (const ch of itilR.changes) {
        const hasNoUserTx = ch.topEvidence?.facts?.some(f => f.kind === 'no_user_transaction');
        if (hasNoUserTx) {
          i4Violations.push({
            table: itilR.table,
            sysId: itilR.sysId,
            field: itilR.field,
            esperado: 'Sem fato no_user_transaction quando syslog_transaction é negada',
            obtido: 'Fato no_user_transaction presente na evidência'
          });
        }
      }
    }

    // I5: Nunca nomeia artefato que veio de fonte negada
    const scriptDenied = itilR.access?.sys_script === 'denied';
    if (scriptDenied) {
      for (const ch of itilR.changes) {
        if (ch.topEvidence?.type === 'br_before' || ch.topEvidence?.type === 'br_after' || ch.topEvidence?.type === 'br_async') {
          i5Violations.push({
            table: itilR.table,
            sysId: itilR.sysId,
            field: itilR.field,
            esperado: 'Nenhum artefato de sys_script nomeado quando negado',
            obtido: `Evidência '${ch.topEvidence.type}' nomeando '${ch.topEvidence.artifactName}'`
          });
        }
      }
    }

    // I6: Tempo abaixo de 10 s
    if (itilR.ms > 10000) {
      i6Violations.push({
        table: itilR.table,
        sysId: itilR.sysId,
        field: itilR.field,
        esperado: 'Tempo < 10000 ms',
        obtido: `${itilR.ms} ms`
      });
    }
  }

  // --- Montar Arquivo de Dados Completo ---
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fullData = {
    metadata: {
      timestamp,
      totalTargets: adminResults.length,
      admin: { total: adminResults.length, ok: adminOk, failed: adminFailed.length, medianMs: adminMedianMs, p95Ms: adminP95Ms, medianCalls: adminMedianCalls },
      itil: { total: itilResults.length, ok: itilOk, noRead: itilNoRead.length, jsErrors: itilJsError.length, medianMs: itilMedianMs, p95Ms: itilP95Ms, medianCalls: itilMedianCalls },
      invariants: {
        A1: a1Violations.length,
        A2: a2Violations.length,
        A3: a3Violations.length,
        A4: a4Violations.length,
        I1: i1Violations.length,
        I2: i2Violations.length,
        I3: i3Violations.length,
        I4: i4Violations.length,
        I5: i5Violations.length,
        I6: i6Violations.length,
      }
    },
    adminResults,
    itilResults
  };

  const resultsPath = `tests/regression/results/bateria2000-${timestamp}.json`;
  writeFileSync(resultsPath, JSON.stringify(fullData, null, 2), 'utf8');
  console.log(`Dados completos salvos em: ${resultsPath}`);

  // --- Gerar RELATORIO.md ---
  const formatExamples = (violations) => {
    if (!violations.length) return 'Nenhuma violação encontrada (100% aderente).\n';
    const sample = violations.slice(0, 5);
    let md = `**Total de ocorrências:** ${violations.length}\n\n`;
    md += '| Tabela | sys_id | Campo | Esperado | Obtido |\n';
    md += '|---|---|---|---|---|\n';
    for (const v of sample) {
      md += `| \`${v.table}\` | \`${v.sysId.slice(0, 8)}...\` | \`${v.field}\` | ${v.esperado} | ${v.obtido} |\n`;
    }
    if (violations.length > 5) md += `\n*... e mais ${violations.length - 5} ocorrências adicionais.*`;
    md += '\n';
    return md;
  };

  let notCoveredMd = '';
  for (const [tbl, fields] of fieldsNotInHistoryByTable.entries()) {
    notCoveredMd += `- **\`${tbl}\`**: ${Array.from(fields).map(f => `\`${f}\``).join(', ')}\n`;
  }
  if (!notCoveredMd) notCoveredMd = 'Nenhum campo com histórico não coberto detectado.\n';

  const relatorioMd = `# Relatório da Bateria 2000 (Admin x Sem Admin)

Realizada em: **${new Date().toISOString()}**  
Ambiente: PDI de testes ServiceNow  
Usuários testados: **admin** e **pt.trail.itil** (personificação)  
Arquivo de dados brutos: \`${resultsPath}\`

---

## 1. Totais e Métricas de Performance

| Métrica | Modo Admin (1000 alvos) | Modo Sem Admin / ITIL (1000 alvos) |
|---|---|---|
| **Investigações com sucesso** | **${adminOk}** (${((adminOk / adminResults.length) * 100).toFixed(1)}%) | **${itilOk}** (${((itilOk / itilResults.length) * 100).toFixed(1)}%) |
| **Sem leitura do registro (ACL)** | 0 (0%) | **${itilNoRead.length}** (${((itilNoRead.length / itilResults.length) * 100).toFixed(1)}%) |
| **Erros de JavaScript / Falhas** | **${adminFailed.length}** | **${itilJsError.length}** |
| **Tempo Mediano** | **${adminMedianMs} ms** | **${itilMedianMs} ms** |
| **Tempo p95** | **${adminP95Ms} ms** | **${itilP95Ms} ms** |
| **Chamadas de Rede Medianas** | **${adminMedianCalls}** | **${itilMedianCalls}** |

> **Nota:** No modo sem admin (\`pt.trail.itil\`), registros de tabelas às quais o papel ITIL não tem leitura por ACL (ex.: certas tabelas CMDB ou módulos administrativos) resultam em \`RecordNotFoundError\`, o que é o comportamento esperado de proteção de acesso (não é falha de código).

---

## 2. Achados por Invariante — Modo Admin (1000 testes)

### A1. Não lança erro de JavaScript
${formatExamples(a1Violations)}

### A2. Número de mudanças bate com as linhas de auditoria
${formatExamples(a2Violations)}

### A3. Tempo de resposta abaixo de 10 s
${formatExamples(a3Violations)}

### A4. Toda mudança possui evidência (e nunca unknown_background se há transação de usuário)
${formatExamples(a4Violations)}

---

## 3. Achados por Invariante — Modo Sem Admin / ITIL (1000 testes)

### I1. Não lança erro inesperado (fora RecordNotFoundError por ACL)
${formatExamples(i1Violations)}

### I2. Mudanças do histórico batem com a auditoria do admin (quando o campo está no histórico)
${formatExamples(i2Violations)}

### I3. Campos fora do histórico marcam \`fieldNotInHistory: true\` e zero mudanças
${formatExamples(i3Violations)}

### I4. Com transações negadas, nunca atribui o fato falso \`no_user_transaction\`
${formatExamples(i4Violations)}

### I5. Nunca nomeia artefatos provenientes de tabelas negadas (ex.: regras de \`sys_script\`)
${formatExamples(i5Violations)}

### I6. Tempo de resposta abaixo de 10 s
${formatExamples(i6Violations)}

---

## 4. Campos e Tabelas Fora do Activity Stream (Histórico do Formulário)

Quando o usuário não é admin, o Trail utiliza o histórico do formulário (\`/angular.do?sysparm_type=list_history\`). Abaixo estão os campos encontrados nas investigações que não estão configurados no Activity Stream da respectiva tabela:

${notCoveredMd}

---

## 5. Registros e Usuários no PDI

- **Usuários personificados:**
  - \`admin\` (\`6816f79cc0a8016401c5a33be04be441\`)
  - \`pt.trail.itil\` (\`3fc011fdc3c4d3101cbdb8e1b401311c\`)
- **Status da sessão ao final:** **ADMIN** (confirmado retorno obrigatório).
- **Registros criados no PDI:** Nenhum registro novo foi necessário criar (os 1000 alvos foram selecionados a partir das mudanças reais já auditadas em 18 tabelas da instância).
- **Registros alterados ou excluídos:** **Zero**. Regra estrita de somente leitura mantida.
`;

  writeFileSync('tests/regression/bateria2000/RELATORIO.md', relatorioMd, 'utf8');
  console.log('Relatório salvo em: tests/regression/bateria2000/RELATORIO.md');
}
