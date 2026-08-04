/**
 * MEU FINANCEIRO - Backend em Google Apps Script
 * -----------------------------------------------
 * Este script transforma uma planilha do Google Sheets em uma API simples
 * que o site (hospedado no GitHub Pages) usa para ler e salvar dados.
 *
 * COMO USAR:
 * 1. Crie uma planilha nova no Google Sheets.
 * 2. Vá em Extensões > Apps Script.
 * 3. Apague o conteúdo padrão e cole todo este arquivo.
 * 4. Salve e clique em "Implantar" > "Nova implantação".
 *    - Tipo: "App da Web"
 *    - Executar como: "Eu"
 *    - Quem pode acessar: "Qualquer pessoa"
 * 5. Copie a URL do App da Web gerada e cole no arquivo js/config.js do site.
 *
 * Este script cria automaticamente as abas necessárias na primeira execução.
 */

// Nomes das abas usadas na planilha
var SHEETS = {
  RECEITAS: 'Receitas',
  DESPESAS: 'DespesasDiaADia',
  FIXOS: 'GastosFixos',
  CARTAO: 'CartaoCredito',
  POUPANCA: 'Poupanca',
  CONFIG: 'Config'
};

// Definição das colunas de cada aba (usadas para criar o cabeçalho automaticamente)
var COLUMNS = {
  Receitas: ['id', 'data', 'descricao', 'categoria', 'valor'],
  DespesasDiaADia: ['id', 'data', 'descricao', 'categoria', 'valor'],
  GastosFixos: ['id', 'descricao', 'categoria', 'valorMensal', 'diaVencimento', 'ativo'],
  CartaoCredito: ['id', 'data', 'descricao', 'categoria', 'valor', 'cartao', 'parcelaAtual', 'parcelasTotal'],
  Poupanca: ['id', 'data', 'tipo', 'valor', 'observacao'],
  Config: ['chave', 'valor']
};

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(COLUMNS[name]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetToObjects_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = values.slice(1);
  return rows
    .map(function (row, idx) {
      var obj = { _row: idx + 2 }; // linha real na planilha (1-based, +1 pelo cabeçalho)
      headers.forEach(function (h, i) {
        obj[h] = row[i];
      });
      return obj;
    })
    .filter(function (obj) {
      return obj.id !== '' && obj.id !== undefined && obj.id !== null;
    });
}

function appendObject_(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = COLUMNS[sheetName];
  if (!obj.id) {
    obj.id = Utilities.getUuid();
  }
  var row = headers.map(function (h) {
    return obj[h] !== undefined ? obj[h] : '';
  });
  sheet.appendRow(row);
  return obj;
}

function deleteObjectById_(sheetName, id) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idCol = headers.indexOf('id');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function updateObjectById_(sheetName, id, updates) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idCol = headers.indexOf('id');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) {
      headers.forEach(function (h, colIdx) {
        if (updates[h] !== undefined) {
          sheet.getRange(i + 1, colIdx + 1).setValue(updates[h]);
        }
      });
      return true;
    }
  }
  return false;
}

function getConfig_() {
  var rows = sheetToObjects_(SHEETS.CONFIG);
  var config = {};
  rows.forEach(function (r) {
    config[r.chave] = r.valor;
  });
  return config;
}

function setConfig_(chave, valor) {
  var sheet = getSheet_(SHEETS.CONFIG);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === chave) {
      sheet.getRange(i + 1, 2).setValue(valor);
      return;
    }
  }
  sheet.appendRow([chave, valor]);
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doGet(e) {
  try {
    var action = e.parameter.action || 'all';

    if (action === 'all') {
      return jsonResponse_({
        ok: true,
        receitas: sheetToObjects_(SHEETS.RECEITAS),
        despesas: sheetToObjects_(SHEETS.DESPESAS),
        fixos: sheetToObjects_(SHEETS.FIXOS),
        cartao: sheetToObjects_(SHEETS.CARTAO),
        poupanca: sheetToObjects_(SHEETS.POUPANCA),
        config: getConfig_()
      });
    }

    return jsonResponse_({ ok: false, error: 'Ação inválida' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var sheetKey = body.sheet; // 'receitas' | 'despesas' | 'fixos' | 'cartao' | 'poupanca'

    var sheetNameMap = {
      receitas: SHEETS.RECEITAS,
      despesas: SHEETS.DESPESAS,
      fixos: SHEETS.FIXOS,
      cartao: SHEETS.CARTAO,
      poupanca: SHEETS.POUPANCA
    };

    if (action === 'add') {
      var sheetName = sheetNameMap[sheetKey];
      if (!sheetName) return jsonResponse_({ ok: false, error: 'Aba inválida' });
      var created = appendObject_(sheetName, body.data);
      return jsonResponse_({ ok: true, item: created });
    }

    if (action === 'delete') {
      var sheetName2 = sheetNameMap[sheetKey];
      if (!sheetName2) return jsonResponse_({ ok: false, error: 'Aba inválida' });
      var deleted = deleteObjectById_(sheetName2, body.id);
      return jsonResponse_({ ok: deleted });
    }

    if (action === 'update') {
      var sheetName3 = sheetNameMap[sheetKey];
      if (!sheetName3) return jsonResponse_({ ok: false, error: 'Aba inválida' });
      var updated = updateObjectById_(sheetName3, body.id, body.data);
      return jsonResponse_({ ok: updated });
    }

    if (action === 'setConfig') {
      setConfig_(body.chave, body.valor);
      return jsonResponse_({ ok: true });
    }

    return jsonResponse_({ ok: false, error: 'Ação inválida' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}
