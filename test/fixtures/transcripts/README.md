# Recorded transcript shapes

`subagent.jsonl` is the part of a subagent transcript the clean-room logger
reads on `SubagentStop`: for each line only `type`, `requestId`, `timestamp`,
`message.model` and `message.usage`, plus `costUSD`. It holds no content, no
prompt and no path from any session. It has six lines: five `assistant` lines
(two share the request `req_1`, one has no `requestId`) over two models, and
one `user` line, so a test can check that a repeated request counts once.
