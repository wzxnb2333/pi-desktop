import { after } from 'node:test';
import { TemporaryDirectories } from './temporary-directories.ts';

const directories = new TemporaryDirectories();
export const mkdtemp = (prefix: string) => directories.create(prefix);
after(() => directories.cleanup());
