const TIMEOUT_MS = 5000

export async function runCode(code: string): Promise<{ success: boolean; result: unknown; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, result: undefined, error: 'Execution timeout (5s)' })
    }, TIMEOUT_MS)

    try {
      // Wrap user code in a function body, supporting top-level `return`
      const wrappedCode = `
        "use strict";
        const require = undefined;
        const process = undefined;
        const global = undefined;
        ${code}
      `

      const execFn = new Function(wrappedCode)
      const result = execFn()
      clearTimeout(timer)
      resolve({ success: true, result })
    } catch (err: unknown) {
      clearTimeout(timer)
      resolve({
        success: false,
        result: undefined,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
