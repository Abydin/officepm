import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, renderApp, stubApi } from '@/test/helpers';
import { doc, foodProject, projectFile, signedIn } from '@/test/fixtures';

const URL_ = '/projects/food/docs';

function setup(extra: Record<string, unknown> = {}) {
  return stubApi({
    ...signedIn,
    'GET /api/projects/food': foodProject,
    'GET /api/projects/food/docs': [doc()],
    'GET /api/projects/food/files': [projectFile()],
    ...extra,
  });
}

describe('docs and files page', () => {
  it('lists links with where they open and who added them, and files with a download', async () => {
    setup();
    renderApp(URL_);

    const links = within(await screen.findByRole('region', { name: 'Links' }));
    const open = await links.findByRole('link', { name: /Ordering API reference/ });
    expect(open).toHaveAttribute('href', 'https://example.com/docs/ordering-api');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(links.getByText('Endpoints, auth and error codes.')).toBeVisible();

    const files = within(screen.getByRole('region', { name: 'Files' }));
    expect(await files.findByRole('listitem')).toHaveTextContent('menu.pdf20 KB · Maya Okafor');
    expect(files.getByRole('link', { name: /Download menu.pdf/ })).toHaveAttribute(
      'href',
      '/api/projects/food/files/f1',
    );
  });

  it('states the upload limits the server enforces', async () => {
    setup();
    renderApp(URL_);
    const files = within(await screen.findByRole('region', { name: 'Files' }));
    expect(files.getByText(/100 files per project, 25 MB each/)).toBeVisible();
    expect(files.getByText(/\.exe, \.sh, \.bat, \.cmd, \.js, \.html and \.htm/)).toBeVisible();
  });

  it('adds a link, and shows the server message for a bad address', async () => {
    const posts: unknown[] = [];
    setup({
      'POST /api/projects/food/docs': (init: RequestInit | undefined) => {
        posts.push(JSON.parse(String(init?.body)));
        return posts.length === 1
          ? jsonResponse({ error: 'url must be http: or https:' }, 400)
          : jsonResponse(doc({ id: 'd2' }), 201);
      },
    });
    const user = userEvent.setup();
    renderApp(URL_);

    await user.type(await screen.findByLabelText('Link title'), 'Spec');
    await user.type(screen.getByLabelText('Link URL'), 'ftp://x');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('url must be http: or https:');

    await user.clear(screen.getByLabelText('Link URL'));
    await user.type(screen.getByLabelText('Link URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({ title: 'Spec', kind: 'link', url: 'https://example.com' });
  });

  it('uploads a file as multipart form data', async () => {
    let sent: FormData | undefined;
    setup({
      'POST /api/projects/food/files': (init: RequestInit | undefined) => {
        sent = init?.body as FormData;
        return jsonResponse(projectFile({ id: 'f2', original_name: 'notes.txt' }), 201);
      },
    });
    const user = userEvent.setup();
    renderApp(URL_);

    const input = await screen.findByLabelText('Project file');
    await user.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() => expect(sent).toBeInstanceOf(FormData));
    expect((sent?.get('file') as File).name).toBe('notes.txt');
  });

  it('shows the server reason when an upload is refused', async () => {
    setup({
      'POST /api/projects/food/files': () => jsonResponse({ error: 'file type not allowed' }, 400),
    });
    const user = userEvent.setup();
    renderApp(URL_);
    await user.upload(
      await screen.findByLabelText('Project file'),
      new File(['x'], 'run.sh', { type: 'text/plain' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('file type not allowed');
  });

  it('asks before deleting a link, and deletes only when confirmed', async () => {
    const deletes: string[] = [];
    setup({
      'DELETE /api/projects/food/docs/d1': () => {
        deletes.push('d1');
        return jsonResponse({ ok: true });
      },
    });
    const user = userEvent.setup();
    renderApp(URL_);

    const links = within(await screen.findByRole('region', { name: 'Links' }));
    await user.click(await links.findByRole('button', { name: 'Delete Ordering API reference' }));
    expect(deletes).toEqual([]);
    await user.click(links.getByRole('button', { name: 'Keep it' }));
    expect(links.queryByRole('button', { name: 'Yes, delete' })).not.toBeInTheDocument();

    await user.click(links.getByRole('button', { name: 'Delete Ordering API reference' }));
    await user.click(links.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(deletes).toEqual(['d1']));
  });
});
