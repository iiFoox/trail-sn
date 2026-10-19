/**
 * Cria na PDI os artefatos [PT] dos casos novos da Fase 1. SOMENTE PARA RODAR MANUALMENTE
 * em Scripts - Background (escopo global), por quem tem admin. Nada aqui é executado pela extensão.
 *
 * Casos criados (cada um vira uma linha em cases.json):
 *   F1-ASSIGN  regra de atribuição: incident com category=network ganha assignment_group "[PT] Rede"
 *   F1-SEQ     duas automações em sequência no mesmo campo: BR before impact=2, depois BR async impact=1
 *   F1-MANY    registro com 60 mudanças auditadas em state (via script, usuário admin)
 *   F1-IMPORT  importação com transform map que define severity=1
 *
 * Idempotente: procura pelo nome antes de criar. Para remover tudo: deletar registros cujo nome começa com "[PT] F1".
 */
(function setupFase1() {
    var out = [];
    function p(s) { out.push(s); }
    function upsert(table, key, values) {
        var gr = new GlideRecord(table);
        gr.addQuery(key, values[key]);
        gr.query();
        if (gr.next()) { p('existe: ' + table + ' ' + values[key]); return gr; }
        gr.initialize();
        for (var k in values) gr.setValue(k, values[k]);
        gr.insert();
        p('criado: ' + table + ' ' + values[key]);
        return gr;
    }
    function newIncident(desc) {
        var inc = new GlideRecord('incident');
        inc.initialize();
        inc.short_description = desc;
        inc.caller_id.setDisplayValue('System Administrator');
        inc.insert();
        return inc;
    }

    // ---- F1-ASSIGN: grupo + regra de atribuição ----
    var grp = upsert('sys_user_group', 'name', { name: '[PT] Rede', description: 'Grupo da perícia (Fase 1)' });
    upsert('sysrule_assignment', 'name', {
        name: '[PT] F1 atribui rede', table: 'incident', active: 'true', order: '100',
        condition: 'category=network^assignment_groupISEMPTY', group: grp.getUniqueValue()
    });
    var incA = newIncident('[PT] F1-ASSIGN');
    incA.category = 'network';
    incA.update(); // a regra preenche assignment_group ao salvar sem grupo
    p('F1-ASSIGN: ' + incA.number + ' assignment_group=' + incA.getDisplayValue('assignment_group'));

    // ---- F1-SEQ: before + async no mesmo campo ----
    upsert('sys_script', 'name', {
        name: '[PT] F1 before impacto 2', collection: 'incident', active: 'true', when: 'before', order: '100',
        action_update: 'true', action_insert: 'false',
        filter_condition: 'short_descriptionSTARTSWITH[PT] F1-SEQ^EQ',
        script: '(function executeRule(current, previous) {\n  if (current.impact == 3) current.impact = 2; // primeira automação\n})(current, previous);'
    });
    upsert('sys_script', 'name', {
        name: '[PT] F1 async impacto 1', collection: 'incident', active: 'true', when: 'async', order: '100',
        action_update: 'true', action_insert: 'false',
        filter_condition: 'short_descriptionSTARTSWITH[PT] F1-SEQ^EQ',
        script: '(function executeRule(current, previous) {\n  var gr = new GlideRecord("incident");\n  if (gr.get(current.sys_id) && gr.impact == 2) { gr.impact = 1; gr.update(); } // segunda automação\n})(current, previous);'
    });
    var incS = newIncident('[PT] F1-SEQ');
    incS.impact = 3;
    incS.update(); // before -> 2; async -> 1 segundos depois
    p('F1-SEQ: ' + incS.number + ' (aguarde o job async e confira impact)');

    // ---- F1-MANY: 60 mudanças em state ----
    var incM = newIncident('[PT] F1-MANY');
    var states = ['1', '2', '3', '6'];
    for (var i = 0; i < 60; i++) {
        incM.state = states[i % states.length];
        incM.update();
    }
    p('F1-MANY: ' + incM.number + ' sys_mod_count=' + incM.sys_mod_count);

    // ---- F1-IMPORT: import set + transform map que define severity ----
    var importTable = 'u_pt_f1_import';
    var tbl = new GlideRecord('sys_db_object');
    tbl.addQuery('name', importTable);
    tbl.query();
    if (!tbl.next()) {
        p('ATENÇÃO: crie antes a import set table ' + importTable + ' (System Import Sets > Load Data) com as colunas u_number e u_severity, depois rode de novo.');
    } else {
        var tm = upsert('sys_transform_map', 'name', {
            name: '[PT] F1 import severidade', source_table: importTable, target_table: 'incident', active: 'true', run_business_rules: 'true'
        });
        upsert('sys_transform_entry', 'map', { map: tm.getUniqueValue(), source_field: 'u_number', target_field: 'number', coalesce: 'true' });
        var e2 = new GlideRecord('sys_transform_entry');
        e2.addQuery('map', tm.getUniqueValue()); e2.addQuery('target_field', 'severity'); e2.query();
        if (!e2.next()) { e2.initialize(); e2.map = tm.getUniqueValue(); e2.source_field = 'u_severity'; e2.target_field = 'severity'; e2.insert(); }
        var incI = newIncident('[PT] F1-IMPORT');
        var row = new GlideRecord(importTable);
        row.initialize(); row.u_number = incI.number; row.u_severity = '1'; row.insert();
        p('F1-IMPORT: ' + incI.number + '. Rode a transformação do import set (Transform) e depois investigue severity.');
    }

    gs.print('\n' + out.join('\n'));
})();
