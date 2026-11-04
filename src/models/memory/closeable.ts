/** The only thing MemoryStore needs from a MongoDB client after connecting. */
export interface Closeable {
  close(): Promise<void>;
}
