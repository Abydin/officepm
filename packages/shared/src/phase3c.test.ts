import { describe, expect, it } from 'vitest';
import {
  DocCreateSchema,
  DocListSchema,
  PasswordResetSchema,
  ProjectFileListSchema,
  ProjectsConfigSchema,
  RetroCreateSchema,
  RetroListSchema,
  SprintCreateSchema,
  SprintPatchSchema,
  UserCreateSchema,
} from './index.js';

describe('request schemas for the phase 3c screens', () => {
  it('sprint create needs a non-blank name and takes optional dates and kind', () => {
    expect(SprintCreateSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(
      SprintCreateSchema.parse({ name: 'S1', kind: 'cycle', start_date: '2026-01-01' }),
    ).toMatchObject({ name: 'S1', kind: 'cycle' });
    expect(SprintCreateSchema.safeParse({ name: 'S1', kind: 'epoch' }).success).toBe(false);
    expect(SprintCreateSchema.safeParse({ name: 'S1', start_date: '01/02/2026' }).success).toBe(
      false,
    );
  });

  it('sprint patch is a partial and refuses a status it does not know about', () => {
    expect(SprintPatchSchema.parse({})).toEqual({});
    expect(SprintPatchSchema.parse({ status: 'active' })).toEqual({ status: 'active' });
    expect(SprintPatchSchema.safeParse({ status: 'finished' }).success).toBe(false);
  });

  it('doc create needs a title and kind; the url, when present, must be http or https', () => {
    expect(DocCreateSchema.safeParse({ title: 'Spec', kind: 'link' }).success).toBe(true);
    expect(DocCreateSchema.safeParse({ title: '', kind: 'link' }).success).toBe(false);
    expect(
      DocCreateSchema.safeParse({ title: 'x', kind: 'link', url: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      DocCreateSchema.safeParse({ title: 'x', kind: 'link', url: 'https://example.com/a' }).success,
    ).toBe(true);
  });

  it('user create and password reset mirror the server rules', () => {
    expect(
      UserCreateSchema.safeParse({ email: 'a@b.co', name: 'A', password: 'secret1' }).success,
    ).toBe(true);
    expect(UserCreateSchema.safeParse({ email: '', name: 'A', password: 'x' }).success).toBe(false);
    expect(PasswordResetSchema.safeParse({ password: '12345' }).success).toBe(false);
    expect(PasswordResetSchema.safeParse({ password: '123456' }).success).toBe(true);
    expect(RetroCreateSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('response schemas for the phase 3c screens', () => {
  it('validates doc, file and retro lists', () => {
    expect(DocListSchema.parse([])).toEqual([]);
    expect(ProjectFileListSchema.parse([])).toEqual([]);
    expect(RetroListSchema.safeParse({}).success).toBe(false);
    expect(
      RetroListSchema.parse([
        {
          id: 'r',
          project_slug: 'food',
          board_slug: 'eng',
          sprint_id: null,
          name: 'Retro',
          status: 'open',
          created_at: 'x',
        },
      ]),
    ).toHaveLength(1);
  });

  it('keeps unknown fields of projects.json but needs the slug, name and boards', () => {
    const config = {
      projects: [
        { slug: 'a', name: 'A', description: 'd', boards: [{ slug: 'b', name: 'B', extra: 1 }] },
      ],
    };
    expect(ProjectsConfigSchema.parse(config)).toEqual(config);
    expect(ProjectsConfigSchema.safeParse({ projects: [{ slug: 'a' }] }).success).toBe(false);
  });
});
