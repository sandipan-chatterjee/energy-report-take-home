import { paths } from '../config/constants';
import { createLogger } from './logger';

export const errorLogger = createLogger(paths.errorLogFile);
