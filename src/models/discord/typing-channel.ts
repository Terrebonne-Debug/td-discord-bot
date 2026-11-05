/**
 * Un canal qui peut afficher l'indicateur de frappe.
 *
 * @interface
 */
export interface TypingChannel {
  sendTyping?: () => Promise<unknown>;
}
