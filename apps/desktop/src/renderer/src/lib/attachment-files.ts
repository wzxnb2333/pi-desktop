import { MAX_ATTACHMENT_BYTES, type AttachmentUpload } from '../../../shared/attachments.ts';

export async function readAttachmentFiles(files: File[]): Promise<AttachmentUpload[]> {
  if (!files.length || files.length > 10) throw new Error('每次最多添加 10 个附件');
  if (files.some(file => file.size > MAX_ATTACHMENT_BYTES)) throw new Error('附件大小不能超过 10 MB');
  const uploads: AttachmentUpload[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 32768)
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    uploads.push({ name: file.name, base64: btoa(chunks.join('')) });
  }
  return uploads;
}
