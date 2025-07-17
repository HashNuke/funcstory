/**
 * This entire file should be skipped during analysis
 * @funcstory-skip-file
 */

export function skippedFileFunction() {
  return 'this should not appear in analysis';
}

export class SkippedFileClass {
  skippedMethod() {
    return 'this method should also be skipped';
  }
}