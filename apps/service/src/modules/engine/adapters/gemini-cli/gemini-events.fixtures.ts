/**
 * Lines of the pinned Gemini CLI's `--output-format stream-json`, in the shapes its stream formatter
 * writes (`JsonStreamEventType`, `convertToStreamStats`) and the engine check's headless runs read
 * (docs/engine-check.md, "Gemini CLI"), trimmed: one turn that reads a file, has a shell command
 * refused by the hook, and answers.
 */
export const TURN_WITH_A_REFUSAL = [
  '{"type":"init","timestamp":"2026-11-20T10:00:00.000Z","session_id":"5b1c0e1e-3f0a-4a51-9a51-0c0e5b9f1a11","model":"gemini-3.5-flash-lite"}',
  '{"type":"message","timestamp":"2026-11-20T10:00:00.001Z","role":"user","content":"Read README.md, then write ran.txt."}',
  '{"type":"message","timestamp":"2026-11-20T10:00:01.000Z","role":"assistant","content":"I\'ll read ","delta":true}',
  '{"type":"message","timestamp":"2026-11-20T10:00:01.010Z","role":"assistant","content":"it first.","delta":true}',
  '{"type":"tool_use","timestamp":"2026-11-20T10:00:01.100Z","tool_name":"read_file","tool_id":"read_file__call_1","parameters":{"file_path":"README.md"}}',
  '{"type":"tool_result","timestamp":"2026-11-20T10:00:01.200Z","tool_id":"read_file__call_1","status":"success","output":""}',
  '{"type":"tool_use","timestamp":"2026-11-20T10:00:02.000Z","tool_name":"run_shell_command","tool_id":"run_shell_command__call_2","parameters":{"command":"touch ran.txt","description":"Writes ran.txt"}}',
  '{"type":"tool_result","timestamp":"2026-11-20T10:00:02.100Z","tool_id":"run_shell_command__call_2","status":"error","output":"","error":{"type":"TOOL_EXECUTION_ERROR","message":"Refused by The Office: this session runs read-only commands only."}}',
  '{"type":"message","timestamp":"2026-11-20T10:00:03.000Z","role":"assistant","content":"The command was refused.","delta":true}',
  '{"type":"result","timestamp":"2026-11-20T10:00:03.100Z","status":"success","stats":{"total_tokens":2610,"input_tokens":2500,"output_tokens":110,"cached":2000,"input":500,"duration_ms":3100,"tool_calls":2,"models":{}}}',
];

/** A turn the free tier's limit refused (`gemini.usage-windows`), as headless printed it. */
export const QUOTA_REFUSAL = [
  '{"type":"init","timestamp":"2026-11-20T10:00:00.000Z","session_id":"5b1c0e1e-3f0a-4a51-9a51-0c0e5b9f1a11","model":"gemini-3.5-flash-lite"}',
  '{"type":"result","timestamp":"2026-11-20T10:00:01.000Z","status":"error","error":{"type":"Error","message":"429 You exceeded your current quota … Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15 … Please retry in 58.5s"},"stats":{"total_tokens":0,"input_tokens":0,"output_tokens":0,"cached":0,"input":0,"duration_ms":0,"tool_calls":0,"models":{}}}',
];

/** An invalid stream, which the CLI reports as an `error` event before an `error` result. */
export const EMPTY_ANSWER = [
  '{"type":"error","timestamp":"2026-11-20T10:00:01.000Z","severity":"error","message":"The model returned an empty response."}',
  '{"type":"result","timestamp":"2026-11-20T10:00:01.100Z","status":"error","stats":{"total_tokens":10,"input_tokens":10,"output_tokens":0,"cached":0,"input":10,"duration_ms":900,"tool_calls":0,"models":{}}}',
];
