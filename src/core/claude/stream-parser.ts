export type StreamEventType = 'system' | 'assistant' | 'user' | 'result';

export interface StreamEvent {
  type: StreamEventType;
  subtype?: string;
  session_id?: string;
  message?: StreamMessage;
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  is_error?: boolean;
  error?: string;
  usage?: StreamUsage;
  tools?: string[];
  model?: string;
  cwd?: string;
}

export interface StreamMessage {
  id?: string;
  role?: string;
  content?: StreamContentBlock[];
  usage?: StreamUsage;
}

export interface StreamContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | StreamContentBlock[];
}

export interface StreamUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface ParsedClaudeEvent {
  kind: 'init' | 'text' | 'tool_call' | 'tool_result' | 'complete' | 'error' | 'unknown';
  timestamp: string;
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  cost?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  turns?: number;
  error?: string;
  model?: string;
  tools?: string[];
  raw: StreamEvent;
}

export function parseStreamLine(line: string): ParsedClaudeEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let event: StreamEvent;
  try {
    event = JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }

  const timestamp = new Date().toISOString();

  if (event.type === 'system' && event.subtype === 'init') {
    return {
      kind: 'init',
      timestamp,
      model: event.model,
      tools: event.tools,
      raw: event,
    };
  }

  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        return {
          kind: 'text',
          timestamp,
          text: block.text,
          raw: event,
        };
      }
      if (block.type === 'tool_use' && block.name) {
        return {
          kind: 'tool_call',
          timestamp,
          toolName: block.name,
          toolInput: summarizeToolInput(block.name, block.input),
          raw: event,
        };
      }
    }
  }

  if (event.type === 'user' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_result') {
        const resultText = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((b) => b.text ?? '').join('')
            : '';
        return {
          kind: 'tool_result',
          timestamp,
          toolResult: resultText,
          raw: event,
        };
      }
    }
  }

  if (event.type === 'result') {
    if (event.is_error || event.subtype === 'error') {
      return {
        kind: 'error',
        timestamp,
        error: event.error ?? event.result ?? 'Unknown error',
        cost: event.total_cost_usd,
        durationMs: event.duration_ms,
        raw: event,
      };
    }
    return {
      kind: 'complete',
      timestamp,
      text: event.result,
      cost: event.total_cost_usd,
      durationMs: event.duration_ms,
      turns: event.num_turns,
      inputTokens: event.usage?.input_tokens,
      outputTokens: event.usage?.output_tokens,
      raw: event,
    };
  }

  return {
    kind: 'unknown',
    timestamp,
    raw: event,
  };
}

function summarizeToolInput(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return '';

  if (toolName === 'Bash' && typeof input['command'] === 'string') {
    return input['command'];
  }
  if ((toolName === 'Read' || toolName === 'Write') && typeof input['file_path'] === 'string') {
    return input['file_path'];
  }
  if (toolName === 'Edit' && typeof input['file_path'] === 'string') {
    return input['file_path'];
  }
  if (toolName === 'WebSearch' && typeof input['query'] === 'string') {
    return input['query'];
  }

  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  const firstVal = input[keys[0]];
  if (typeof firstVal === 'string') return firstVal.slice(0, 80);
  return '';
}
