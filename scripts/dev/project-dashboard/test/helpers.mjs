// Synthetic transcript records for the tests. Nothing here comes from a real transcript.
export function assistant(id, ts, u = {}, extra = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    sessionId: 'x',
    cwd: '/fake/repo',
    gitBranch: 'feature/a',
    isSidechain: false,
    message: {
      id,
      model: 'claude-test-1',
      content: [{ type: 'text', text: 'FAKE-ASSISTANT-TEXT' }],
      usage: {
        input_tokens: u.input ?? 10,
        output_tokens: u.output ?? 5,
        cache_read_input_tokens: u.cacheRead ?? 1000,
        cache_creation_input_tokens: u.cacheWrite ?? 100,
        service_tier: 'standard',
      },
    },
    ...extra,
  });
}

export function userLine(ts, text) {
  return JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: text } });
}
