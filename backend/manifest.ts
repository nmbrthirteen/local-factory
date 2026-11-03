import { join } from 'node:path';
import { z } from 'zod';

const manifestSchema = z.object({ scripts: z.record(z.string(), z.string()).optional().catch(undefined) }).catch({});

export async function readScripts(path: string) {
  const manifest = manifestSchema.parse(
    await Bun.file(join(path, 'package.json'))
      .json()
      .catch(() => null),
  );

  return manifest.scripts ?? {};
}
