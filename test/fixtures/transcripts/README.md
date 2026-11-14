# Recorded transcript shapes

`subagent.jsonl` is the part of a subagent transcript the clean-room logger
reads on `SubagentStop`: for each line only `type`, `requestId`, `timestamp`,
`message.model` and `message.usage`, plus `costUSD`. It holds no content, no
prompt and no path from any session. It has six lines: five `assistant` lines
(two share the request `req_1`, one has no `requestId`) over two models, and
one `user` line, so a test can check that a repeated request counts once.

`agent-full.jsonl` is a ten-line subagent transcript for the usage record's
adapter: one request spread over two lines (`req_a`), an attachment line that
is not a conversation row, two sidechain lines (`req_s` and a tool error), an
API-error line with usage and no `costUSD`, tool uses and tool results (one
with `is_error`), and timestamps one to seven seconds apart so `activeMs`
is 17000. It holds no content text and nothing from any session.
