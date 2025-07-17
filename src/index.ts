#!/usr/bin/env node

import { Project, Node as TSNode, SyntaxKind, CallExpression } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

interface TraceOptions {
  filePath: string;
  entryPoint: string;
  scopeDirectory: string;
  maxDepth?: number;
  oneline?: boolean;
}

interface CallTrace {
  name: string;
  isRecursive: boolean;
  isExternal: boolean;
  children: CallTrace[];
  functionPath?: string; // For tracking recursive call chains
  fileName?: string; // File path where function is defined
  lineNumber?: number; // Line number where function is defined
  isSkipped?: boolean; // Whether function was skipped due to @funcstory-skip
  jsDocDescription?: string; // Function description from JSDoc
  jsDocRemarks?: string; // Remarks from JSDoc
}

class FunctionTracer {
  private project: any;
  private scopeDirectory: string;
  private recursionStack: Set<string> = new Set(); // Track functions in current call stack for recursion detection
  private maxDepth: number;
  private includeStory: boolean;
  
  constructor(options: TraceOptions) {
    this.project = new Project({
      tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
    });
    
    this.scopeDirectory = path.resolve(options.scopeDirectory);
    this.maxDepth = options.maxDepth || 10;
    this.includeStory = !options.oneline; // Story is default, oneline disables it
  }

  trace(filePath: string, entryPoint: string): CallTrace | null {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const entryFunction = this.findEntryPoint(sourceFile, entryPoint);
    
    if (!entryFunction) {
      throw new Error(`Entry point "${entryPoint}" not found in ${filePath}`);
    }

    return this.traceFunction(entryFunction, entryPoint, 0, []);
  }

  private findEntryPoint(sourceFile: any, entryPoint: string): any | null {
    // Handle class.method format
    if (entryPoint.includes('.')) {
      const [className, methodName] = entryPoint.split('.');
      const classDeclaration = sourceFile.getClass(className);
      if (classDeclaration) {
        return classDeclaration.getMethod(methodName);
      }
      return null;
    }

    // Handle function format
    return sourceFile.getFunction(entryPoint) || 
           sourceFile.getVariableDeclaration(entryPoint) ||
           sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)
             .find((method: any) => method.getName() === entryPoint);
  }

  /**
   * Check if a file has @funcstory-skip-file JSDoc comment at the top
   */
  private shouldSkipFile(sourceFile: any): boolean {
    try {
      // Get leading comments at the top of the file
      const leadingComments = sourceFile.getLeadingCommentRanges();
      
      for (const comment of leadingComments) {
        const commentText = comment.getText();
        if (commentText && commentText.includes('@funcstory-skip-file')) {
          return true;
        }
      }
      
      // Also check JSDoc comments on the first statement if any
      const statements = sourceFile.getStatements();
      if (statements.length > 0) {
        const firstStatement = statements[0];
        const jsDocComments = firstStatement.getJsDocs?.();
        
        if (jsDocComments) {
          for (const jsDoc of jsDocComments) {
            const fullComment = jsDoc.getFullText();
            if (fullComment && fullComment.includes('@funcstory-skip-file')) {
              return true;
            }
          }
        }
      }
    } catch (error) {
      // Ignore JSDoc parsing errors
    }
    return false;
  }

  /**
   * Check if a function has @funcstory-skip JSDoc comment
   */
  private shouldSkipFunction(node: any): boolean {
    try {
      const jsDocComments = node.getJsDocs();
      
      for (const jsDoc of jsDocComments) {
        // Check JSDoc tags
        const tags = jsDoc.getTags();
        for (const tag of tags) {
          if (tag.getTagName() === 'funcstory-skip') {
            return true;
          }
        }
        
        // Also check the full comment text in case it's written as @funcstory-skip in the description
        const fullComment = jsDoc.getFullText();
        if (fullComment && fullComment.includes('@funcstory-skip')) {
          return true;
        }
      }
    } catch (error) {
      // Ignore JSDoc parsing errors
    }
    return false;
  }

  /**
   * Get function location information
   */
  private getFunctionLocation(node: any): { fileName: string; lineNumber: number } {
    const sourceFile = node.getSourceFile();
    const fileName = sourceFile.getFilePath();
    const lineNumber = node.getStartLineNumber();
    return { fileName, lineNumber };
  }

  /**
   * Extract JSDoc description and remarks from a function node
   */
  private getJSDocInfo(node: any): { description?: string; remarks?: string } {
    if (!this.includeStory) {
      return {};
    }

    try {
      const jsDocComments = node.getJsDocs();
      let description = '';
      let remarks = '';
      
      for (const jsDoc of jsDocComments) {
        // Get the description (the main comment before any @tags)
        const commentText = jsDoc.getDescription();
        if (commentText) {
          description += commentText.trim();
        }

        // Look for @remarks tags
        const tags = jsDoc.getTags();
        for (const tag of tags) {
          if (tag.getTagName() === 'remarks') {
            const remarkText = tag.getComment();
            if (remarkText) {
              if (remarks) remarks += '\n\n';
              remarks += remarkText.trim();
            }
          }
        }
      }
      
      return {
        description: description || undefined,
        remarks: remarks || undefined
      };
    } catch (error) {
      // Ignore JSDoc parsing errors
      return {};
    }
  }

  private traceFunction(node: any, functionName: string, depth: number, currentPath: string[] = []): CallTrace {
    const newPath = [...currentPath, functionName];
    const pathString = newPath.join(' → ');
    
    // Get function location info
    const location = this.getFunctionLocation(node);
    
    // Get JSDoc info if story mode is enabled
    const jsDocInfo = this.getJSDocInfo(node);
    
    // Check for skip annotation
    const isSkipped = this.shouldSkipFunction(node);
    
    // Detect recursion (direct or indirect) - function is already in current call stack
    const isRecursive = this.recursionStack.has(functionName);
    
    const trace: CallTrace = {
      name: functionName,
      isRecursive,
      isExternal: false,
      children: [],
      functionPath: pathString,
      fileName: location.fileName,
      lineNumber: location.lineNumber,
      isSkipped,
      jsDocDescription: jsDocInfo.description,
      jsDocRemarks: jsDocInfo.remarks
    };

    // Stop if skipped, recursive, or max depth reached
    if (isSkipped || isRecursive || depth >= this.maxDepth) {
      return trace;
    }

    // Add to recursion stack to detect direct/indirect recursion
    this.recursionStack.add(functionName);

    // Find all call expressions in the function body
    const callExpressions = this.getCallExpressions(node);
    
    for (const callExpr of callExpressions) {
      const callInfo = this.resolveCall(callExpr);
      if (callInfo && this.isWithinScope(callExpr, callInfo.name)) {
        const childTrace = this.traceCall(callInfo, depth + 1, newPath);
        if (childTrace) {
          trace.children.push(childTrace);
        }
      }
    }

    // Remove from recursion stack when exiting function
    this.recursionStack.delete(functionName);
    return trace;
  }

  private getCallExpressions(node: any): any[] {
    const calls: any[] = [];
    
    node.forEachDescendant((descendant: any) => {
      if (TSNode.isCallExpression(descendant)) {
        calls.push(descendant);
      }
    });
    
    return calls;
  }

  private resolveCall(callExpr: any): { name: string; target?: any; isExternal: boolean } | null {
    const expression = callExpr.getExpression();
    
    if (TSNode.isIdentifier(expression)) {
      // Simple function call: functionName()
      const name = expression.getText();
      const target = this.findFunctionDefinition(callExpr.getSourceFile(), name);
      return {
        name,
        target,
        isExternal: !target || !this.isInScope(target)
      };
    }
    
    if (TSNode.isPropertyAccessExpression(expression)) {
      // Method call: obj.method() or Class.method() or this.method()
      const propertyName = expression.getName();
      const objectExpression = expression.getExpression();
      const objectName = objectExpression.getText();
      const name = `${objectName}.${propertyName}`;
      
      let target = null;
      
      // Handle this.method calls - look for method in current class
      if (objectName === 'this') {
        target = this.findMethodInCurrentClass(callExpr, propertyName);
      } else {
        target = this.findMethodDefinition(callExpr.getSourceFile(), objectName, propertyName);
      }
      
      return {
        name,
        target,
        isExternal: !target || !this.isInScope(target)
      };
    }

    return null;
  }

  private findFunctionDefinition(sourceFile: any, functionName: string): any | null {
    // Check if the source file should be skipped
    if (this.shouldSkipFile(sourceFile)) {
      return null;
    }

    // Look for function declaration
    const funcDecl = sourceFile.getFunction(functionName);
    if (funcDecl) return funcDecl;

    // Look for variable declaration with function expression
    const varDecl = sourceFile.getVariableDeclaration(functionName);
    if (varDecl) {
      const initializer = varDecl.getInitializer();
      if (initializer && (TSNode.isArrowFunction(initializer) || TSNode.isFunctionExpression(initializer))) {
        return initializer;
      }
    }

    // Look in imports
    const importDecls = sourceFile.getImportDeclarations();
    for (const importDecl of importDecls) {
      const namedImports = importDecl.getNamedImports();
      const defaultImport = importDecl.getDefaultImport();
      
      if (defaultImport?.getText() === functionName || 
          namedImports.some((named: any) => named.getName() === functionName)) {
        const moduleFile = importDecl.getModuleSpecifierSourceFile();
        if (moduleFile) {
          return this.findFunctionDefinition(moduleFile, functionName);
        }
      }
    }

    return null;
  }

  private findMethodInCurrentClass(callExpr: any, methodName: string): any | null {
    // Walk up the AST to find the containing class
    let current = callExpr.getParent();
    while (current) {
      if (TSNode.isClassDeclaration(current)) {
        return current.getMethod(methodName);
      }
      current = current.getParent();
    }
    return null;
  }

  private findMethodDefinition(sourceFile: any, className: string, methodName: string): any | null {
    // Check if the source file should be skipped
    if (this.shouldSkipFile(sourceFile)) {
      return null;
    }

    const classDecl = sourceFile.getClass(className);
    if (classDecl) {
      return classDecl.getMethod(methodName);
    }

    // Look in imports
    const importDecls = sourceFile.getImportDeclarations();
    for (const importDecl of importDecls) {
      const namedImports = importDecl.getNamedImports();
      const defaultImport = importDecl.getDefaultImport();
      
      if (defaultImport?.getText() === className || 
          namedImports.some((named: any) => named.getName() === className)) {
        const moduleFile = importDecl.getModuleSpecifierSourceFile();
        if (moduleFile) {
          return this.findMethodDefinition(moduleFile, className, methodName);
        }
      }
    }

    return null;
  }

  private isInScope(node: any): boolean {
    const sourceFile = node.getSourceFile();
    const filePath = sourceFile.getFilePath();
    return filePath.startsWith(this.scopeDirectory);
  }

  private isWithinScope(callExpr: any, functionName: string): boolean {
    const sourceFile = callExpr.getSourceFile();
    
    // Handle this.method calls - check if current class is in scope
    if (functionName.startsWith('this.')) {
      return this.isInScope(callExpr); // Use existing scope check
    }
    
    // Handle simple function calls
    if (!functionName.includes('.')) {
      // Check if it's a function declared in this file (and file is in scope)
      const funcDecl = sourceFile.getFunction(functionName);
      if (funcDecl && this.isInScope(funcDecl)) return true;
      
      // Check if it's a variable/const function in this file (and file is in scope)  
      const varDecl = sourceFile.getVariableDeclaration(functionName);
      if (varDecl && this.isInScope(varDecl)) return true;
      
      // Check if it's imported from a file within scope
      const target = this.findFunctionDefinition(sourceFile, functionName);
      if (target && this.isInScope(target)) return true;
      
      return false;
    }
    
    // Handle object.method calls
    const parts = functionName.split('.');
    const objectName = parts[0];
    const methodName = parts[parts.length - 1];
    
    // Check if the object is a class declared in this file (and file is in scope)
    const classDecl = sourceFile.getClass(objectName);
    if (classDecl && this.isInScope(classDecl)) {
      const method = classDecl.getMethod(methodName);
      return method && this.isInScope(method);
    }
    
    // Check if the object is imported and the target class is in scope
    const target = this.findMethodDefinition(sourceFile, objectName, methodName);
    if (target && this.isInScope(target)) return true;
    
    // Check if it's a variable/const object in this file with known type in scope
    const varDecl = sourceFile.getVariableDeclaration(objectName);
    if (varDecl && this.isInScope(varDecl)) {
      // Try to resolve the object's type to find the method
      const objectType = this.resolveObjectType(varDecl, methodName);
      if (objectType && this.isInScope(objectType)) return true;
    }
    
    return false;
  }

  private resolveObjectType(varDecl: any, methodName: string): any | null {
    // Try to get the type of the variable and find the method in that type
    try {
      const type = varDecl.getType();
      const symbol = type.getSymbol();
      if (symbol) {
        // Get the declarations of the symbol (class/interface definitions)
        const declarations = symbol.getDeclarations();
        for (const decl of declarations) {
          if (TSNode.isClassDeclaration(decl)) {
            const method = decl.getMethod(methodName);
            if (method) return method;
          }
        }
      }
    } catch (error) {
      // Type resolution failed, ignore
    }
    return null;
  }

  private traceCall(callInfo: { name: string; target?: any; isExternal: boolean }, depth: number, currentPath: string[] = []): CallTrace | null {
    if (callInfo.isExternal || !callInfo.target) {
      // Try to get location info even for external calls
      let fileName = 'external';
      let lineNumber = 0;
      if (callInfo.target) {
        try {
          const location = this.getFunctionLocation(callInfo.target);
          fileName = location.fileName;
          lineNumber = location.lineNumber;
        } catch (error) {
          // Ignore location errors for external calls
        }
      }

      return {
        name: callInfo.name,
        isRecursive: false,
        isExternal: true,
        children: [],
        functionPath: [...currentPath, callInfo.name].join(' → '),
        fileName,
        lineNumber
      };
    }

    // Check if the target function should be skipped - return null to exclude from trace
    if (this.shouldSkipFunction(callInfo.target)) {
      return null;
    }

    return this.traceFunction(callInfo.target, callInfo.name, depth, currentPath);
  }
}

class TraceFormatter {
  private recursiveFunctions: Set<string> = new Set();
  private includeStory: boolean;

  constructor(includeStory: boolean = false) {
    this.includeStory = includeStory;
  }

  format(trace: CallTrace): string {
    // First pass: identify all recursive functions
    this.identifyRecursiveFunctions(trace);
    
    return this.formatTrace(trace, '');
  }

  private identifyRecursiveFunctions(trace: CallTrace): void {
    if (trace.isRecursive) {
      this.recursiveFunctions.add(trace.name);
    }
    
    trace.children.forEach(child => {
      this.identifyRecursiveFunctions(child);
    });
  }

  private formatTrace(trace: CallTrace, prefix: string): string {
    let result = '';
    
    if (prefix) {
      result += prefix + ' ';
    }
    
    const isPartOfRecursiveChain = this.recursiveFunctions.has(trace.name);
    
    // Color coding: red for recursive functions, bold for function name
    if (isPartOfRecursiveChain) {
      result += '\x1b[31m\x1b[1m'; // Red and bold for recursive functions
    } else {
      result += '\x1b[1m'; // Bold for function name
    }
    
    result += trace.name;
    result += '\x1b[0m'; // Reset formatting
    
    // Add file location in VSCode-clickable format
    if (trace.fileName && trace.lineNumber) {
      const fileName = trace.fileName === 'external' ? 'external' : path.relative(process.cwd(), trace.fileName);
      result += ` \x1b[90m(${fileName}:${trace.lineNumber})\x1b[0m`; // Gray color for location
    }
    
    // Add symbols in priority order
    if (trace.isSkipped) {
      result += ' ⏭️';
    } else if (trace.isRecursive) {
      result += ' \x1b[41m\x1b[97m RECURSION \x1b[0m'; // Red background, bright white text
    } else if (trace.isExternal) {
      result += ' ↗️';
    }
    
    result += '\n';

    // Add JSDoc description and remarks if available (in story mode)
    if (trace.jsDocDescription || trace.jsDocRemarks) {
      result += '\x1b[90m'; // Gray color for story details
      
      if (trace.jsDocDescription) {
        result += trace.jsDocDescription + '\n';
      }
      
      if (trace.jsDocRemarks) {
        if (trace.jsDocDescription) {
          result += '\n'; // Add line break between description and remarks
        }
        result += trace.jsDocRemarks + '\n';
      }
      
      result += '\x1b[0m'; // Reset color
      result += '\n'; // Add line break after JSDoc content
    }
    
    // Always add blank line after function in story mode for visual separation
    if (this.includeStory) {
      result += '\n';
    }

    // Add children
    const totalChildren = trace.children.length;
    trace.children.forEach((child, index) => {
      const childPrefix = this.getChildPrefix(prefix, index + 1, totalChildren);
      result += this.formatTrace(child, childPrefix);
    });

    return result;
  }

  private getChildPrefix(parentPrefix: string, childIndex: number, totalSiblings: number): string {
    // Calculate padding based on total siblings
    const padding = totalSiblings.toString().length;
    const paddedIndex = childIndex.toString().padStart(padding, '0');
    
    if (!parentPrefix) {
      return `${paddedIndex}.`;
    }
    // Remove trailing dot from parent prefix if present, then add dot separator
    const cleanPrefix = parentPrefix.endsWith('.') ? parentPrefix.slice(0, -1) : parentPrefix;
    return `${cleanPrefix}.${paddedIndex}`;
  }

}

function showPrompt() {
  const promptFilePath = path.join(process.cwd(), 'PROMPT.md');
  
  try {
    if (fs.existsSync(promptFilePath)) {
      const promptContent = fs.readFileSync(promptFilePath, 'utf-8');
      console.log(promptContent);
    } else {
      console.log('PROMPT.md file not found in the current directory.');
      console.log('');
      console.log('When using FuncStory with LLMs, follow these JSDoc guidelines:');
      console.log('');
      console.log('The function description and remarks must be about what the function does directly - not what its descendant callees do.');
      console.log('The activities performed by the descendants of the current function are documented on those functions.');
      console.log('Only document direct activities a function performs.');
    }
  } catch (error) {
    console.error('Error reading PROMPT.md:', error);
    process.exit(1);
  }
}

function showHelp() {
  console.log('FuncStory - Create LLM-friendly reports of function calls in TypeScript projects');
  console.log('');
  console.log('USAGE:');
  console.log('  funcstory <file-path> --entry <entry-point> --scope <directory> [OPTIONS]');
  console.log('  funcstory --prompt');
  console.log('');
  console.log('ARGUMENTS:');
  console.log('  <file-path>         Path to TypeScript file to analyze');
  console.log('');
  console.log('OPTIONS:');
  console.log('  --entry <name>      Starting function/method for analysis (required)');
  console.log('                      Note: This can be any function you want to analyze');
  console.log('  --scope <dir>       Directory to limit analysis scope (required)');
  console.log('  --max-depth <num>   Maximum analysis depth (default: 10)');
  console.log('  --oneline           Compact output without JSDoc descriptions');
  console.log('  --prompt            Show JSDoc writing instructions for LLMs');
  console.log('  --help, -h          Show this help message');
  console.log('');
  console.log('ENTRY POINT FORMATS:');
  console.log('  functionName         - For standalone functions');
  console.log('  ClassName.methodName - For class methods');
  console.log('');
  console.log('EXAMPLES:');
  console.log('  # Basic analysis');
  console.log('  funcstory src/cli.ts --entry main --scope src');
  console.log('');
  console.log('  # Save detailed report to file (recommended for long outputs)');
  console.log('  funcstory src/api/index.ts --entry processData --scope src \\');
  console.log('    > function-calls-report.md');
  console.log('');
  console.log('  # Compact output');
  console.log('  funcstory src/utils.ts --entry helper --scope src --oneline');
  console.log('');
  console.log('  # Limit depth');
  console.log('  funcstory src/complex.ts --entry main --scope src --max-depth 5');
  console.log('');
  console.log('WHAT GETS ANALYZED:');
  console.log('  ✓ Functions/methods within scope directory');
  console.log('  ✓ Cross-file calls within scope');
  console.log('  ✗ Standard library calls (console.log, Math.max, etc.)');
  console.log('  ✗ Functions outside scope directory');
  console.log('');
  console.log('JSDOC COMMENTS:');
  console.log('  Default story mode shows JSDoc descriptions and @remarks.');
  console.log('  Use "funcstory --prompt" for detailed JSDoc writing guidelines.');
  console.log('');
  console.log('SKIPPING:');
  console.log('  Functions: Add @funcstory-skip to JSDoc');
  console.log('  Files: Add @funcstory-skip-file at top of file');
  console.log('');
  console.log('OUTPUT SYMBOLS:');
  console.log('  \x1b[41m\x1b[97m RECURSION \x1b[0m - Recursive call detected');
  console.log('  ↗️ - External call (outside scope)');
  console.log('  ⏭️ - Skipped due to @funcstory-skip');
  console.log('');
  console.log('REQUIREMENTS:');
  console.log('  Node.js 16.0.0+, TypeScript project with tsconfig.json');
  console.log('');
  console.log('Created with love - Akash Manohar John');
}

// CLI Interface
function parseArgs(): { options?: TraceOptions; exitCode: number } {
  const args = process.argv.slice(2);
  
  // Check for prompt flag
  if (args.includes('--prompt')) {
    showPrompt();
    return { exitCode: 0 };
  }
  
  // Check for help flag or no arguments
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return { exitCode: 0 };
  }
  
  if (args.length < 1) {
    showHelp();
    return { exitCode: 1 };
  }

  const options: TraceOptions = {
    filePath: args[0],
    entryPoint: '',
    scopeDirectory: '' // Will be validated later
  };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--entry':
        options.entryPoint = args[++i];
        break;
      case '--scope':
        options.scopeDirectory = args[++i];
        break;
      case '--max-depth':
        options.maxDepth = parseInt(args[++i], 10);
        break;
      case '--oneline':
        options.oneline = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        console.error('');
        showHelp();
        return { exitCode: 1 };
    }
  }

  if (!options.entryPoint) {
    console.error('Error: --entry is required');
    console.error('');
    showHelp();
    return { exitCode: 1 };
  }

  if (!options.scopeDirectory) {
    console.error('Error: --scope is required');
    console.error('');
    showHelp();
    return { exitCode: 1 };
  }

  if (!fs.existsSync(options.filePath)) {
    console.error(`Error: File not found: ${options.filePath}`);
    return { exitCode: 1 };
  }

  return { options, exitCode: 0 };
}

export function main(): number {
  try {
    const result = parseArgs();
    
    // If parseArgs returned an exit code (help, prompt, or error), return it
    if (!result.options) {
      return result.exitCode;
    }
    
    const options = result.options;
    const tracer = new FunctionTracer(options);
    const trace = tracer.trace(options.filePath, options.entryPoint);
    
    if (trace) {
      const formatter = new TraceFormatter(!options.oneline); // Story mode unless oneline is specified
      console.log(formatter.format(trace));
    }
    
    return 0;
  } catch (error: any) {
    console.error('Error:', error.message);
    return 1;
  }
}

// No auto-execution - keep module pure for imports and testing