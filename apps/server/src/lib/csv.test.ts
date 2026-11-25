import { describe, expect, it } from 'vitest';
import { csvCell, csvLine, CsvError, parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('reads plain records with LF, CRLF and CR line ends', () => {
    expect(parseCsv('a,b\n1,2\r\n3,4\r5,6')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('drops a byte order mark, blank lines and the final newline', () => {
    expect(parseCsv('﻿email,name\n\n\na@b.co,Ada\n\n')).toEqual([
      ['email', 'name'],
      ['a@b.co', 'Ada'],
    ]);
  });

  it('keeps commas, doubled quotes and line breaks inside a quoted value', () => {
    expect(parseCsv('"Doe, Jane","say ""hi""","two\nlines"\n')).toEqual([
      ['Doe, Jane', 'say "hi"', 'two\nlines'],
    ]);
  });

  it('keeps empty fields, including a trailing one', () => {
    expect(parseCsv('a,,c,\n,,\n')).toEqual([
      ['a', '', 'c', ''],
      ['', '', ''],
    ]);
  });

  it('refuses a quote that is never closed, a stray quote and text after a closing quote', () => {
    expect(() => parseCsv('"open,b')).toThrow(CsvError);
    expect(() => parseCsv('ab"c,d')).toThrow(CsvError);
    expect(() => parseCsv('"a"b,c')).toThrow(CsvError);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\r\n')).toEqual([]);
  });
});

describe('csvCell', () => {
  it('puts an apostrophe in front of anything a spreadsheet would run as a formula', () => {
    for (const v of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      expect(csvCell(v)).toMatch(/^"?'/);
    }
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it('leaves ordinary text alone and quotes only what needs it', () => {
    expect(csvCell('Ada')).toBe('Ada');
    expect(csvCell('a-b@c.co')).toBe('a-b@c.co');
    expect(csvCell('Doe, Jane')).toBe('"Doe, Jane"');
    expect(csvLine(['a', 'b,c', '=x'])).toBe(`a,"b,c",'=x`);
  });
});
