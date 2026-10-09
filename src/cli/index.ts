import { parseArgs } from 'node:util';
import { OUTPUT_JSON_INDENT } from '../config/constants';
import { AppError } from '../errors/app-error';
import { CliErrors } from '../errors/modules/cli.errors';
import { appLogger } from '../logger/logger';
import { buildReport } from '../report/build-report';
import { formatReport } from '../report/format';
import { parseTelemetry } from '../telemetry/parse';
import { readInput } from '../telemetry/read-input';
import { resolveReadings } from '../telemetry/readings';
import type { CliArgs } from '../types/cli';
import { resolveInputPath } from './input-path';
import { runCommand } from './run-command';

function parseCliArgs(): CliArgs {
  let positionals: string[];
  try {
    ({ positionals } = parseArgs({ options: {}, strict: true, allowPositionals: true }));
  } catch (e) {
    throw new AppError({
      module: 'CLI',
      definition: CliErrors.INVALID_ARGUMENTS,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }
  const [inputPath, ...extra] = positionals;
  if (inputPath === undefined) {
    throw new AppError({ module: 'CLI', definition: CliErrors.MISSING_INPUT_PATH });
  }
  if (extra.length > 0) {
    throw new AppError({
      module: 'CLI',
      definition: CliErrors.INVALID_ARGUMENTS,
      details: { extraArguments: extra.length },
    });
  }
  return { inputPath };
}

runCommand('report', () => {
  const { inputPath } = parseCliArgs();
  const parsed = parseTelemetry(readInput(resolveInputPath(inputPath)));
  const resolved = resolveReadings(parsed.records);
  const report = formatReport(
    buildReport(resolved.readings),
    [...parsed.findings, ...resolved.findings],
    parsed.duplicatesDropped,
  );
  appLogger.info(
    {
      acceptedRecords: parsed.records.length,
      readings: resolved.readings.length,
      duplicatesDropped: report.duplicates_dropped,
      events: report.events.length,
      invalidPowerReadings: report.invalid_power_readings,
    },
    'report built',
  );
  process.stdout.write(`${JSON.stringify(report, null, OUTPUT_JSON_INDENT)}\n`);
});
