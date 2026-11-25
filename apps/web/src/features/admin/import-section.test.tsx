import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { signedIn } from '@/test/fixtures';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';

const CSV = 'email,name,is_admin\nada@x.test,Ada,\nbad,Bad Row,';

const row = (over: Record<string, unknown>) => ({
  row: 1,
  email: 'ada@x.test',
  name: 'Ada',
  is_admin: false,
  status: 'ok',
  error: null,
  invite_link: null,
  ...over,
});

const previewResult = {
  dry_run: true,
  total: 2,
  valid: 1,
  created: 0,
  failed: 1,
  csv: null,
  rows: [
    row({}),
    row({
      row: 2,
      email: 'bad',
      name: 'Bad Row',
      status: 'error',
      error: 'email must be an email address',
    }),
  ],
};
const realResult = {
  ...previewResult,
  dry_run: false,
  created: 1,
  csv: 'email,name,invite_link\r\nada@x.test,Ada,http://h/#/invite/T\r\n',
  rows: [row({ invite_link: 'http://h/#/invite/T' }), previewResult.rows[1]],
};

const routes = (extra: Record<string, unknown> = {}) => ({
  ...signedIn,
  'GET /api/admin/projects': { projects: [] },
  'GET /api/projects': [],
  'GET /api/invites': [],
  ...extra,
});

describe('import staff from CSV', () => {
  it('previews first, shows each row, and creates only after a confirm', async () => {
    const bodies: Array<{ csv: string; dry_run: boolean }> = [];
    stubApi(
      routes({
        'POST /api/invites/import': (init: RequestInit | undefined) => {
          const body = JSON.parse(String(init?.body));
          bodies.push(body);
          return jsonResponse(body.dry_run ? previewResult : realResult);
        },
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');

    const box = await screen.findByLabelText('CSV text');
    await user.click(box);
    await user.paste(CSV);
    // Nothing is created by pasting, and there is nothing to confirm before a preview.
    expect(screen.queryByRole('button', { name: /^Create \d/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const table = within(await screen.findByRole('table', { name: 'Import preview' }));
    expect(table.getByRole('row', { name: /ada@x.test/ })).toHaveTextContent('Ready');
    expect(table.getByRole('row', { name: /Bad Row/ })).toHaveTextContent(
      'Problem: email must be an email address',
    );
    expect(screen.getByText(/1 of 2 rows can be invited, 1 with a problem/)).toBeVisible();
    expect(bodies).toEqual([{ csv: CSV, dry_run: true }]);

    await user.click(screen.getByRole('button', { name: 'Create 1 invite' }));
    const results = within(await screen.findByRole('table', { name: 'Import results' }));
    expect(results.getByRole('row', { name: /ada@x.test/ })).toHaveTextContent(
      'http://h/#/invite/T',
    );
    expect(results.getByRole('row', { name: /ada@x.test/ })).toHaveTextContent('Invited');
    expect(bodies[1]).toEqual({ csv: CSV, dry_run: false });
    expect(screen.getByText(/shown once/)).toBeVisible();
  });

  it('forgets the preview when the text changes, so only checked text can be created', async () => {
    stubApi(routes({ 'POST /api/invites/import': previewResult }));
    const user = userEvent.setup();
    renderApp('/admin');
    await user.click(await screen.findByLabelText('CSV text'));
    await user.paste(CSV);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('button', { name: 'Create 1 invite' })).toBeVisible();
    await user.type(screen.getByLabelText('CSV text'), '\nc@x.test,C');
    expect(screen.queryByRole('button', { name: /^Create \d/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Import preview' })).not.toBeInTheDocument();
  });

  it('offers copy-all and a CSV download of the links, and starts over on request', async () => {
    const writeText = vi.fn(async () => {});
    stubApi(
      routes({
        'POST /api/invites/import': (init: RequestInit | undefined) =>
          jsonResponse(JSON.parse(String(init?.body)).dry_run ? previewResult : realResult),
      }),
    );
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
    const created: Blob[] = [];
    const makeUrl = vi.fn((b: Blob) => (created.push(b), 'blob:x'));
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: makeUrl, revokeObjectURL: vi.fn() }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderApp('/admin');

    await user.click(await screen.findByLabelText('CSV text'));
    await user.paste(CSV);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(await screen.findByRole('button', { name: 'Create 1 invite' }));

    await user.click(await screen.findByRole('button', { name: 'Copy all invite links' }));
    expect(writeText).toHaveBeenCalledWith('ada@x.test\thttp://h/#/invite/T');

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalled();
    expect(await created[0]!.text()).toBe(realResult.csv);

    await user.click(screen.getByRole('button', { name: 'Import more' }));
    expect(screen.getByLabelText('CSV text')).toHaveValue('');
    vi.unstubAllGlobals();
  });

  it('shows the server message when the file as a whole is refused', async () => {
    stubApi(
      routes({
        'POST /api/invites/import': () =>
          jsonResponse({ error: 'csv: unknown column "dept", expected email,name,is_admin' }, 400),
      }),
    );
    const user = userEvent.setup();
    renderApp('/admin');
    await user.click(await screen.findByLabelText('CSV text'));
    await user.paste('email,name,dept\na@x.test,A,x');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unknown column');
  });

  it('reads an uploaded file into the text box', async () => {
    stubApi(routes());
    const user = userEvent.setup();
    renderApp('/admin');
    const input = await screen.findByLabelText('Or choose a CSV file');
    await user.upload(input, new File([CSV], 'staff.csv', { type: 'text/csv' }));
    await waitFor(() => expect(screen.getByLabelText('CSV text')).toHaveValue(CSV));
  });

  it('will not preview an empty box or a file over the size limit', async () => {
    stubApi(routes());
    const user = userEvent.setup();
    renderApp('/admin');
    expect(await screen.findByRole('button', { name: 'Preview' })).toBeDisabled();
    await user.click(screen.getByLabelText('CSV text'));
    await user.paste('x'.repeat(128 * 1024 + 1));
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    expect(screen.getByText(/over 128 KB/)).toBeVisible();
  });
});
