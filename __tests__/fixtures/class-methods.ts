// Test fixture for class method tracing

export class Calculator {
  private value: number = 0;

  /**
   * Adds a number to the current value
   * @param num Number to add
   */
  add(num: number): void {
    this.value += num;
  }

  /**
   * Gets the current value
   */
  getValue(): number {
    return this.value;
  }

  /**
   * Performs a complex calculation
   * @remarks This method demonstrates nested method calls
   */
  complexCalculation(x: number, y: number): number {
    this.add(x);
    this.add(y);
    return this.getValue();
  }
}