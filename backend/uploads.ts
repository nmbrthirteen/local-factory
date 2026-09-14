import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Attachment, ImageMediaType, PromptAttachment, PromptImage } from '../shared/types';

const imageExtensions: Record<ImageMediaType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const imageTypes = Object.fromEntries(Object.entries(imageExtensions).map(([type, extension]) => [extension, type])) as Record<string, ImageMediaType>;
const textExtension = 'txt';
const textMediaType = 'text/plain';
const maxBytes = 10 * 1024 * 1024;
const maxAttachments = 8;
const maxNameLength = 120;
const textLimit = 40_000;
const idPattern = new RegExp(`^[0-9a-f-]{36}\\.(${[...Object.values(imageExtensions), textExtension].join('|')})$`);

export const dataUrl = (image: PromptImage) => `data:${image.mediaType};base64,${image.base64}`;
export const isImage = (attachment: PromptAttachment): attachment is PromptImage => attachment.kind === 'image';

// Anything that decodes as text belongs in the prompt. The rest is a binary no agent here can read.
function readable(body: ArrayBuffer) {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(body);
  return !text.includes('\u0000') && !text.includes('\uFFFD');
}

export class Uploads {
  private readonly directory: string;

  constructor(root: string) {
    this.directory = join(root, '.factory/uploads');
  }

  // The id ends in its own extension, so an upload needs no record beyond the file itself.
  path(id: unknown) {
    if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Unknown attachment');
    return join(this.directory, id);
  }

  describe(id: string) {
    const mediaType = imageTypes[id.split('.').pop() ?? ''];
    return mediaType ? { kind: 'image' as const, mediaType } : { kind: 'text' as const, mediaType: textMediaType };
  }

  async save(request: Request): Promise<Attachment> {
    const given = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    const body = await request.arrayBuffer();
    if (!body.byteLength) throw new Error('The file is empty');
    if (body.byteLength > maxBytes) throw new Error(`Attachments are limited to ${maxBytes / 1024 / 1024}MB`);
    const extension = imageExtensions[given as ImageMediaType] ?? (readable(body) ? textExtension : '');
    if (!extension) throw new Error('Attach an image or a text file. This one is neither.');
    const id = `${randomUUID()}.${extension}`;
    await mkdir(this.directory, { recursive: true });
    await Bun.write(join(this.directory, id), body);
    return { id, name: this.name(request), bytes: body.byteLength, ...this.describe(id) };
  }

  async attach(attachments: unknown): Promise<Attachment[]> {
    if (attachments === undefined) return [];
    if (!Array.isArray(attachments)) throw new Error('Attach files as a list');
    if (attachments.length > maxAttachments) throw new Error(`Attach up to ${maxAttachments} files`);
    return Promise.all(attachments.map(async (attachment: { id?: unknown; name?: unknown }) => {
      const id = attachment?.id;
      const file = Bun.file(this.path(id));
      if (!(await file.exists())) throw new Error('That file is no longer available. Attach it again.');
      return { id: id as string, name: String(attachment?.name ?? 'file').slice(0, maxNameLength), bytes: file.size, ...this.describe(id as string) };
    }));
  }

  load(attachments: Attachment[] = []): Promise<PromptAttachment[]> {
    return Promise.all(attachments.map(async (attachment): Promise<PromptAttachment> => {
      const file = Bun.file(this.path(attachment.id));
      const described = this.describe(attachment.id);
      if (described.kind === 'image') return { ...attachment, ...described, base64: Buffer.from(await file.bytes()).toString('base64') };
      const text = await file.text();
      return { ...attachment, ...described, text: text.length > textLimit ? `${text.slice(0, textLimit)}\n[truncated]` : text };
    }));
  }

  private name(request: Request) {
    const header = request.headers.get('x-attachment-name') ?? '';
    const name = decodeURIComponent(header).replace(/[\r\n]/g, '').trim();
    return name.slice(0, maxNameLength) || 'file';
  }
}
