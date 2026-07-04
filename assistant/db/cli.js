#!/usr/bin/env node
/**
 * CEO HQ database CLI.
 *
 * Usage:
 *   node assistant/db/cli.js tables
 *   node assistant/db/cli.js list <table> [--Entity Company-A] [--Status פתוח] [--limit 20]
 *   node assistant/db/cli.js find <table> <free text>
 *   node assistant/db/cli.js add <table> '{"Name":"...","Entity":"Company-A",...}'
 *   node assistant/db/cli.js update <table> <ID> '{"Status":"בטיפול"}'
 *   node assistant/db/cli.js report [--Entity Company-A]
 *
 * Output is JSON (machine-readable, for use by AI agents and scripts).
 */
const { loadConfig, readTable, addRecord, updateRecord, filterRecords, searchRecords, TABLES } = require('./client');

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else {
      rest.push(args[i]);
    }
  }
  return { flags, rest };
}

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const { flags, rest } = parseFlags(args);

  switch (cmd) {
    case 'tables': {
      const config = loadConfig();
      output(Object.fromEntries(Object.entries(TABLES).map(([name, t]) => [
        name, { columns: t.columns, fileId: config.tables[name].fileId },
      ])));
      break;
    }
    case 'list': {
      const [table] = rest;
      const limit = parseInt(flags.limit || '50', 10);
      delete flags.limit;
      let records = await readTable(table);
      if (Object.keys(flags).length) records = filterRecords(records, flags);
      output({ table, count: records.length, records: records.slice(0, limit) });
      break;
    }
    case 'find': {
      const [table, ...words] = rest;
      const records = searchRecords(await readTable(table), words.join(' '));
      output({ table, count: records.length, records });
      break;
    }
    case 'add': {
      const [table, json] = rest;
      const record = await addRecord(table, JSON.parse(json));
      output({ ok: true, table, record });
      break;
    }
    case 'update': {
      const [table, id, json] = rest;
      const record = await updateRecord(table, id, JSON.parse(json));
      output({ ok: true, table, record });
      break;
    }
    case 'report': {
      const entityFilter = flags.Entity;
      const report = {};
      for (const table of Object.keys(TABLES)) {
        let records = await readTable(table);
        if (entityFilter) records = filterRecords(records, { Entity: entityFilter });
        const open = records.filter((r) =>
          !/^(סגור|הושלם|בוצע|בוטל|closed|done|won|lost)$/i.test(String(r.Status || '').trim())
        );
        report[table] = { total: records.length, open: open.length };
      }
      output({ entity: entityFilter || 'all', report });
      break;
    }
    default:
      console.error('Unknown command. Commands: tables | list | find | add | update | report');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
