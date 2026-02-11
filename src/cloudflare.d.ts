// Cloudflare Workers D1 type declarations

interface D1Database {
  prepare(query: string): D1PreparedStatement
  dump(): Promise<ArrayBuffer>
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<D1ExecResult>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(colName?: string): Promise<T | null>
  run<T = unknown>(): Promise<D1Result<T>>
  all<T = unknown>(): Promise<D1Result<T>>
  raw<T = unknown>(): Promise<T[]>
}

interface D1Result<T = unknown> {
  results: T[]
  success: boolean
  meta: {
    duration: number
    changes: number
    last_row_id: number
    served_by: string
  }
}

interface D1ExecResult {
  count: number
  duration: number
}
