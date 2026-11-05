/**
 * La seule chose dont MemoryStore a besoin d'un client MongoDB après
 * connexion.
 *
 * @interface
 */
export interface Closeable {
  close(): Promise<void>;
}
