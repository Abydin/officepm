// A small CSV reader and writer, so the staff import needs no dependency. The reader follows
// RFC 4180 closely enough for what spreadsheets export: a byte order mark, CRLF, LF or CR line
// ends, commas and line breaks inside quotes, "" for a quote inside quotes.

export class CsvError extends Error {}

/** Splits CSV text into records of fields. Records that are entirely blank are dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let i = 0;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"' && field === '') {
      // A quoted field: runs to the closing quote that is not doubled.
      i++;
      for (;;) {
        if (i >= text.length) throw new CsvError('a quoted value is never closed');
        const q = text[i] as string;
        if (q === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        field += q;
        i++;
      }
      const after = text[i];
      if (after !== undefined && after !== ',' && after !== '\n' && after !== '\r') {
        throw new CsvError('unexpected text after a closing quote');
      }
      continue;
    }
    if (ch === '"') throw new CsvError('a quote inside an unquoted value');
    if (ch === ',') {
      endField();
      i++;
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

/**
 * One cell for a CSV this server writes. A cell that begins with = + - @ (or a tab or carriage
 * return) would run as a formula when the file is opened in a spreadsheet, so it gets a leading
 * apostrophe, which spreadsheets show as plain text. Then it is quoted when it needs to be.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvLine(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}
