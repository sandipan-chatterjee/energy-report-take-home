import { mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveInputPath } from '../../src/cli/input-path';
import { MAX_INPUT_BYTES, paths } from '../../src/config/constants';
import { AppError } from '../../src/errors/app-error';
import { readInput, withInputFsErrors } from '../../src/telemetry/read-input';

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'energy-report-unit-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function codeOf(action: () => void): string | undefined {
  try {
    action();
  } catch (e) {
    return e instanceof AppError ? e.code : 'not-app-error';
  }
  return undefined;
}

describe('readInput', () => {
  it('reads a regular file as text', () => {
    const file = path.join(dir, 'ok.jsonl');
    writeFileSync(file, 'hello\n');
    expect(readInput(file)).toBe('hello\n');
  });

  it('throws TEL-001 when the file system reports ENOENT', () => {
    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' });
    expect(
      codeOf(() =>
        withInputFsErrors(() => {
          throw missing;
        }),
      ),
    ).toBe('TEL-001');
  });

  it('throws TEL-002 when the file system reports another error', () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    expect(
      codeOf(() =>
        withInputFsErrors(() => {
          throw denied;
        }),
      ),
    ).toBe('TEL-002');
  });

  it('throws TEL-002 for a directory', () => {
    expect(codeOf(() => readInput(dir))).toBe('TEL-002');
  });

  it('throws TEL-003 for a file over the size limit', () => {
    const file = path.join(dir, 'big.jsonl');
    writeFileSync(file, '');
    truncateSync(file, MAX_INPUT_BYTES + 1);
    expect(codeOf(() => readInput(file))).toBe('TEL-003');
  });

  it('accepts a file exactly at the size limit', () => {
    const file = path.join(dir, 'limit.jsonl');
    writeFileSync(file, '');
    truncateSync(file, MAX_INPUT_BYTES);
    expect(codeOf(() => readInput(file))).toBeUndefined();
  });
});

describe('resolveInputPath', () => {
  it('resolves an absolute path outside the repo', () => {
    const file = path.join(dir, 'abs.jsonl');
    writeFileSync(file, 'x');
    expect(resolveInputPath(file, paths.projectRoot)).toBe(path.join(dir, 'abs.jsonl'));
  });

  it('resolves a relative path against the given cwd first', () => {
    writeFileSync(path.join(dir, 'rel.jsonl'), 'x');
    expect(resolveInputPath('rel.jsonl', dir)).toBe(path.join(dir, 'rel.jsonl'));
  });

  it('falls back to input/ when the cwd path does not exist', () => {
    expect(resolveInputPath('telemetry.jsonl', dir)).toBe(
      path.join(paths.inputDir, 'telemetry.jsonl'),
    );
  });

  it('resolves a ../ path that leaves the cwd', () => {
    writeFileSync(path.join(dir, 'up.jsonl'), 'x');
    const sub = mkdtempSync(path.join(dir, 'sub-'));
    expect(resolveInputPath(path.join('..', 'up.jsonl'), sub)).toBe(path.join(dir, 'up.jsonl'));
  });

  it('follows a symlink to its real path', () => {
    const target = path.join(dir, 'target.jsonl');
    writeFileSync(target, 'x');
    const link = path.join(dir, 'link.jsonl');
    symlinkSync(target, link);
    expect(resolveInputPath(link, dir)).toBe(target);
  });
});
