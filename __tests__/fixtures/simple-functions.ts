// Test fixture for simple function tracing

export function simpleFunction() {
  return 'simple';
}

export function callingFunction() {
  return simpleFunction();
}

/**
 * This function adds two numbers
 * @param a First number
 * @param b Second number
 * @returns Sum of a and b
 */
export function addNumbers(a: number, b: number): number {
  return a + b;
}

/**
 * This function should be skipped
 * @funcstory-skip
 */
export function skippedFunction() {
  return 'skipped';
}

export function functionThatCallsSkipped() {
  return skippedFunction();
}

// Recursive function for testing
export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}