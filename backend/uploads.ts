import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageMediaType, PromptImage, TaskImage } from '../shared/types';

const extensions: Record<ImageMediaType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const mediaTypes = Object.fromEntries(Object.entries(extensions).map(([type, extension]) => [extension, type])) as Record<string, ImageMediaType>;
const maxBytes = 10 * 1024 * 1024;
const maxImages = 8;
const maxNameLength = 120;
const idPattern = new RegExp(`^[0-9a-f-]{36}\\.(${Object.values(extensions).join('|')})$`);

export const dataUrl = (image: PromptImage) => `data:${image.mediaType};base64,${image.base64}`;

export class Uploads {
  private readonly directory: string;

  constructor(root: string) {
    this.directory = join(root, '.factory/uploads');
  }

  // The id ends in its own extension, so an image needs no record beyond the file itself.
  path(id: unknown) {
    if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('Unknown image');
    return join(this.directory, id);
  }

  mediaType(id: string): ImageMediaType {
    const mediaType = mediaTypes[id.split('.').pop() ?? ''];
    if (!mediaType) throw new Error('Unknown image');
    return mediaType;
  }

  async save(request: Request): Promise<TaskImage> {
    const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    const extension = extensions[mediaType as ImageMediaType];
    if (!extension) throw new Error('Attach a PNG, JPEG, WebP, or GIF image');
    const body = await request.arrayBuffer();
    if (!body.byteLength) throw new Error('The image is empty');
    if (body.byteLength > maxBytes) throw new Error(`Images are limited to ${maxBytes / 1024 / 1024}MB`);
    const id = `${randomUUID()}.${extension}`;
    await mkdir(this.directory, { recursive: true });
    await Bun.write(join(this.directory, id), body);
    return { id, name: this.name(request), mediaType: mediaTypes[extension], bytes: body.byteLength };
  }

  async attach(images: unknown): Promise<TaskImage[]> {
    if (images === undefined) return [];
    if (!Array.isArray(images)) throw new Error('Attach images as a list');
    if (images.length > maxImages) throw new Error(`Attach up to ${maxImages} images`);
    return Promise.all(images.map(async (image: { id?: unknown; name?: unknown }) => {
      const id = image?.id;
      const file = Bun.file(this.path(id));
      if (!(await file.exists())) throw new Error('That image is no longer available. Attach it again.');
      return { id: id as string, name: String(image?.name ?? 'image').slice(0, maxNameLength), mediaType: this.mediaType(id as string), bytes: file.size };
    }));
  }

  load(images: TaskImage[] = []): Promise<PromptImage[]> {
    return Promise.all(images.map(async image => ({ ...image, base64: Buffer.from(await Bun.file(this.path(image.id)).bytes()).toString('base64') })));
  }

  private name(request: Request) {
    const header = request.headers.get('x-image-name') ?? '';
    const name = decodeURIComponent(header).replace(/[\r\n]/g, '').trim();
    return name.slice(0, maxNameLength) || 'image';
  }
}
