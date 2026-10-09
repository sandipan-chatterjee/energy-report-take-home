import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand } from '../../src/cli/run-command';
import { parseEnv } from '../../src/config/env';
import { AppError } from '../../src/errors/app-error';
import { errorHandler } from '../../src/errors/error-handler';
import { ConfigErrors } from '../../src/errors/modules/config.errors';
import { SystemErrors } from '../../src/errors/modules/system.errors';
import { createLogger } from '../../src/logger/logger';

class ExitCalled extends Error {}

describe('error handling', () => {
  let stderr: jest.SpiedFunction<typeof process.stderr.write>;
  let exit: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exit = jest.spyOn(process, 'exit').mockImplementation((): never => {
      throw new ExitCalled();
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('AppError carries code, module, details and cause from its dictionary entry', () => {
    const cause = new Error('root');
    const err = new AppError({
      module: 'CONFIG',
      definition: ConfigErrors.INVALID_ENV,
      details: { invalid: 'LOG_LEVEL' },
      cause,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('CFG-001');
    expect(err.module).toBe('CONFIG');
    expect(err.message).toBe(ConfigErrors.INVALID_ENV.message);
    expect(err.details).toEqual({ invalid: 'LOG_LEVEL' });
    expect(err.cause).toBe(cause);
  });

  it('handle() prints the AppError code to stderr and exits 1', () => {
    const err = new AppError({ module: 'CONFIG', definition: ConfigErrors.INVALID_ENV });
    expect(() => errorHandler.handle(err)).toThrow(ExitCalled);
    expect(stderr).toHaveBeenCalledWith(`\n✖ [CFG-001] ${ConfigErrors.INVALID_ENV.message}\n`);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('handle() wraps a plain Error as SYS-000 without leaking its raw message', () => {
    expect(() => errorHandler.handle(new Error('ENOENT /secret/path'))).toThrow(ExitCalled);
    const printed = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(printed).toContain('[SYS-000]');
    expect(printed).not.toContain('/secret/path');
  });

  it('runCommand() funnels a thrown AppError to the handler', () => {
    expect(() => {
      runCommand('test', () => {
        throw new AppError({ module: 'SYSTEM', definition: SystemErrors.UNEXPECTED });
      });
    }).toThrow(ExitCalled);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('runCommand() maps a non-Error throw to SYS-001', () => {
    expect(() => {
      runCommand('test', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error path
        throw 'boom';
      });
    }).toThrow(ExitCalled);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('[SYS-001]'));
  });

  it('runCommand() does not exit on success', () => {
    let ran = false;
    runCommand('test', () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv({})).toEqual({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
  });

  it('rejects an invalid LOG_LEVEL with CFG-001 naming the field', () => {
    expect.assertions(2);
    try {
      parseEnv({ LOG_LEVEL: 'loud' });
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect(e).toMatchObject({ code: 'CFG-001', details: { invalid: 'LOG_LEVEL' } });
    }
  });
});

describe('createLogger', () => {
  it('writes JSON lines at or above the minimum level only', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'energy-log-')), 'app.log');
    const logger = createLogger(file, () => 'info');
    logger.debug({ step: 'skipped' });
    logger.info({ command: 'report', durationMs: 5 }, 'done');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'info',
      command: 'report',
      durationMs: 5,
      msg: 'done',
    });
  });
});
