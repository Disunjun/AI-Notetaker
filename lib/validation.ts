import { z } from 'zod';
import { AppError, ErrorCode } from '@/lib/errors';
import { fieldsFromZodIssues } from '@/lib/http/respond';

/** Request validation schemas. Every route validates through these. */

export const EmailSchema = z
  .string()
  .trim()
  .min(3, 'Email is required')
  .max(254, 'Email is too long')
  .email('Email must be a valid address')
  .transform((v) => v.toLowerCase());

export const RequestLinkSchema = z.object({
  email: EmailSchema,
});

export const RequestOtpSchema = RequestLinkSchema;

export const VerifySchema = z.object({
  email: EmailSchema,
  /** Present for magic-link verification. */
  token: z.string().trim().min(16).max(512).optional(),
  /** Present for OTP verification: exactly 6 digits. */
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Code must be 6 digits')
    .optional(),
  method: z.enum(['magic_link', 'otp']).optional(),
});

export const AdminLoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password is required').max(256),
});

export const ActionItemPatchSchema = z
  .object({
    completed: z.boolean().optional(),
    content: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((v) => v.completed !== undefined || v.content !== undefined, {
    message: 'Provide at least one field to update',
  });

export const ProviderRoleSchema = z.enum(['TRANSCRIPTION', 'TEXT']);

export const AIProviderUpsertSchema = z.object({
  name: z.string().trim().min(1).max(64),
  provider: z.enum(['OPENAI', 'GROQ', 'GOOGLE', 'ANTHROPIC', 'OPENAI_COMPATIBLE']),
  baseUrl: z
    .string()
    .trim()
    .url('baseUrl must be an absolute URL')
    .max(512)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  model: z.string().trim().min(1).max(128),
  isPrimary: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  /**
   * Optional. When omitted on update the stored key is preserved, so the admin
   * UI never has to echo a secret back.
   */
  apiKey: z.string().trim().min(8).max(512).optional(),
});

export const ResendUpsertSchema = z.object({
  fromEmail: EmailSchema,
  fromName: z.string().trim().min(1).max(128).optional().nullable(),
  replyTo: z.string().trim().email().max(254).optional().nullable(),
  isActive: z.boolean().optional(),
  apiKey: z.string().trim().min(8).max(512).optional(),
});

export const ResendTestSchema = z.object({
  to: EmailSchema,
});

export function parseWith<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Validation failed', {
      fields: fieldsFromZodIssues(result.error.issues),
    });
  }
  return result.data;
}
