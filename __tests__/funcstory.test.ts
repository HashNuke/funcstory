import { jest } from '@jest/globals';
import path from 'path';
import { main } from '../src/index';

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

describe('FuncStory CLI', () => {
  const fixturePath = path.join(process.cwd(), '__tests__', 'fixtures');
  
  // Mock process.argv
  const originalArgv = process.argv;

  beforeEach(() => {
    // Reset argv to empty
    process.argv = ['node', 'funcstory'];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe('Help functionality', () => {
    it('should show help when --help is passed', () => {
      process.argv = ['node', 'funcstory', '--help'];
      
      const exitCode = main();

      expect(exitCode).toBe(0);
      expect(logOutput.join('\n')).toContain('FuncStory - TypeScript Function Call Reporter');
      expect(logOutput.join('\n')).toContain('Created with love - Akash Manohar John');
    });

    it('should show help when -h is passed', () => {
      process.argv = ['node', 'funcstory', '-h'];
      
      const exitCode = main();

      expect(exitCode).toBe(0);
      expect(logOutput.join('\n')).toContain('FuncStory - TypeScript Function Call Reporter');
    });

    it('should show help when no arguments are provided', () => {
      process.argv = ['node', 'funcstory'];
      
      const exitCode = main();

      expect(exitCode).toBe(0);
      expect(logOutput.join('\n')).toContain('FuncStory - TypeScript Function Call Reporter');
    });

    it('should show prompt when --prompt is passed', () => {
      process.argv = ['node', 'funcstory', '--prompt'];
      
      const exitCode = main();

      expect(exitCode).toBe(0);
      const output = logOutput.join('\n');
      expect(output).toContain('FuncStory JSDoc Writing Instructions');
      expect(output).toContain('Core Principle');
      expect(output).toContain('what the function does directly');
    });

    it('should include skip-file documentation in help', () => {
      process.argv = ['node', 'funcstory', '--help'];
      
      const exitCode = main();

      expect(exitCode).toBe(0);
      const output = logOutput.join('\n');
      expect(output).toContain('SKIPPING FILES:');
      expect(output).toContain('@funcstory-skip-file');
      expect(output).toContain('This entire file will be skipped');
    });
  });

  describe('Error handling', () => {
    it('should error when --entry is missing', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile];
      
      const exitCode = main();

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Error: --entry is required');
    });

    it('should error when --scope is missing', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'callingFunction'];
      
      const exitCode = main();

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Error: --scope is required');
    });

    it('should error when file does not exist', () => {
      process.argv = ['node', 'funcstory', 'nonexistent.ts', '--entry', 'test', '--scope', '.'];
      
      const exitCode = main();

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Error: File not found: nonexistent.ts');
    });

    it('should error when entry point is not found', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'nonexistentFunction', '--scope', fixturePath];
      
      const exitCode = main();

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Error:');
    });
  });

  describe('Function tracing', () => {
    it('should trace simple function calls', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'callingFunction', '--scope', fixturePath];
      
      const exitCode = main();

      const output = logOutput.join('\n');
      expect(output).toContain('callingFunction');
      expect(output).toContain('simpleFunction');
    });

    it('should trace class methods', () => {
      const testFile = path.join(fixturePath, 'class-methods.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'Calculator.complexCalculation', '--scope', fixturePath];
      
      const exitCode = main();

      const output = logOutput.join('\n');
      expect(output).toContain('Calculator.complexCalculation');
      expect(output).toContain('this.add');
      expect(output).toContain('this.getValue');
    });

    it('should skip functions marked with @funcstory-skip', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'functionThatCallsSkipped', '--scope', fixturePath];
      
      const exitCode = main();

      const output = logOutput.join('\n');
      expect(output).toContain('functionThatCallsSkipped');
      expect(output).not.toContain('skippedFunction');
    });

    it('should skip entire files marked with @funcstory-skip-file', () => {
      const testFile = path.join(fixturePath, 'calls-skipped-file.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'callsSkippedFile', '--scope', fixturePath];
      
      const exitCode = main();

      const output = logOutput.join('\n');
      expect(output).toContain('callsSkippedFile');
      // Functions from the skipped file should not appear in the trace
      expect(output).not.toContain('skippedFileFunction');
      expect(output).not.toContain('skippedMethod');
      expect(output).not.toContain('SkippedFileClass');
    });

    it('should detect recursive functions', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'factorial', '--scope', fixturePath];
      
      const exitCode = main();

      const output = logOutput.join('\n');
      expect(output).toContain('factorial');
      expect(output).toContain('RECURSION');
    });

    it('should include JSDoc information by default (story mode)', () => {
      const testFile = path.join(fixturePath, 'class-methods.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'Calculator.complexCalculation', '--scope', fixturePath];
      
      const exitCode = main();

      const output = logOutput.join('\n');
      expect(output).toContain('Performs a complex calculation');
      expect(output).toContain('demonstrates nested method calls');
    });

    it('should not include JSDoc information in oneline mode', () => {
      const testFile = path.join(fixturePath, 'class-methods.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'Calculator.complexCalculation', '--scope', fixturePath, '--oneline'];
      
      const exitCode = main();

      const output = logOutput.join('\n');
      expect(output).not.toContain('Performs a complex calculation');
      expect(output).not.toContain('demonstrates nested method calls');
    });

    it('should respect max depth option', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'factorial', '--scope', fixturePath, '--max-depth', '2'];
      
      const exitCode = main();

      // Should exit without errors
      expect(exitCode).toBe(0);
      const output = logOutput.join('\n');
      expect(output).toContain('factorial');
    });

    it('should respect scope directory option', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'callingFunction', '--scope', fixturePath];
      
      const exitCode = main();

      // Should exit without errors
      expect(exitCode).toBe(0);
      const output = logOutput.join('\n');
      expect(output).toContain('callingFunction');
    });
  });

  describe('Argument parsing', () => {
    it('should handle unknown arguments', () => {
      const testFile = path.join(fixturePath, 'simple-functions.ts');
      process.argv = ['node', 'funcstory', testFile, '--entry', 'test', '--scope', fixturePath, '--unknown'];
      
      const exitCode = main();

      expect(exitCode).toBe(1);
      expect(errorOutput.join('\n')).toContain('Unknown argument: --unknown');
    });
  });
});