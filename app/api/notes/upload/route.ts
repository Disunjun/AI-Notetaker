import { ok, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { clientIdentifier, enforceRateLimit } from '@/lib/security/rate-limit';
import { redis } from '@/lib/redis';
import { requireUser } from '@/lib/auth/sessions';
import { createNoteFromUpload } from '@/lib/upload/service';
import { AppError, ErrorCode } from '@/lib/errors';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notes/upload
 *
 * validate -> save file -> create Note -> create Job (QUEUED) -> enqueue -> 202.
 * If no AI provider is configured this returns 503 AI_PROVIDER_NOT_CONFIGURED
 * and creates no Note, no Job and no queue entry.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(req);
  await enforceRateLimit(redis(), 'notes:upload', clientIdentifier(req, user.email), 20, 60 * 60);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Expected a multipart/form-data body');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AppError(ErrorCode.UPLOAD_MISSING, 'A file field named "file" is required');
  }
  if (file.size > env().MAX_UPLOAD_SIZE) {
    throw new AppError(ErrorCode.UPLOAD_TOO_LARGE, 'Uploaded file exceeds the configured maximum size');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await createNoteFromUpload(user.id, {
    filename: file.name,
    mimeType: file.type,
    bytes,
  });

  return ok(
    {
      noteId: result.noteId,
      jobId: result.jobId,
      status: 'QUEUED',
      fileName: result.validated.displayName,
      fileSizeBytes: result.validated.size,
    },
    { status: 202 },
  );
});
