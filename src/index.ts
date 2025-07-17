#!/usr/bin/env node

import { Project, Node as TSNode, SyntaxKind, CallExpression } from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

interface TraceOptions {
  filePath: string;
  entryPoint: string;
  scopeDirectory?: string;
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
    
    this.scopeDirectory = options.scopeDirectory ? path.resolve(options.scopeDirectory) : path.dirname(path.resolve(options.filePath));
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

function showHelp() {
  console.log('FuncStory - TypeScript Function Call Reporter');
  console.log('');
  console.log('USAGE:');
  console.log('  funcstory <file-path> --entry <entry-point> [OPTIONS]');
  console.log('');
  console.log('ARGUMENTS:');
  console.log('  <file-path>         Path to TypeScript file to analyze');
  console.log('');
  console.log('OPTIONS:');
  console.log('  --entry <name>      Entry point function or method to start analysis from');
  console.log('  --scope <dir>       Directory to limit analysis scope (optional)');
  console.log('  --max-depth <num>   Maximum analysis depth (default: 10)');
  console.log('  --oneline           Compact output without JSDoc descriptions (story mode is default)');
  console.log('  --help, -h          Show this help message');
  console.log('');
  console.log('ENTRY POINT FORMATS:');
  console.log('  functionName        - For standalone functions');
  console.log('  ClassName.methodName - For class methods');
  console.log('');
  console.log('EXAMPLES:');
  console.log('  # Analyze a standalone function');
  console.log('  funcstory src/cli.ts --entry main --scope src');
  console.log('');
  console.log('  # Analyze a class method with full descriptions (default behavior)');
  console.log('  funcstory src/html-to-svg/index.ts --entry HtmlToSvgConverter.convert --scope src/html-to-svg');
  console.log('');
  console.log('  # Analyze with compact oneline output');
  console.log('  funcstory src/html-to-svg/index.ts --entry HtmlToSvgConverter.convert --scope src/html-to-svg --oneline');
  console.log('');
  console.log('  # Limit analysis depth');
  console.log('  funcstory src/utils.ts --entry processData --scope src --max-depth 5');
  console.log('');
  console.log('WHAT GETS ANALYZED:');
  console.log('  ✓ Functions in same file within scope directory');
  console.log('  ✓ Functions in other files within scope directory');
  console.log('  ✓ Class methods in same/other files within scope directory');
  console.log('  ✓ Object method calls where class is defined within scope');
  console.log('  ✗ Standard library functions (console.log, Math.max, etc.)');
  console.log('  ✗ Built-in Node.js functions');
  console.log('  ✗ Functions/classes outside scope directory');
  console.log('');
  console.log('SKIPPING FUNCTIONS:');
  console.log('  Add JSDoc comment with @funcstory-skip to skip analyzing a function:');
  console.log('  /**');
  console.log('   * This function will be skipped');
  console.log('   * @funcstory-skip');
  console.log('   */');
  console.log('  function myFunction() { ... }');
  console.log('');
  console.log('OUTPUT FORMAT:');
  console.log('  \x1b[1mfunctionName\x1b[0m (src/file.ts:42)');
  console.log('  1. \x1b[1mfirstCall\x1b[0m (src/utils.ts:15)');
  console.log('    1.1 \x1b[1mnestedCall\x1b[0m (src/nested.ts:8)');
  console.log('      1.1.1 \x1b[1mdeeperCall\x1b[0m (src/deep.ts:23)');
  console.log('    1.2 \x1b[1manotherCall\x1b[0m (src/other.ts:56)');
  console.log('  2. \x1b[1mexternalCall\x1b[0m (external:0) ↗️');
  console.log('  3. \x1b[1mskippedFunction\x1b[0m (src/skip.ts:12) ⏭️');
  console.log('  4. \x1b[31m\x1b[1mrecursiveCall\x1b[0m (src/recursive.ts:34)');
  console.log('    4.1 \x1b[31m\x1b[1mrecursiveCall\x1b[0m (src/recursive.ts:34) \x1b[41m\x1b[97m RECURSION \x1b[0m');
  console.log('');
  console.log('DEFAULT OUTPUT (STORY MODE):');
  console.log('  \x1b[1mfunctionName\x1b[0m (src/file.ts:42)');
  console.log('  \x1b[90m  This function does something important');
  console.log('');
  console.log('  This function handles special scenarios like...\x1b[0m');
  console.log('');
  console.log('  1. \x1b[1mfirstCall\x1b[0m (src/utils.ts:15)');
  console.log('  \x1b[90m    First function description here\x1b[0m');
  console.log('');
  console.log('SYMBOLS:');
  console.log('  \x1b[41m\x1b[97m RECURSION \x1b[0m - Recursive call detected (direct or indirect recursion)');
  console.log('  ↗️ - External call (outside scope)');
  console.log('  ⏭️ - Skipped due to @funcstory-skip annotation');
  console.log('');
  console.log('Created with love - Akash Manohar John');
}

// CLI Interface
function parseArgs(): TraceOptions {
  const args = process.argv.slice(2);
  
  // Check for help flag or no arguments
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  if (args.length < 1) {
    showHelp();
    process.exit(1);
  }

  const options: TraceOptions = {
    filePath: args[0],
    entryPoint: ''
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
        process.exit(1);
    }
  }

  if (!options.entryPoint) {
    console.error('Error: --entry is required');
    console.error('');
    showHelp();
    process.exit(1);
  }

  if (!fs.existsSync(options.filePath)) {
    console.error(`Error: File not found: ${options.filePath}`);
    process.exit(1);
  }

  return options;
}

function main() {
  try {
    const options = parseArgs();
    const tracer = new FunctionTracer(options);
    const trace = tracer.trace(options.filePath, options.entryPoint);
    
    if (trace) {
      const formatter = new TraceFormatter(!options.oneline); // Story mode unless oneline is specified
      console.log(formatter.format(trace));
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// ES module entry point check
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}