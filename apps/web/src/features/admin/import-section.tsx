import { useState, type ChangeEvent } from 'react';
import { MAX_IMPORT_CSV_CHARS, MAX_IMPORT_ROWS, type ImportResult } from '@officepm/shared';
import { CopyButton } from '@/components/copy-button';
import { ErrorAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { errorMessage } from '@/lib/api';
import { downloadText } from '@/lib/clipboard';
import { useImportStaff } from './api';
import { td, tableBox, th } from './invites-section';

const EXAMPLE = 'email,name,is_admin\nada@example.com,Ada Obi,\nbayo@example.com,Bayo Ade,yes';

function ResultTable({ result, label }: { result: ImportResult; label: string }) {
  const links = !result.dry_run;
  return (
    <div className={`${tableBox} mt-3`}>
      <table aria-label={label} className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-xs text-dim">
            {['Row', 'Email', 'Name', 'Role', 'Result', ...(links ? ['Invite link'] : [])].map(
              (h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.row} className="border-b border-line align-top last:border-b-0">
              <td className={td}>{r.row}</td>
              <td className={`${td} break-all`}>{r.email}</td>
              <td className={td}>{r.name}</td>
              <td className={td}>
                {r.is_admin ? <Badge>Admin</Badge> : <span className="text-dim">Member</span>}
              </td>
              <td className={td}>
                {r.status === 'ok' ? (
                  <span>{result.dry_run ? 'Ready' : 'Invited'}</span>
                ) : (
                  <span className="font-medium">Problem: {r.error}</span>
                )}
              </td>
              {links && (
                <td className={`${td} font-mono text-xs break-all`}>{r.invite_link ?? ''}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Invite many people from a pasted or uploaded CSV. Always a preview first (a dry run that writes
 * nothing); the button that creates invites only exists for the text that was previewed, so what
 * is created is what was checked. The links come back once, here, as a table and a CSV.
 */
export function ImportSection() {
  const importStaff = useImportStaff();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ csv: string; result: ImportResult } | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState('');

  const previewed = preview && preview.csv === csv ? preview.result : null;
  const tooBig = csv.length > MAX_IMPORT_CSV_CHARS;

  const edit = (text: string) => {
    setCsv(text);
    setDone(null);
    setFileError('');
    importStaff.reset();
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_CSV_CHARS * 4) {
      setFileError(`That file is too large. Keep it under ${MAX_IMPORT_CSV_CHARS / 1024} KB.`);
      return;
    }
    edit(await file.text());
  };

  const runPreview = () =>
    importStaff.mutate(
      { csv, dry_run: true },
      { onSuccess: (result) => setPreview({ csv, result }) },
    );
  const create = () =>
    importStaff.mutate({ csv, dry_run: false }, { onSuccess: (result) => setDone(result) });

  const allLinks = done?.rows
    .filter((r) => r.invite_link)
    .map((r) => `${r.email}\t${r.invite_link}`)
    .join('\n');

  return (
    <Card aria-labelledby="import-staff" className="mt-6">
      <h2 id="import-staff" className="m-0 mb-1 text-[15px] font-semibold">
        Import staff from CSV
      </h2>
      <p className="mt-0 mb-3 text-dim">
        Paste or upload a CSV with the header <code className="font-mono">email,name,is_admin</code>{' '}
        (is_admin is optional). Up to {MAX_IMPORT_ROWS} people. Each valid row gets an invite link;
        you check a preview first, and nothing is created until you confirm.
      </p>
      {!done && (
        <>
          <label htmlFor="import-csv" className="mb-1 block text-xs text-dim">
            CSV text
          </label>
          <textarea
            id="import-csv"
            rows={6}
            spellCheck={false}
            placeholder={EXAMPLE}
            value={csv}
            onChange={(e) => edit(e.target.value)}
            className="min-h-24 w-full rounded-md border border-line-strong bg-field px-2.5 py-1.5 font-mono text-xs text-fg transition-colors placeholder:text-dim/80 hover:border-dim focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label htmlFor="import-file" className="text-xs text-dim">
              Or choose a CSV file
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => void upload(e)}
              className="text-xs"
            />
            <span className="flex-1" />
            <Button
              variant="primary"
              disabled={!csv.trim() || tooBig || importStaff.isPending}
              onClick={runPreview}
            >
              Preview
            </Button>
          </div>
          {tooBig && (
            <p className="mt-2 mb-0 text-xs text-err">
              That is over {MAX_IMPORT_CSV_CHARS / 1024} KB. Split it into smaller files.
            </p>
          )}
          {fileError && <p className="mt-2 mb-0 text-xs text-err">{fileError}</p>}
        </>
      )}
      {importStaff.isError && (
        <ErrorAlert className="mt-3">{errorMessage(importStaff.error)}</ErrorAlert>
      )}

      {previewed && !done && (
        <>
          <ResultTable result={previewed} label="Import preview" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span>
              {previewed.valid} of {previewed.total} rows can be invited
              {previewed.failed > 0
                ? `, ${previewed.failed} with a problem (they will be skipped)`
                : ''}
              .
            </span>
            <span className="flex-1" />
            <Button
              variant="primary"
              disabled={previewed.valid === 0 || importStaff.isPending}
              onClick={create}
            >
              Create {previewed.valid} {previewed.valid === 1 ? 'invite' : 'invites'}
            </Button>
          </div>
        </>
      )}

      {done && (
        <>
          <p className="mt-0 mb-0">
            Created {done.created} {done.created === 1 ? 'invite' : 'invites'}
            {done.failed > 0 ? `, skipped ${done.failed}` : ''}. These links are shown once: copy or
            download them now. OfficePM sends no email.
          </p>
          <ResultTable result={done} label="Import results" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {allLinks ? <CopyButton text={allLinks} name="all invite links" /> : null}
            {done.csv && done.created > 0 && (
              <Button
                size="sm"
                onClick={() => downloadText('officepm-invites.csv', done.csv ?? '')}
              >
                Download CSV
              </Button>
            )}
            <span className="flex-1" />
            <Button
              onClick={() => {
                setPreview(null);
                edit('');
              }}
            >
              Import more
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
