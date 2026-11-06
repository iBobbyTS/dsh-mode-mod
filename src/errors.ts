export function errorDetails(error: unknown): { message?: string; code?: string } {
 if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return {}
 const value = error as { message?: unknown; code?: unknown }
 return { ...(typeof value.message === 'string' ? { message: value.message } : {}), ...(typeof value.code === 'string' ? { code: value.code } : {}) }
}
