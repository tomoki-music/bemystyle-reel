export type TemplateVariableValues = Record<string, string>

const VAR_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g

export function extractTemplateVariables(data: unknown): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  function visit(value: unknown): void {
    if (typeof value === 'string') {
      for (const match of value.matchAll(VAR_RE)) {
        const key = match[1]
        if (!seen.has(key)) {
          seen.add(key)
          found.push(key)
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) visit(v)
    }
  }

  visit(data)
  return found
}

export function applyTemplateVariables<T>(data: T, values: TemplateVariableValues): T {
  if (typeof data === 'string') {
    return data.replace(VAR_RE, (match, key: string) => {
      const val = values[key]
      return val !== undefined && val !== '' ? val : match
    }) as unknown as T
  }
  if (Array.isArray(data)) {
    return data.map((item) => applyTemplateVariables(item, values)) as unknown as T
  }
  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      result[k] = applyTemplateVariables(v, values)
    }
    return result as T
  }
  return data
}
