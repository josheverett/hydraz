/** Max length for Bash command text stored in events.jsonl (limits secret leakage). */
export const BASH_COMMAND_EVENT_MAX_LEN = 120;

export function persistToolInputForEvent(
  toolName: string | undefined,
  toolInput: string | undefined,
): string {
  if (!toolInput) {
    return '';
  }
  if (toolName === 'Bash' && toolInput.length > BASH_COMMAND_EVENT_MAX_LEN) {
    return toolInput.slice(0, BASH_COMMAND_EVENT_MAX_LEN) + '…';
  }
  return toolInput;
}
