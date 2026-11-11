import crypto from 'node:crypto';
import path from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Doc, ProjectFile, TicketFile, TicketLink } from '@officepm/shared';
import type { Context } from 'hono';
import type { AppContext, JsonBody, SessionUser } from '../../context.js';
import { resolveStoredPath, schema } from '../../db/index.js';
import { badRequest, notFound } from '../../http/errors.js';
import { unlinkQuietly } from '../../lib/files.js';
import { isSafeUrl } from '../../lib/urls.js';
import {
  downloadResponse,
  MAX_FILES_PER_PROJECT,
  MAX_FILES_PER_TICKET,
  receiveUpload,
} from './uploads.js';

// A ticket key is <PREFIX>-<NUMBER>; with the row-exists check below this is the
// allow-list that keeps an upload directory name from being anything else.
const TICKET_KEY = /^[A-Z0-9]+(-[A-Z0-9]+)*-\d+$/;

export function createAttachmentService(ctx: AppContext) {
  const { orm } = ctx.db;
  const { projectDocs, projectFiles, ticketLinks, ticketFiles, tickets } = schema;
  const { dataDir, uploadsDir } = ctx.config;

  const projectFileCols = {
    id: projectFiles.id,
    project_slug: projectFiles.project_slug,
    original_name: projectFiles.original_name,
    size_bytes: projectFiles.size_bytes,
    mime_type: projectFiles.mime_type,
    uploaded_by: projectFiles.uploaded_by,
    created_at: projectFiles.created_at,
  };
  const ticketFileCols = {
    id: ticketFiles.id,
    ticket_key: ticketFiles.ticket_key,
    original_name: ticketFiles.original_name,
    size_bytes: ticketFiles.size_bytes,
    mime_type: ticketFiles.mime_type,
    uploaded_by: ticketFiles.uploaded_by,
    created_at: ticketFiles.created_at,
  };
  const projectFileWhere = (slug: string, id: string) =>
    and(eq(projectFiles.id, id), eq(projectFiles.project_slug, slug));
  const ticketFileWhere = (key: string, id: string) =>
    and(eq(ticketFiles.id, id), eq(ticketFiles.ticket_key, key));

  function fileResponse(storedPath: string, name: string): Response {
    // Resolved against the current data directory, so a database moved from
    // another machine still finds its files. v1 rows hold absolute paths.
    const file = resolveStoredPath(dataDir, storedPath);
    if (!file) throw notFound('file not found');
    return downloadResponse(file, name);
  }

  function removeStored(storedPath: string): void {
    const file = resolveStoredPath(dataDir, storedPath);
    if (file) unlinkQuietly(file);
  }

  return {
    // ---- project docs ----
    listDocs: (slug: string): Doc[] =>
      orm
        .select()
        .from(projectDocs)
        .where(eq(projectDocs.project_slug, slug))
        .orderBy(desc(projectDocs.created_at))
        .all() as Doc[],

    createDoc(slug: string, b: JsonBody, user: SessionUser): Doc {
      if (!b.title || !b.kind) throw badRequest('title and kind required');
      if (b.url && !isSafeUrl(b.url)) throw badRequest('url must be http: or https:');
      return orm
        .insert(projectDocs)
        .values({
          id: crypto.randomUUID(),
          project_slug: slug,
          title: b.title as string,
          kind: b.kind as string,
          url: (b.url as string) || null,
          body: (b.body as string) || null,
          author: user.name,
        })
        .returning()
        .get() as Doc;
    },

    removeDoc(slug: string, id: string): void {
      orm
        .delete(projectDocs)
        .where(and(eq(projectDocs.id, id), eq(projectDocs.project_slug, slug)))
        .run();
    },

    // ---- project files ----
    listProjectFiles: (slug: string): ProjectFile[] =>
      orm
        .select(projectFileCols)
        .from(projectFiles)
        .where(eq(projectFiles.project_slug, slug))
        .orderBy(desc(projectFiles.created_at))
        .all() as ProjectFile[],

    async uploadProjectFile(c: Context, slug: string, user: SessionUser): Promise<ProjectFile> {
      // The slug becomes a directory name, so it must be one projects.json declares.
      if (!ctx.projects.findProject(slug)) throw notFound('project not found');
      const count =
        orm
          .select({ n: sql<number>`count(*)` })
          .from(projectFiles)
          .where(eq(projectFiles.project_slug, slug))
          .get()?.n ?? 0;
      if (count >= MAX_FILES_PER_PROJECT) {
        throw badRequest('project already has the maximum of ' + MAX_FILES_PER_PROJECT + ' files');
      }
      const upload = await receiveUpload(c, path.join(uploadsDir, 'projects', slug), uploadsDir);
      if (!upload) throw badRequest('file required');
      return orm
        .insert(projectFiles)
        .values({
          id: crypto.randomUUID(),
          project_slug: slug,
          original_name: upload.originalName,
          stored_path: upload.storedPath,
          size_bytes: upload.size,
          mime_type: upload.mimetype,
          uploaded_by: user.name,
        })
        .returning(projectFileCols)
        .get() as ProjectFile;
    },

    downloadProjectFile(slug: string, id: string): Response {
      const f = orm.select().from(projectFiles).where(projectFileWhere(slug, id)).get();
      if (!f) throw notFound('file not found');
      return fileResponse(f.stored_path, f.original_name);
    },

    removeProjectFile(slug: string, id: string): void {
      const f = orm.select().from(projectFiles).where(projectFileWhere(slug, id)).get();
      if (f) removeStored(f.stored_path);
      orm.delete(projectFiles).where(projectFileWhere(slug, id)).run();
    },

    // ---- ticket links ----
    listLinks: (key: string): TicketLink[] =>
      orm
        .select()
        .from(ticketLinks)
        .where(eq(ticketLinks.ticket_key, key))
        .orderBy(desc(ticketLinks.created_at))
        .all() as TicketLink[],

    createLink(key: string, b: JsonBody, user: SessionUser): TicketLink {
      if (!b.title || !b.url) throw badRequest('title and url required');
      if (!isSafeUrl(b.url)) throw badRequest('url must be http: or https:');
      return orm
        .insert(ticketLinks)
        .values({
          id: crypto.randomUUID(),
          ticket_key: key,
          title: b.title as string,
          url: b.url as string,
          author: user.name,
        })
        .returning()
        .get() as TicketLink;
    },

    removeLink(key: string, id: string): void {
      orm
        .delete(ticketLinks)
        .where(and(eq(ticketLinks.id, id), eq(ticketLinks.ticket_key, key)))
        .run();
    },

    // ---- ticket files ----
    listTicketFiles: (key: string): TicketFile[] =>
      orm
        .select(ticketFileCols)
        .from(ticketFiles)
        .where(eq(ticketFiles.ticket_key, key))
        .orderBy(desc(ticketFiles.created_at))
        .all() as TicketFile[],

    async uploadTicketFile(c: Context, key: string, user: SessionUser): Promise<TicketFile> {
      if (!TICKET_KEY.test(key)) throw notFound('ticket not found');
      if (!orm.select({ key: tickets.key }).from(tickets).where(eq(tickets.key, key)).get()) {
        throw notFound('ticket not found');
      }
      const count =
        orm
          .select({ n: sql<number>`count(*)` })
          .from(ticketFiles)
          .where(eq(ticketFiles.ticket_key, key))
          .get()?.n ?? 0;
      if (count >= MAX_FILES_PER_TICKET) {
        throw badRequest('ticket already has the maximum of ' + MAX_FILES_PER_TICKET + ' files');
      }
      const upload = await receiveUpload(c, path.join(uploadsDir, 'tickets', key), uploadsDir);
      if (!upload) throw badRequest('file required');
      return orm
        .insert(ticketFiles)
        .values({
          id: crypto.randomUUID(),
          ticket_key: key,
          original_name: upload.originalName,
          stored_path: upload.storedPath,
          size_bytes: upload.size,
          mime_type: upload.mimetype,
          uploaded_by: user.name,
        })
        .returning(ticketFileCols)
        .get() as TicketFile;
    },

    downloadTicketFile(key: string, id: string): Response {
      const f = orm.select().from(ticketFiles).where(ticketFileWhere(key, id)).get();
      if (!f) throw notFound('file not found');
      return fileResponse(f.stored_path, f.original_name);
    },

    removeTicketFile(key: string, id: string): void {
      const f = orm.select().from(ticketFiles).where(ticketFileWhere(key, id)).get();
      if (f) removeStored(f.stored_path);
      orm.delete(ticketFiles).where(ticketFileWhere(key, id)).run();
    },
  };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
