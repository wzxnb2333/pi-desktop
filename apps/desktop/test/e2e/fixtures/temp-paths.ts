import { TemporaryDirectories } from '../../fixtures/temporary-directories.ts';

const directories = new TemporaryDirectories();
export const mkdtemp = (prefix: string) => directories.create(prefix);
// Register after browser/app shutdown hooks. This also runs after failed setup/tests.
export const cleanupTemporaryDirectories = () => directories.cleanup();
