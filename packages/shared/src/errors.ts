import { z } from 'zod';

/** Every non-2xx JSON response from the API has exactly this shape. */
export const ErrorBodySchema = z.object({ error: z.string() });
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** `{ ok: true }`, returned by deletes and some patches. */
export const OkSchema = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof OkSchema>;
