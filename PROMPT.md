# FuncStory JSDoc Writing Instructions

Add JSDoc comments to functions for FuncStory analysis, follow these guidelines:

## Core Principle

**The function description and remarks must be about what the function does directly - not what its called functions and their descendant do.** The activities performed by the descendants of the current function are to be documented on those functions.

## JSDoc Format

```typescript
/**
 * Brief description of what this function directly does
 * 
 * @remarks
 * Additional details about this function's direct behavior, edge cases,
 * or important implementation notes. Do NOT describe what called functions do.
 */
function myFunction() {
  // Implementation
}
```

## Examples

### ✅ Good funcstory documentation example

```typescript
/**
 * Validates user input and transforms it to internal format
 * 
 * @remarks
 * Checks for required fields, normalizes email format, and sanitizes strings.
 * Returns null if validation fails.
 */
function processUserInput(input: UserInput): ProcessedInput | null {
  const validated = validateInput(input);  // Don't document what validateInput does here
  const transformed = transformToInternalFormat(validated);  // Don't document what transform does here
  return transformed;
}
```

### ❌ Bad funcstory Documentation example

```typescript
/**
 * Processes user input by validating required fields, checking email format,
 * transforming data structures, saving to database, and sending notifications
 * 
 * @remarks
 * First validates all input fields for correctness, then transforms the data
 * into our internal format, saves it to the database, and sends welcome emails.
 */
function processUserInput(input: UserInput): ProcessedInput | null {
  const validated = validateInput(input);      // This function does the validation
  const transformed = transform(validated);    // This function does the transformation  
  saveToDatabase(transformed);                 // This function does the saving
  sendWelcomeEmail(transformed.email);         // This function sends emails
  return transformed;
}
```

In the bad example, the JSDoc describes activities performed by called functions rather than what `processUserInput` directly does.

## Key Rules

1. **Describe direct actions only**: What does this function do itself, not what it orchestrates
2. **Avoid implementation details of callees**: Don't describe how called functions work
3. **Focus on the function's role**: What is this function's specific responsibility
4. **Use concise language**: Keep descriptions brief and focused
5. **Document edge cases**: Note important conditions or return scenarios for this function only

## Function Responsibilities

Think of functions in terms of their direct responsibilities:
- **Orchestrator functions**: "Coordinates user registration process" (not "validates input, saves to DB, sends email")
- **Validation functions**: "Checks if email format is valid" (not "uses regex to match email pattern")
- **Transform functions**: "Converts API response to internal model" (not "maps fields and validates data")

This approach creates clear, maintainable documentation where each function's JSDoc accurately reflects its direct purpose without redundancy.
