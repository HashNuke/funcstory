import { jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

// Mock console methods
const originalLog = console.log;
const originalError = console.error;
let logOutput: string[] = [];
let errorOutput: string[] = [];

beforeEach(() => {
  logOutput = [];
  errorOutput = [];
  console.log = jest.fn((msg: string) => logOutput.push(msg));
  console.error = jest.fn((msg: string) => errorOutput.push(msg));
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('FuncStory CLI', () => {
  const fixturePath = path.join(__dirname, 'fixtures');
  
  // Mock process.argv and process.exit
  const originalArgv = process.argv;
  const originalExit = process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    exitCode = undefined;
    process.exit = jest.fn((code?: number) => {
      exitCode = code;
      throw new Error(`Process exit called with code ${code}`);
    }) as never;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  describe('Help functionality', () => {
    it('should show help when --help is passed', async () => {
      process.argv = ['node', 'funcstory', '--help'];
      
      try {
        // Dynamic import to trigger module execution
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      expect(exitCode).toBe(0);
      expect(logOutput.join('\n')).toContain('FuncStory - TypeScript Function Call Reporter');
      expect(logOutput.join('\n')).toContain('Created with love - Akash Manohar John');
    });

    it('should show help when -h is passed', async () => {
      process.argv = ['node', 'funcstory', '-h'];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      expect(exitCode).toBe(0);
      expect(logOutput.join('\n')).toContain('FuncStory - TypeScript Function Call Reporter');
    });

    it('should show help when no arguments are provided', async () => {
      process.argv = ['node', 'funcstory'];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      expect(exitCode).toBe(0);
      expect(logOutput.join('\n')).toContain('FuncStory - TypeScript Function Call Reporter');
    });
  });

  describe('Error handling', () => {
    it('should error when --entry is missing', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Error: --entry is required');
    });

    it('should error when --scope is missing', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'callingFunction'];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Error: --scope is required');
    });

    it('should error when file does not exist', async () => {
      process.argv = ['node', 'funcstory', 'nonexistent.ts', '--entry', 'test', '--scope', '.'];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Error: File not found: nonexistent.ts');
    });

    it('should error when entry point is not found', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'nonexistentFunction', '--scope', fixturePath];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Entry point "nonexistentFunction" not found');
    });
  });

  describe('Function tracing', () => {
    it('should trace simple function calls', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'callingFunction', '--scope', fixturePath];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      const output = logOutput.join('\n');
      expect(output).toContain('callingFunction');
      expect(output).toContain('simpleFunction');
    });

    it('should trace class methods', async () => {
      const testFile = path.join(fixturePath, 'class-methods.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'Calculator.complexCalculation', '--scope', fixturePath];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      const output = logOutput.join('\n');
      expect(output).toContain('Calculator.complexCalculation');
      expect(output).toContain('this.add');
      expect(output).toContain('this.getValue');
    });

    it('should skip functions marked with @funcstory-skip', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'functionThatCallsSkipped', '--scope', fixturePath];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      const output = logOutput.join('\n');
      expect(output).toContain('functionThatCallsSkipped');
      expect(output).not.toContain('skippedFunction');
    });

    it('should detect recursive functions', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'factorial', '--scope', fixturePath];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      const output = logOutput.join('\n');
      expect(output).toContain('factorial');
      expect(output).toContain('RECURSION');
    });

    it('should include JSDoc information by default (story mode)', async () => {
      const testFile = path.join(fixturePath, 'class-methods.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'Calculator.complexCalculation', '--scope', fixturePath];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      const output = logOutput.join('\n');
      expect(output).toContain('Performs a complex calculation');
      expect(output).toContain('demonstrates nested method calls');
    });

    it('should not include JSDoc information in oneline mode', async () => {
      const testFile = path.join(fixturePath, 'class-methods.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'Calculator.complexCalculation', '--scope', fixturePath, '--oneline'];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      const output = logOutput.join('\n');
      expect(output).not.toContain('Performs a complex calculation');
      expect(output).not.toContain('demonstrates nested method calls');
    });

    it('should respect max depth option', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'factorial', '--scope', fixturePath, '--max-depth', '2'];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      // Should exit without errors
      expect(exitCode).toBeUndefined();
      const output = logOutput.join('\n');
      expect(output).toContain('factorial');
    });

    it('should respect scope directory option', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'callingFunction', '--scope', fixturePath];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      // Should exit without errors
      expect(exitCode).toBeUndefined();
      const output = logOutput.join('\n');
      expect(output).toContain('callingFunction');
    });
  });

  describe('Argument parsing', () => {
    it('should handle unknown arguments', async () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'test', '--scope', fixturePath, '--unknown'];
      
      try {
        await import('../src/index.js');
      } catch (error) {
        // Expected due to process.exit mock
      }

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Unknown argument: --unknown');
    });
  });
});