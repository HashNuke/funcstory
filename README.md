# FuncStory

Create LLM-friendly reports of function calls in your TypeScript project. FuncStory analyzes function calls starting from an entry point and generates a hierarchical view of your code execution flow.

## Installation

Install globally via npm:

```bash
npm install -g funcstory
```

Or use directly with npx:

```bash
npx funcstory
```

## Usage

Basic syntax:

```bash
funcstory <file-path> --entry <entry-point> --scope <directory> [OPTIONS]
```

### Arguments

- `<file-path>` - Path to the TypeScript file to analyze

### Options

- `--entry <name>` - Entry point function or method to start analysis from (required)
- `--scope <dir>` - Directory to limit analysis scope (required)
- `--max-depth <num>` - Maximum analysis depth (default: 10)
- `--oneline` - Compact output without JSDoc descriptions (story mode is default)
- `--help, -h` - Show help message

### Entry Point Formats

- `functionName` - For standalone functions
- `ClassName.methodName` - For class methods

## Examples

### Analyze a standalone function

```bash
funcstory src/cli.ts --entry main --scope src
```

### Analyze a class method with full descriptions (default)

```bash
funcstory src/html-to-svg/index.ts --entry HtmlToSvgConverter.convert --scope src/html-to-svg
```

### Analyze with compact oneline output

```bash
funcstory src/html-to-svg/index.ts --entry HtmlToSvgConverter.convert --scope src/html-to-svg --oneline
```

### Limit analysis depth

```bash
funcstory src/utils.ts --entry processData --scope src --max-depth 5
```

## What Gets Analyzed

✅ **Included:**
- Functions in same file within scope directory
- Functions in other files within scope directory  
- Class methods in same/other files within scope directory
- Object method calls where class is defined within scope

❌ **Excluded:**
- Standard library functions (console.log, Math.max, etc.)
- Built-in Node.js functions
- Functions/classes outside scope directory

## Skipping Functions

Add a JSDoc comment with `@funcstory-skip` to skip analyzing a function:

```typescript
/**
 * This function will be skipped during analysis
 * @funcstory-skip
 */
function myFunction() {
  // This won't be analyzed
}
```

## Output Format

FuncStory generates a hierarchical tree structure showing function calls:

```
functionName (src/file.ts:42)
1. firstCall (src/utils.ts:15)
  1.1 nestedCall (src/nested.ts:8)
    1.1.1 deeperCall (src/deep.ts:23)
  1.2 anotherCall (src/other.ts:56)
2. externalCall (external:0) ↗️
3. skippedFunction (src/skip.ts:12) ⏭️
4. recursiveCall (src/recursive.ts:34)
  4.1 recursiveCall (src/recursive.ts:34) 🔴 RECURSION
```

### Symbols

- `🔴 RECURSION` - Recursive call detected (direct or indirect recursion)
- `↗️` - External call (outside scope)
- `⏭️` - Skipped due to @funcstory-skip annotation

### Story Mode (Default)

By default, FuncStory includes JSDoc descriptions and remarks. Use `--oneline` for compact output:

```
functionName (src/file.ts:42)
  This function does something important
  
  This function handles special scenarios like...

1. firstCall (src/utils.ts:15)
    First function description here
```

## TypeScript Configuration

FuncStory requires a `tsconfig.json` file in your project root for proper TypeScript parsing. A minimal configuration:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true
  }
}
```

## Requirements

- Node.js 16.0.0 or higher
- TypeScript project with tsconfig.json
- Valid TypeScript files

## Use Cases

- **Code Documentation**: Generate visual documentation of function call flows
- **Code Review**: Understand complex execution paths before reviewing
- **Debugging**: Analyze execution flow to identify problematic call chains
- **LLM Context**: Provide structured function call context to AI tools
- **Refactoring**: Understand dependencies before making changes
- **Onboarding**: Help new team members understand codebase structure

## Development

### Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/HashNuke/funcstory.git
cd funcstory
npm install
```

### Build Commands

```bash
# Build the TypeScript source to JavaScript
npm run build

# Watch mode - rebuild on file changes
npm run dev

# Run tests
npm run test

# Lint the code
npm run lint

# Clean build (TypeScript will rebuild everything)
rm -rf dist && npm run build
```

### Testing Locally

After building, you can test the package locally:

```bash
# Test with built JavaScript
node dist/index.js <file-path> --entry <entry-point> --scope <directory>

# Example
node dist/index.js __tests__/fixtures/simple-functions.ts --entry callingFunction --scope __tests__/fixtures
```

### Project Structure

```
funcstory/
├── src/                    # TypeScript source code
│   └── index.ts           # Main application entry point
├── dist/                  # Compiled JavaScript (generated)
├── __tests__/             # Test files
│   ├── fixtures/          # Test TypeScript files
│   └── funcstory.test.ts  # Main test suite
├── package.json           # Package configuration
├── tsconfig.json          # TypeScript configuration
├── jest.config.js         # Jest test configuration
└── README.md              # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Author

Created with love - Akash Manohar John

## GitHub

https://github.com/HashNuke/funcstory