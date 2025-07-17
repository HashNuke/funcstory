import { skippedFileFunction, SkippedFileClass } from './skipped-file';

/**
 * Function that calls functions from a skipped file
 */
export function callsSkippedFile() {
  const result = skippedFileFunction(); // This should show as external
  const instance = new SkippedFileClass();
  const methodResult = instance.skippedMethod(); // This should also show as external
  return { result, methodResult };
}