import { z } from 'zod';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const attachmentUploadSchema = z.object({
  name: z.string().min(1).max(255),
  base64: z.string().max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4),
}).strict();
export type AttachmentUpload = z.infer<typeof attachmentUploadSchema>;
